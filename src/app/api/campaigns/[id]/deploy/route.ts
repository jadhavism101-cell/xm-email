import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardRole, requireDashboardSession } from '@/lib/api-security'
import { supabaseAdmin } from '@/lib/supabase'
import { logCampaignAuditEvent } from '@/lib/campaign-audit'
import { runCampaignPreflight } from '@/lib/campaign-preflight'
import {
  BREVO_LISTS,
  formatBrevoError,
  upsertBrevoSmtpTemplate,
  type BrevoSmtpTemplateUpsertResult,
} from '@/lib/brevo'
import {
  resolveTargetSegments,
  type CampaignDraftPayload,
  type CanonicalSegment,
} from '@/lib/campaign-draft'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

type BrevoStepTemplateDeployment = {
  step: number
  templateId: number
  created: boolean
  subject: string
  templateName: string
}

type BrevoDeploymentManifest = {
  provider: 'brevo'
  mode: 'template_pack_v1'
  deployedAt: string
  sender: {
    name: string
    email: string
    replyToEmail: string | null
  }
  targetSegments: CanonicalSegment[]
  targetListIds: number[]
  stepTemplates: BrevoStepTemplateDeployment[]
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderStepTemplateHtml(
  campaignTitle: string,
  campaignGoal: string,
  step: CampaignDraftPayload['sequence']['steps'][number],
): string {
  const outline = Array.isArray(step.content_outline) ? step.content_outline : []
  const outlineHtml = outline.length > 0
    ? `<ul>${outline.map((item) => `<li>${escapeHtml(String(item))}</li>`).join('')}</ul>`
    : '<p>Message body to be finalized.</p>'

  const ctaText = escapeHtml(String(step.cta || 'Learn more'))
  const ctaUrl = String(step.cta_url || '').trim()
  const safeCtaUrl = ctaUrl ? escapeHtml(ctaUrl) : '#'

  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '  <meta charset="utf-8"/>',
    '  <meta name="viewport" content="width=device-width, initial-scale=1"/>',
    `  <title>${escapeHtml(campaignTitle)} - Step ${step.step}</title>`,
    '</head>',
    '<body style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#111827;background:#f9fafb;padding:24px;">',
    '  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">',
    '    <tr>',
    '      <td style="padding:24px;">',
    `        <p style="margin:0 0 8px 0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(campaignTitle)} - Step ${step.step}</p>`,
    `        <h1 style="margin:0 0 12px 0;font-size:24px;color:#111827;">${escapeHtml(step.subject)}</h1>`,
    `        <p style="margin:0 0 16px 0;color:#374151;">${escapeHtml(campaignGoal)}</p>`,
    `        <div style="margin:0 0 20px 0;color:#111827;">${outlineHtml}</div>`,
    '        <p style="margin:24px 0 0 0;">',
    `          <a href="${safeCtaUrl}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;">${ctaText}</a>`,
    '        </p>',
    '      </td>',
    '    </tr>',
    '  </table>',
    '</body>',
    '</html>',
  ].join('')
}

function getBrevoSenderProfile(): { name: string; email: string; replyToEmail: string | null } | null {
  const email = String(process.env.BREVO_SENDER_EMAIL || '').trim()
  if (!email) return null

  const name = String(process.env.BREVO_SENDER_NAME || 'XtraMiles Team').trim() || 'XtraMiles Team'
  const replyToEmail = String(process.env.BREVO_REPLY_TO_EMAIL || '').trim() || null

  return {
    name,
    email,
    replyToEmail,
  }
}

function mapSegmentToListId(segment: CanonicalSegment): number {
  if (segment === 'active_customer') return BREVO_LISTS.ACTIVE_CUSTOMERS
  if (segment === 'lapsed_customer') return BREVO_LISTS.LAPSED_CUSTOMERS
  if (segment === 'new_cold') return BREVO_LISTS.COLD_CSV
  return BREVO_LISTS.WARM_LEADS
}

function resolveTargetListIds(draft: CampaignDraftPayload): { segments: CanonicalSegment[]; listIds: number[] } {
  const resolved = resolveTargetSegments(draft.target_segment || {}, draft.campaign_type)
  const segments = resolved.segments
  if (segments.length === 0) {
    return {
      segments: [],
      listIds: [BREVO_LISTS.ALL_CONTACTS],
    }
  }

  const mapped = Array.from(new Set(segments.map((segment) => mapSegmentToListId(segment))))
  return {
    segments,
    listIds: mapped,
  }
}

function getExistingStepTemplateMap(performanceData: unknown): Map<number, number> {
  const map = new Map<number, number>()
  const root = toRecord(performanceData)
  const deployment = toRecord(root.brevo_deployment)
  const stepTemplates = deployment.stepTemplates

  if (!Array.isArray(stepTemplates)) return map

  for (const item of stepTemplates) {
    const row = toRecord(item)
    const step = Number(row.step)
    const templateId = Number(row.templateId)
    if (Number.isFinite(step) && Number.isFinite(templateId) && step > 0 && templateId > 0) {
      map.set(step, templateId)
    }
  }

  return map
}

