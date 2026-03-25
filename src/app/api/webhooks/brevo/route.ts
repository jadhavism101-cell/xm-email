import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import type { BrevoWebhookEvent } from '@/lib/brevo'

export const dynamic = 'force-dynamic'

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
export async function POST(req: Request) {
  let event: BrevoWebhookEvent
  try {
    event = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // ── Find contact by email ───────────────────────────────────────────────
  const { data: contact } = await supabase
    .from('contacts')
    .select('id, email_status, email_opted_out')
    .eq('email', event.email?.toLowerCase().trim())
    .single()

  if (!contact) {
    // Unknown contact — log and ignore
    console.warn(`[brevo-webhook] Unknown email: ${event.email}`)
    return NextResponse.json({ ok: true, ignored: true })
  }

  const now = new Date().toISOString()

  // ── Update contact fields based on event ─────────────────────────────────
  const contactUpdate: Record<string, unknown> = {}

  switch (event.event) {
    case 'opened':
    case 'clicked':
      contactUpdate.last_engaged_at = now
      // Reset health score if it was low (re-engagement signal)
      break

    case 'hardBounce':
      contactUpdate.email_status = 'bounced'
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
        .update({ status: 'unsubscribed', exit_reason: event.event })
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

  // ── Log to activities table ───────────────────────────────────────────────
  const activityType = event.event === 'opened' ? 'email_received' :
                       event.event === 'clicked' ? 'email_received' :
                       'email_sent'

  if (['opened', 'clicked', 'unsubscribed', 'spam'].includes(event.event)) {
    await supabase.from('activities').insert({
      contact_id: contact.id,
      type:       activityType,
      channel:    'email',
      subject:    event.subject || 'Email campaign',
      body:       `Brevo event: ${event.event}${event.link ? ` — clicked: ${event.link}` : ''}`,
      metadata: {
        brevo_event:  event.event,
        message_id:   event['message-id'] || event.messageId,
        campaign_name: event.camp_name || null,
        link_clicked:  event.link || null,
        ts_event:      event.ts_event || event.ts,
      },
      created_at: now,
    })
  }

  // ── Recalculate health score ──────────────────────────────────────────────
  if (event.event === 'opened' || event.event === 'clicked') {
    // Increment health score (capped at 100)
    const { data: curr } = await supabase
      .from('contacts')
      .select('health_score')
      .eq('id', contact.id)
      .single()

    const currentScore = curr?.health_score ?? 30
    const increment = event.event === 'clicked' ? 10 : 5
    const newScore = Math.min(100, currentScore + increment)
    await supabase.from('contacts').update({ health_score: newScore }).eq('id', contact.id)
  }

  return NextResponse.json({ ok: true, processed: event.event })
}
