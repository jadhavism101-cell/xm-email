import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireDashboardSession } from '@/lib/api-security'

export const dynamic = 'force-dynamic'

const WEBHOOK_EVENT_TYPES = [
  'delivered',
  'opened',
  'clicked',
  'softBounce',
  'hardBounce',
  'unsubscribed',
  'spam',
] as const

type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

async function countEligibleContacts() {
  const supabase = getSupabaseAdmin()
  const { count } = await supabase
    .from('contacts')
    .select('*', { count: 'exact', head: true })
    .eq('email_opted_out', false)
    .neq('email_status', 'bounced')
    .not('email', 'is', null)
  return count || 0
}

async function countSyncedContacts() {
  const supabase = getSupabaseAdmin()
  const { count } = await supabase
    .from('contacts')
    .select('*', { count: 'exact', head: true })
    .eq('email_opted_out', false)
    .neq('email_status', 'bounced')
    .not('email', 'is', null)
    .not('brevo_contact_id', 'is', null)
  return count || 0
}

async function countPendingContacts() {
  const supabase = getSupabaseAdmin()
  const { count } = await supabase
    .from('contacts')
    .select('*', { count: 'exact', head: true })
    .eq('email_opted_out', false)
    .neq('email_status', 'bounced')
    .not('email', 'is', null)
    .is('brevo_contact_id', null)
  return count || 0
}

async function countSyncErrors() {
  const supabase = getSupabaseAdmin()
  const { count } = await supabase
    .from('contacts')
    .select('*', { count: 'exact', head: true })
    .contains('custom_fields', { brevo_sync_status: 'error' })
  return count || 0
}

async function countWebhookEventsSince(sinceIso: string) {
  const supabase = getSupabaseAdmin()
  const { count } = await supabase
    .from('activities')
    .select('*', { count: 'exact', head: true })
    .eq('channel', 'email')
    .gte('created_at', sinceIso)
    .not('metadata', 'is', null)
    .contains('metadata', { brevo_event: 'delivered' })

  const delivered = count || 0

  const counts = await Promise.all(
    WEBHOOK_EVENT_TYPES.filter((eventType) => eventType !== 'delivered').map(async (eventType) => {
      const { count: eventCount } = await supabase
        .from('activities')
        .select('*', { count: 'exact', head: true })
        .eq('channel', 'email')
        .gte('created_at', sinceIso)
        .not('metadata', 'is', null)
        .contains('metadata', { brevo_event: eventType })

      return [eventType, eventCount || 0] as const
    }),
  )

  const byEvent = Object.fromEntries([['delivered', delivered], ...counts]) as Record<WebhookEventType, number>
  const total = Object.values(byEvent).reduce((sum, current) => sum + current, 0)

  return { total, byEvent }
}

async function getSyncDlq(limit: number) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('contacts')
    .select('id, email, company_name, brevo_contact_id, updated_at, custom_fields')
    .contains('custom_fields', { brevo_sync_status: 'error' })
    .order('updated_at', { ascending: false })
    .limit(limit)

  return (data || []).map((row) => {
    const customFields = (row.custom_fields || {}) as Record<string, unknown>
    return {
      contact_id: row.id,
      email: row.email,
      company_name: row.company_name,
      brevo_contact_id: row.brevo_contact_id,
      last_error: String(customFields.brevo_last_sync_error || 'unknown_error'),
      last_error_at: String(customFields.brevo_last_sync_error_at || row.updated_at),
      last_attempt_at: String(customFields.brevo_last_sync_attempt_at || row.updated_at),
    }
  })
}

export async function GET(req: NextRequest) {
  const unauthorized = requireDashboardSession(req)
  if (unauthorized) return unauthorized

  const now = new Date()
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [eligible, synced, pending, syncErrors, events24h, events7d, dlqRows] = await Promise.all([
    countEligibleContacts(),
    countSyncedContacts(),
    countPendingContacts(),
    countSyncErrors(),
    countWebhookEventsSince(since24h),
    countWebhookEventsSince(since7d),
    getSyncDlq(25),
  ])

  const syncCoverage = eligible > 0 ? Number(((synced / eligible) * 100).toFixed(2)) : 0

  return NextResponse.json({
    generated_at: now.toISOString(),
    summary: {
      eligible_contacts: eligible,
      synced_contacts: synced,
      pending_contacts: pending,
      sync_errors: syncErrors,
      sync_coverage_percent: syncCoverage,
      webhook_events_24h: events24h.total,
      webhook_events_7d: events7d.total,
    },
    webhook_events_7d: events7d.byEvent,
    webhook_events_24h: events24h.byEvent,
    sync_dlq: dlqRows,
  })
}
