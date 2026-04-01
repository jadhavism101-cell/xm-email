import type { CampaignDraftPayload } from '@/lib/campaign-draft'
import { resolveTargetSegments } from '@/lib/campaign-draft'
import { supabaseAdmin } from '@/lib/supabase'

export type AudienceEstimate = {
  total: number | null
  resolvedSegments: string[]
  inferenceSource: 'explicit' | 'campaign_type' | 'none'
  deliverableOnly: boolean
  filtersApplied: Record<string, unknown>
  note: string
}

export type CampaignPreflightIssue = {
  severity: 'error' | 'warning'
  code: string
  message: string
}

export type CampaignPreflightResult = {
  ok: boolean
  issues: CampaignPreflightIssue[]
  audienceEstimate: AudienceEstimate
  checkedAt: string
}

function toOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function countAudienceByFilters(filters: {
  segment?: string
  type?: string | null
  status?: string | null
  importBatch?: string | null
}): Promise<number> {
  let query = supabaseAdmin
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('email_opted_out', false)
    .neq('email_status', 'bounced')
    .not('email', 'is', null)

  if (filters.segment) {
    query = query.eq('custom_fields->>segment', filters.segment)
  }
  if (filters.type) {
    query = query.eq('type', filters.type)
  }
  if (filters.status) {
    query = query.eq('status', filters.status)
  }
  if (filters.importBatch) {
    query = query.eq('import_batch', filters.importBatch)
  }

  const { count, error } = await query
  if (error) {
    throw new Error(error.message)
  }

  return count ?? 0
}

export async function estimateCampaignAudience(draft: CampaignDraftPayload): Promise<AudienceEstimate> {
  const targetSegment = draft.target_segment || {}
  const resolved = resolveTargetSegments(targetSegment, draft.campaign_type)
  const type = toOptionalString(targetSegment.type)
  const status = toOptionalString(targetSegment.status)
  const importBatch = toOptionalString(targetSegment.import_batch)

  const filtersApplied: Record<string, unknown> = {}
  if (resolved.segments.length > 0) {
    filtersApplied.segment = resolved.segments.length === 1 ? resolved.segments[0] : resolved.segments
  }
  if (type) filtersApplied.type = type
  if (status) filtersApplied.status = status
  if (importBatch) filtersApplied.import_batch = importBatch

  const hasCountableFilters = resolved.segments.length > 0 || Boolean(type) || Boolean(status) || Boolean(importBatch)
  if (!hasCountableFilters) {
    return {
      total: null,
      resolvedSegments: resolved.segments,
      inferenceSource: resolved.source,
      deliverableOnly: true,
      filtersApplied,
      note: 'No canonical target segment could be resolved from the campaign yet.',
    }
  }

  if (resolved.segments.length > 1) {
    const counts = await Promise.all(
      resolved.segments.map((segment) =>
        countAudienceByFilters({
          segment,
          type,
          status,
          importBatch,
        }),
      ),
    )

    return {
      total: counts.reduce((sum, count) => sum + count, 0),
      resolvedSegments: resolved.segments,
      inferenceSource: resolved.source,
      deliverableOnly: true,
      filtersApplied,
      note: 'Estimate is based on deliverable contacts across the resolved campaign segments.',
    }
  }

  return {
    total: await countAudienceByFilters({
      segment: resolved.segments[0],
      type,
      status,
      importBatch,
    }),
    resolvedSegments: resolved.segments,
    inferenceSource: resolved.source,
    deliverableOnly: true,
    filtersApplied,
    note: 'Estimate is based on deliverable contacts that match the resolved campaign filters.',
  }
}

export async function runCampaignPreflight(draft: CampaignDraftPayload): Promise<CampaignPreflightResult> {
  const issues: CampaignPreflightIssue[] = []

  if (!draft.title.trim()) {
    issues.push({ severity: 'error', code: 'missing_title', message: 'Campaign title is required.' })
  }
  if (!draft.goal.trim()) {
    issues.push({ severity: 'error', code: 'missing_goal', message: 'Campaign goal is required.' })
  }

  if (!Array.isArray(draft.sequence.steps) || draft.sequence.steps.length === 0) {
    issues.push({ severity: 'error', code: 'missing_steps', message: 'Campaign sequence must include at least one step.' })
  } else {
    draft.sequence.steps.forEach((step, index) => {
      if (!String(step.subject || '').trim()) {
        issues.push({
          severity: 'error',
          code: `step_${index + 1}_missing_subject`,
          message: `Step ${index + 1} is missing a subject line.`,
        })
      }
      const contentItems = Array.isArray(step.content_outline) ? step.content_outline : []
      const hasRealContent = contentItems.some((item) => String(item || '').trim().length > 0)
      if (!hasRealContent) {
        issues.push({
          severity: 'error',
          code: `step_${index + 1}_empty_content`,
          message: `Step ${index + 1} has no email content. Add at least one content outline item before deploying.`,
        })
      }
      if (!String(step.cta || '').trim()) {
        issues.push({
          severity: 'error',
          code: `step_${index + 1}_missing_cta`,
          message: `Step ${index + 1} is missing a CTA.`,
        })
      }
    })
  }

  if (!process.env.BREVO_API_KEY?.trim()) {
    issues.push({
      severity: 'warning',
      code: 'missing_brevo_key',
      message: 'BREVO_API_KEY is not configured in this environment.',
    })
  }

  const audienceEstimate = await estimateCampaignAudience(draft)

  if (audienceEstimate.inferenceSource === 'none') {
    issues.push({
      severity: 'error',
      code: 'unresolved_target_segment',
      message: 'Target segment could not be resolved into a canonical audience.',
    })
  } else if (audienceEstimate.inferenceSource === 'campaign_type') {
    issues.push({
      severity: 'warning',
      code: 'inferred_target_segment',
      message: 'Target segment is inferred from campaign type rather than explicitly defined.',
    })
  }

  if (audienceEstimate.total === 0) {
    issues.push({
      severity: 'error',
      code: 'empty_audience',
      message: 'No deliverable contacts match the current campaign audience filters.',
    })
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues,
    audienceEstimate,
    checkedAt: new Date().toISOString(),
  }
}