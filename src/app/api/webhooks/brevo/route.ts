import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import type { BrevoWebhookEvent } from '@/lib/brevo'
import { verifyBrevoWebhookRequest } from '@/lib/api-security'
import {
  resolveEnrollmentMutationForEvent,
  selectEnrollmentForWebhookEvent,
  type EnrollmentCandidate,
} from '@/lib/campaign-execution'

export const dynamic = 'force-dynamic'

type NormalizedBrevoEvent = 'delivered' | 'opened' | 'clicked' | 'softBounce' | 'hardBounce' | 'unsubscribed' | 'spam'

function normalizeBrevoEventType(eventType: BrevoWebhookEvent['event']): NormalizedBrevoEvent {
  if (eventType === 'click') return 'clicked'
  return eventType
}

function buildEventKey(event: BrevoWebhookEvent, normalizedEvent: NormalizedBrevoEvent): string {
  const email = (event.email || '').toLowerCase().trim()
  const messageId = event['message-id'] || event.messageId || ''
  const eventTimestamp = String(event.ts_event || event.ts || event.date || '')
  return `${email}:${normalizedEvent}:${messageId}:${eventTimestamp}`
}

/**
 * POST /api/webhooks/brevo
 *
 * Receives engagement events from Brevo and writes them back to xm-crm:
 * - Logs to activities table (type: 'email_received' for opens, 'email_sent' for delivered)
 * - Updates contacts.email_status (bounced, unsubscribed)
 * - Updates contacts.last_engaged_at (on open/click)
 * - Updates contacts.email_opted_out (on unsubscribed/spam)
 * - Updates drip_enrollments (if event maps to a campaign)
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const verificationError = verifyBrevoWebhookRequest(req, rawBody)
  if (verificationError) return verificationError

  let event: BrevoWebhookEvent
  try {
    event = JSON.parse(rawBody) as BrevoWebhookEvent
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!event?.event || !event?.email) {
    return NextResponse.json({ error: 'Invalid Brevo webhook payload' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const normalizedEvent = normalizeBrevoEventType(event.event)
  const eventKey = buildEventKey(event, normalizedEvent)
  const occurredAt = new Date(event.date || event.ts_event || event.ts || Date.now()).toISOString()

  // ── Find contact by email ───────────────────────────────────────────────
  const { data: contact } = await supabase
    .from('contacts')
    .select('id, email_status, email_opted_out')
    .eq('email', event.email?.toLowerCase().trim())
    .maybeSingle()

  if (!contact) {
    // Unknown contact — log and ignore
    console.warn(`[brevo-webhook] Unknown email: ${event.email}`)
    return NextResponse.json({ ok: true, ignored: true })
  }

  // Deduplicate webhook retries/replays by a stable event key.
  const { data: duplicate } = await supabase
    .from('activities')
    .select('id')
    .eq('contact_id', contact.id)
    .contains('metadata', { event_key: eventKey })
    .limit(1)
    .maybeSingle()

  if (duplicate?.id) {
    return NextResponse.json({ ok: true, duplicate: true, processed: normalizedEvent })
  }

  const now = new Date().toISOString()

  const { data: activeEnrollments } = await supabase
    .from('drip_enrollments')
    .select('id, campaign_id, current_step, status, last_email_sent_at, completed_at')
    .eq('contact_id', contact.id)
    .eq('status', 'active')

  let matchedEnrollment: EnrollmentCandidate | null = null
  if ((activeEnrollments || []).length > 0) {
    const campaignIds = (activeEnrollments || []).map((item) => item.campaign_id)
    const { data: campaigns } = await supabase
      .from('drip_campaigns')
      .select('id, title, sequence')
      .in('id', campaignIds)

    const campaignMap = new Map(
      (campaigns || []).map((item) => [
        item.id,
        {
          title: String(item.title || ''),
          sequence: item.sequence as EnrollmentCandidate['sequence'],
        },
      ]),
    )

    const candidates: EnrollmentCandidate[] = (activeEnrollments || []).map((item) => ({
      id: item.id,
      campaign_id: item.campaign_id,
      current_step: item.current_step,
      status: item.status,
      last_email_sent_at: item.last_email_sent_at,
      completed_at: item.completed_at,
      campaign_title: campaignMap.get(item.campaign_id)?.title || '',
      sequence: campaignMap.get(item.campaign_id)?.sequence || null,
    }))

    matchedEnrollment = selectEnrollmentForWebhookEvent(candidates, event.camp_name)
  }

  // ── Update contact fields based on event ─────────────────────────────────
  const contactUpdate: Record<string, unknown> = {}

  switch (normalizedEvent) {
    case 'opened':
    case 'clicked':
      contactUpdate.last_engaged_at = now
      // Reset health score if it was low (re-engagement signal)
      break

    case 'hardBounce':
      contactUpdate.email_status = 'bounced'
      await supabase
        .from('drip_enrollments')
        .update({ status: 'exited_by_rule', exit_reason: normalizedEvent, completed_at: occurredAt })
        .eq('contact_id', contact.id)
        .eq('status', 'active')
      break

    case 'softBounce':
      // Don't mark as bounced on soft bounce — just log
      break

    case 'unsubscribed':
    case 'spam':
      contactUpdate.email_opted_out = true
      contactUpdate.email_status = 'unsubscribed'
      // Remove from all drip enrollments
      await supabase
        .from('drip_enrollments')
        .update({ status: 'unsubscribed', exit_reason: normalizedEvent, completed_at: occurredAt })
        .eq('contact_id', contact.id)
        .eq('status', 'active')
      break

    case 'delivered':
      // No contact update needed
      break
  }

  if (Object.keys(contactUpdate).length > 0) {
    await supabase.from('contacts').update(contactUpdate).eq('id', contact.id)
  }

  const enrollmentMutation = matchedEnrollment
    ? resolveEnrollmentMutationForEvent(normalizedEvent, matchedEnrollment, occurredAt)
    : null

  if (matchedEnrollment && enrollmentMutation && normalizedEvent === 'delivered') {
    await supabase
      .from('drip_enrollments')
      .update(enrollmentMutation)
      .eq('id', matchedEnrollment.id)
  }

  // ── Log to activities table ───────────────────────────────────────────────
  const activityType = normalizedEvent === 'opened' || normalizedEvent === 'clicked'
    ? 'email_received'
    : 'email_sent'

  await supabase.from('activities').insert({
    contact_id: contact.id,
    type:       activityType,
    channel:    'email',
    subject:    event.subject || 'Email campaign',
    body:       `Brevo event: ${normalizedEvent}${event.link ? ` — clicked: ${event.link}` : ''}`,
    metadata: {
      provider:      'brevo',
      provider_event_id: eventKey,
      event_key:     eventKey,
      brevo_event:   normalizedEvent,
      campaign_id:   matchedEnrollment?.campaign_id || null,
      message_id:    event['message-id'] || event.messageId,
      campaign_name: event.camp_name || null,
      link_clicked:  event.link || null,
      ts_event:      event.ts_event || event.ts,
    },
    created_at: now,
  })

  // ── Recalculate health score ──────────────────────────────────────────────
  if (normalizedEvent === 'opened' || normalizedEvent === 'clicked') {
    // Increment health score (capped at 100)
    const { data: curr } = await supabase
      .from('contacts')
      .select('health_score')
      .eq('id', contact.id)
      .single()

    const currentScore = curr?.health_score ?? 30
    const increment = normalizedEvent === 'clicked' ? 10 : 5
    const newScore = Math.min(100, currentScore + increment)
    await supabase.from('contacts').update({ health_score: newScore }).eq('id', contact.id)
  }

  return NextResponse.json({
    ok: true,
    processed: normalizedEvent,
    matchedCampaignId: matchedEnrollment?.campaign_id || null,
    enrollmentUpdated: Boolean(matchedEnrollment && enrollmentMutation && normalizedEvent === 'delivered'),
  })
}
