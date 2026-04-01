import type { CampaignType } from '@/lib/supabase'

export type CampaignDraftPayload = {
  title: string
  goal: string
  campaign_type: CampaignType
  target_segment: Record<string, unknown>
  exit_conditions: Record<string, unknown>
  sequence: {
    steps: Array<{
      step: number
      timing_days: number
      subject: string
      preview_text?: string
      content_outline: string[]
      cta: string
      cta_url?: string
      personalization_vars: string[]
    }>
    branches: Array<{ trigger: string; action: string }>
  }
  status: 'draft'
}

export type CanonicalSegment =
  | 'active_customer'
  | 'lapsed_customer'
  | 'warm_lead'
  | 'never_ordered'
  | 'new_cold'

export type ResolvedTargetSegment = {
  segments: CanonicalSegment[]
  source: 'explicit' | 'campaign_type' | 'none'
}

const ALLOWED_TYPES = new Set(['lead_nurture', 'onboarding', 're_engagement', 'upsell', 'csv_import', 'custom'])

const CAMPAIGN_TYPE_FALLBACK_SEGMENT: Partial<Record<CampaignType, CanonicalSegment>> = {
  lead_nurture: 'warm_lead',
  onboarding: 'never_ordered',
  re_engagement: 'lapsed_customer',
  upsell: 'active_customer',
  csv_import: 'new_cold',
}

export function extractJsonBlock(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) return fenced[1].trim()

  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1)
  }

  throw new Error('No JSON object found in AI output')
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

function normalizeSegmentLabel(value: string): CanonicalSegment | null {
  const normalized = value.toLowerCase().trim().replace(/[\s-]+/g, '_')

  if (
    normalized === 'active_customer' ||
    normalized === 'active_customers' ||
    normalized === 'active' ||
    normalized === 'current_customer'
  ) {
    return 'active_customer'
  }

  if (
    normalized === 'lapsed_customer' ||
    normalized === 'lapsed_customers' ||
    normalized === 'dormant_customer' ||
    normalized === 're_engagement' ||
    normalized === 'reengagement'
  ) {
    return 'lapsed_customer'
  }

  if (
    normalized === 'warm_lead' ||
    normalized === 'warm_leads' ||
    normalized === 'warm' ||
    normalized === 'lead_nurture'
  ) {
    return 'warm_lead'
  }

  if (
    normalized === 'never_ordered' ||
    normalized === 'never_ordered_customer' ||
    normalized === 'never_shipped' ||
    normalized === 'onboarding'
  ) {
    return 'never_ordered'
  }

  if (
    normalized === 'new_cold' ||
    normalized === 'cold' ||
    normalized === 'cold_lead' ||
    normalized === 'csv_import'
  ) {
    return 'new_cold'
  }

  return null
}

function getSegmentCandidates(targetSegment: Record<string, unknown>): string[] {
  const candidates: string[] = []
  const directKeys = ['segment', 'primary_segment', 'audience_segment', 'segment_name']

  for (const key of directKeys) {
    const value = targetSegment[key]
    if (typeof value === 'string' && value.trim()) {
      candidates.push(value)
    }
  }

  const listKeys = ['segments', 'audience_segments']
  for (const key of listKeys) {
    const value = targetSegment[key]
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) {
          candidates.push(item)
        }
      }
    }
  }

  return candidates
}

export function resolveTargetSegments(
  targetSegment: Record<string, unknown>,
  campaignType: CampaignType,
): ResolvedTargetSegment {
  const explicitSegments = Array.from(
    new Set(
      getSegmentCandidates(targetSegment)
        .map((value) => normalizeSegmentLabel(value))
        .filter((value): value is CanonicalSegment => value !== null),
    ),
  )

  if (explicitSegments.length > 0) {
    return {
      segments: explicitSegments,
      source: 'explicit',
    }
  }

  const fallback = CAMPAIGN_TYPE_FALLBACK_SEGMENT[campaignType]
  if (fallback) {
    return {
      segments: [fallback],
      source: 'campaign_type',
    }
  }

  return {
    segments: [],
    source: 'none',
  }
}

function normalizeTargetSegment(value: unknown, campaignType: CampaignType): Record<string, unknown> {
  const targetSegment = value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}

  const resolved = resolveTargetSegments(targetSegment, campaignType)
  if (resolved.segments.length === 1) {
    targetSegment.segment = resolved.segments[0]
  } else if (resolved.segments.length > 1) {
    targetSegment.segments = resolved.segments
  }

  return targetSegment
}

export function toCampaignDraftPayload(aiOutput: string): CampaignDraftPayload {
  const parsed = JSON.parse(extractJsonBlock(aiOutput)) as Record<string, unknown>

  const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : []
  if (rawSteps.length === 0) {
    throw new Error('AI output has no steps to save')
  }

  const rawType = String(parsed.campaign_type || 'custom')
  const campaignType = ALLOWED_TYPES.has(rawType) ? (rawType as CampaignDraftPayload['campaign_type']) : 'custom'

  const steps = rawSteps.map((raw, index) => {
    const row = raw as Record<string, unknown>
    return {
      step: index + 1,
      timing_days: Number(row.day_offset ?? row.timing_days ?? (index === 0 ? 0 : 2)) || 0,
      subject: String(row.subject || `Step ${index + 1}`),
      preview_text: typeof row.preview_text === 'string' ? row.preview_text : undefined,
      content_outline: toStringArray(row.body_outline),
      cta: String(row.cta_text || row.cta || 'Learn more'),
      cta_url: typeof row.cta_url === 'string' ? row.cta_url : undefined,
      personalization_vars: toStringArray(row.personalization_vars),
    }
  })

  const branches = Array.isArray(parsed.branches)
    ? parsed.branches.map((raw) => {
        const row = raw as Record<string, unknown>
        return {
          trigger: String(row.trigger || ''),
          action: String(row.action || ''),
        }
      })
    : []

  return {
    title: String(parsed.title || 'AI Draft Campaign'),
    goal: String(parsed.goal || 'Generated by AI Builder'),
    campaign_type: campaignType,
    target_segment: normalizeTargetSegment(parsed.target_segment, campaignType),
    exit_conditions: (parsed.exit_conditions as Record<string, unknown>) || {},
    sequence: {
      steps,
      branches,
    },
    status: 'draft',
  }
}