/**
 * Campaign execution scheduler — determines which enrolled contacts are due for
 * their next drip email and dispatches them via Brevo transactional API.
 *
 * Architecture:
 *   drip_enrollments tracks per-contact step state.
 *   Each step has a timing_days value = days to wait since the previous send.
 *   On delivery, the Brevo webhook advances current_step.
 *   This scheduler handles the outbound send side.
 *
 * Anti-double-send: before dispatching, check for an existing activities record
 * with {campaign_id, drip_step: N} for this contact. If found, skip.
 * After dispatching, immediately update last_email_sent_at so the next run skips.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { sendBrevoTransactionalEmail, formatBrevoError } from '@/lib/brevo'

// ── Types ─────────────────────────────────────────────────────────────────

type EmailStep = {
  step: number
  timing_days: number
  subject: string
  content_outline?: unknown[]
}

type CampaignSequence = {
  steps: EmailStep[]
}

type StepTemplateManifest = {
  step: number
  templateId: number
}

type BrevoDeployment = {
  stepTemplates: StepTemplateManifest[]
}

type PerformanceData = {
  brevo_deployment?: BrevoDeployment
}

export type PendingSend = {
  enrollmentId: string
  contactId: string
  contactEmail: string
  campaignId: string
  campaignTitle: string
  stepNumber: number
  templateId: number
  stepSubject: string
}

export type ExecuteResult = {
  sent: number
  skipped: number
  errors: { enrollmentId: string; reason: string }[]
  sentDetails: { enrollmentId: string; contactEmail: string; step: number; messageId: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getTemplateIdForStep(performanceData: unknown, stepNumber: number): number | null {
  if (!performanceData || typeof performanceData !== 'object') return null
  const pd = performanceData as PerformanceData
  const stepTemplates = pd.brevo_deployment?.stepTemplates
  if (!Array.isArray(stepTemplates)) return null
  const found = stepTemplates.find((t) => t.step === stepNumber)
  return found?.templateId ?? null
}

function isReadyToSend(
  stepIndex: number, // 0-based index into steps array
  enrolledAt: string,
  lastEmailSentAt: string | null,
  timingDays: number,
  now: Date,
): boolean {
  const referenceTime = stepIndex === 0
    ? new Date(enrolledAt)
    : lastEmailSentAt
      ? new Date(lastEmailSentAt)
      : new Date(enrolledAt)

  const readyAt = new Date(referenceTime.getTime() + timingDays * 24 * 60 * 60 * 1000)
  return now >= readyAt
}

// ── Core: compute pending sends ───────────────────────────────────────────

export async function getPendingSends(now: Date): Promise<PendingSend[]> {
  // Fetch all active enrollments with their contact and campaign data
  const { data: rows, error } = await supabaseAdmin
    .from('drip_enrollments')
    .select(`
      id,
      contact_id,
      campaign_id,
      current_step,
      enrolled_at,
      last_email_sent_at,
      contacts (id, email, email_opted_out, email_status),
      drip_campaigns (id, title, status, sequence, performance_data)
    `)
    .eq('status', 'active')

  if (error) {
    throw new Error(`Failed to fetch active enrollments: ${error.message}`)
  }

  const pending: PendingSend[] = []

  for (const row of rows ?? []) {
    const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts
    const campaign = Array.isArray(row.drip_campaigns) ? row.drip_campaigns[0] : row.drip_campaigns

    // Skip if contact or campaign data is missing
    if (!contact || !campaign) continue

    // Skip opted-out or bounced contacts
    if (contact.email_opted_out) continue
    if (contact.email_status === 'bounced' || contact.email_status === 'unsubscribed') continue

    // Skip if campaign is not active
    if (campaign.status !== 'active') continue

    const sequence = campaign.sequence as CampaignSequence | null
    if (!sequence?.steps?.length) continue

    const currentStep = Math.max(1, Number(row.current_step || 1))
    const stepIndex = currentStep - 1 // 0-based

    // currentStep > totalSteps means sequence is complete (webhook marks completed)
    if (stepIndex >= sequence.steps.length) continue

    const stepDef = sequence.steps[stepIndex]
    if (!stepDef) continue

    // Check timing
    const ready = isReadyToSend(
      stepIndex,
      row.enrolled_at,
      row.last_email_sent_at,
      stepDef.timing_days ?? 0,
      now,
    )
    if (!ready) continue

    // Content guard: skip sends where the step has no real email content.
    // This prevents dispatching blank/placeholder Brevo templates.
    const contentItems = Array.isArray(stepDef.content_outline) ? stepDef.content_outline : []
    const hasRealContent = contentItems.some((item) => String(item || '').trim().length > 0)
    if (!hasRealContent) continue

    // Resolve template ID from deployment manifest
    const templateId = getTemplateIdForStep(campaign.performance_data, currentStep)
    if (!templateId) continue // Campaign not deployed yet — skip

    pending.push({
      enrollmentId: row.id,
      contactId: contact.id,
      contactEmail: contact.email,
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      stepNumber: currentStep,
      templateId,
      stepSubject: stepDef.subject,
    })
  }

  return pending
}

// ── Core: execute a single pending send ──────────────────────────────────

async function hasAlreadySentStep(
  contactId: string,
  campaignId: string,
  stepNumber: number,
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('activities')
    .select('id')
    .eq('contact_id', contactId)
    .eq('channel', 'email')
    .contains('metadata', { campaign_id: campaignId, drip_step: stepNumber })
    .limit(1)
    .maybeSingle()

  return Boolean(data?.id)
}

async function recordSendActivity(
  contactId: string,
  campaignId: string,
  campaignTitle: string,
  stepNumber: number,
  stepSubject: string,
  messageId: string,
): Promise<void> {
  await supabaseAdmin.from('activities').insert({
    contact_id: contactId,
    type: 'email_sent',
    channel: 'email',
    subject: stepSubject,
    body: `Drip step ${stepNumber} dispatched — campaign: ${campaignTitle}`,
    metadata: {
      provider: 'brevo',
      provider_event_id: messageId,
      brevo_event: 'queued',
      campaign_id: campaignId,
      campaign_title: campaignTitle,
      drip_step: stepNumber,
      message_id: messageId,
    },
    created_at: new Date().toISOString(),
  })
}

async function markEnrollmentSent(enrollmentId: string, sentAt: string): Promise<void> {
  await supabaseAdmin
    .from('drip_enrollments')
    .update({ last_email_sent_at: sentAt })
    .eq('id', enrollmentId)
}

// ── Public: run full execution pass ──────────────────────────────────────

export async function executeScheduledSends(now: Date = new Date()): Promise<ExecuteResult> {
  const result: ExecuteResult = {
    sent: 0,
    skipped: 0,
    errors: [],
    sentDetails: [],
  }

  // Daily send cap — respects Brevo's per-day quota (configure via MAX_SENDS_PER_DAY env var).
  // Default: 290 (leaves 10 headroom under Brevo free tier's 300/day limit).
  // Set higher (e.g. 10000) after upgrading to a paid Brevo plan.
  const maxSendsPerDay = Math.max(1, parseInt(String(process.env.MAX_SENDS_PER_DAY || '290'), 10))

  let pending: PendingSend[]
  try {
    pending = await getPendingSends(now)
  } catch (err) {
    result.errors.push({
      enrollmentId: 'global',
      reason: err instanceof Error ? err.message : 'Failed to fetch pending sends',
    })
    return result
  }

  // Apply daily cap — oldest-first (slice preserves getPendingSends order).
  const capped = pending.slice(0, maxSendsPerDay)
  if (pending.length > maxSendsPerDay) {
    result.skipped += pending.length - maxSendsPerDay
  }

  for (const send of capped) {
    // Anti-double-send: skip if already dispatched for this step
    const alreadySent = await hasAlreadySentStep(send.contactId, send.campaignId, send.stepNumber)
    if (alreadySent) {
      result.skipped++
      continue
    }

    // Dispatch via Brevo transactional API
    let messageId: string
    try {
      const sendResult = await sendBrevoTransactionalEmail({
        templateId: send.templateId,
        toEmail: send.contactEmail,
        tags: [`campaign:${send.campaignId}`, `step:${send.stepNumber}`],
        params: {
          CAMPAIGN_TITLE: send.campaignTitle,
          STEP_NUMBER: send.stepNumber,
        },
      })
      messageId = sendResult.messageId
    } catch (err) {
      result.errors.push({
        enrollmentId: send.enrollmentId,
        reason: formatBrevoError(err),
      })
      continue
    }

    const sentAt = now.toISOString()

    // Record in activities (for dedup on next run + CRM timeline)
    await recordSendActivity(
      send.contactId,
      send.campaignId,
      send.campaignTitle,
      send.stepNumber,
      send.stepSubject,
      messageId,
    )

    // Update last_email_sent_at so timing check on next run is correct
    await markEnrollmentSent(send.enrollmentId, sentAt)

    result.sent++
    result.sentDetails.push({
      enrollmentId: send.enrollmentId,
      contactEmail: send.contactEmail,
      step: send.stepNumber,
      messageId,
    })
  }

  return result
}