async function loadCampaignDraft(campaignId: string): Promise<CampaignDraftPayload | null> {
  const { data, error } = await supabaseAdmin
    .from('drip_campaigns')
    .select('id, title, goal, campaign_type, target_segment, exit_conditions, sequence')
    .eq('id', campaignId)
    .single()

  if (error || !data) {
    return null
  }

  return {
    title: String(data.title || ''),
    goal: String(data.goal || ''),
    campaign_type: data.campaign_type,
    target_segment: (data.target_segment as Record<string, unknown>) || {},
    exit_conditions: (data.exit_conditions as Record<string, unknown>) || {},
    sequence: (data.sequence as CampaignDraftPayload['sequence']) || { steps: [], branches: [] },
    status: 'draft',
  }
}

export async function GET(req: NextRequest, context: RouteContext) {
  const unauthorized = requireDashboardSession(req)
  if (unauthorized) return unauthorized

  try {
    const { id } = await context.params
    const draft = await loadCampaignDraft(id)

    if (!draft) {
      return NextResponse.json({ ok: false, error: 'Campaign not found' }, { status: 404 })
    }

    const preflight = await runCampaignPreflight(draft)
    return NextResponse.json({ ok: true, preflight })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  const forbidden = requireDashboardRole(req, 'sales')
  if (forbidden) return forbidden

  try {
    const { id } = await context.params
    const draft = await loadCampaignDraft(id)

    if (!draft) {
      return NextResponse.json({ ok: false, error: 'Campaign not found' }, { status: 404 })
    }

    const sender = getBrevoSenderProfile()
    if (!sender) {
      return NextResponse.json(
        {
          ok: false,
          error: 'BREVO_SENDER_EMAIL is not configured',
        },
        { status: 400 },
      )
    }

    if (!String(process.env.BREVO_API_KEY || '').trim()) {
      return NextResponse.json(
        {
          ok: false,
          error: 'BREVO_API_KEY is not configured',
        },
        { status: 400 },
      )
    }

    const preflight = await runCampaignPreflight(draft)
    if (!preflight.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Campaign is not deploy-ready',
          preflight,
        },
        { status: 400 },
      )
    }

    const { data: campaignState, error: campaignStateError } = await supabaseAdmin
      .from('drip_campaigns')
      .select('performance_data')
      .eq('id', id)
      .single()

    if (campaignStateError) {
      return NextResponse.json({ ok: false, error: campaignStateError.message }, { status: 500 })
    }

    const existingTemplateMap = getExistingStepTemplateMap(campaignState?.performance_data)
    const deployedTemplates: BrevoStepTemplateDeployment[] = []

    for (const step of draft.sequence.steps) {
      const templateName = `xm-email:${id}:step-${step.step}`
      const stepSubject = String(step.subject || `Step ${step.step}`)
      const htmlContent = renderStepTemplateHtml(draft.title, draft.goal, step)

      let deploymentResult: BrevoSmtpTemplateUpsertResult
      try {
        deploymentResult = await upsertBrevoSmtpTemplate({
          name: templateName,
          subject: stepSubject,
          htmlContent,
          senderName: sender.name,
          senderEmail: sender.email,
          replyToEmail: sender.replyToEmail,
          existingTemplateId: existingTemplateMap.get(step.step) || null,
        })
      } catch (error) {
        return NextResponse.json(
          {
            ok: false,
            error: `Brevo template provisioning failed for step ${step.step}: ${formatBrevoError(error)}`,
          },
          { status: 502 },
        )
      }

      deployedTemplates.push({
        step: step.step,
        templateId: deploymentResult.templateId,
        created: deploymentResult.created,
        subject: stepSubject,
        templateName,
      })
    }

    const resolvedTargets = resolveTargetListIds(draft)
    const brevoDeployment: BrevoDeploymentManifest = {
      provider: 'brevo',
      mode: 'template_pack_v1',
      deployedAt: new Date().toISOString(),
      sender,
      targetSegments: resolvedTargets.segments,
      targetListIds: resolvedTargets.listIds,
      stepTemplates: deployedTemplates,
    }

    const previousPerformanceData = toRecord(campaignState?.performance_data)
    const nextPerformanceData = {
      ...previousPerformanceData,
      preflight_checked_at: preflight.checkedAt,
      estimated_audience: preflight.audienceEstimate.total,
      estimated_segments: preflight.audienceEstimate.resolvedSegments,
      brevo_deployment: brevoDeployment,
    }

    const { data, error } = await supabaseAdmin
      .from('drip_campaigns')
      .update({
        status: 'active',
        updated_at: new Date().toISOString(),
        approved_by: 'dashboard',
        brevo_automation_id: `template-pack:${id}`,
        performance_data: nextPerformanceData,
      })
      .eq('id', id)
      .select('id, status, approved_by, brevo_automation_id, performance_data')
      .single()

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    await logCampaignAuditEvent({
      action: 'deploy',
      campaignId: id,
      actor: 'dashboard',
      metadata: {
        resultingStatus: data.status,
        estimatedAudience: preflight.audienceEstimate.total,
        estimatedSegments: preflight.audienceEstimate.resolvedSegments,
        brevoMode: brevoDeployment.mode,
        brevoTemplateIds: deployedTemplates.map((stepTemplate) => stepTemplate.templateId),
      },
    })

    return NextResponse.json({
      ok: true,
      item: data,
      preflight,
      brevoDeployment,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}