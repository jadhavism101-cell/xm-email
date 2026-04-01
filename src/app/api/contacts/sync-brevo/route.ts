import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import {
  upsertBrevoContactResult,
  contactToBrevoAttributes,
  BREVO_LISTS,
} from '@/lib/brevo'
import { requireDashboardRole } from '@/lib/api-security'

export const dynamic = 'force-dynamic'

function buildSyncMetadata(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...current,
    ...patch,
  }
}

/**
 * POST /api/contacts/sync-brevo
 *
 * Syncs contacts from Supabase → Brevo.
 * Body (optional):
 *   { contact_ids?: string[] }   — sync specific contacts
 *   { batch_name?: string }      — sync contacts from one import batch
 *   { segment?: string }         — 'active_customer' | 'lapsed_customer' | 'warm_lead' | 'new_cold'
 *   {}                           — sync all un-synced or recently-updated contacts
 */
export async function POST(req: NextRequest) {
  const forbidden = requireDashboardRole(req, 'ops')
  if (forbidden) return forbidden

  const body = await req.json().catch(() => ({}))
  const { contact_ids, batch_name, segment } = body as {
    contact_ids?: string[]
    batch_name?: string
    segment?: string
  }

  const supabase = getSupabaseAdmin()

  if (contact_ids != null && (!Array.isArray(contact_ids) || contact_ids.some((item) => typeof item !== 'string'))) {
    return NextResponse.json({ ok: false, error: 'contact_ids must be an array of strings' }, { status: 400 })
  }
  if (batch_name != null && typeof batch_name !== 'string') {
    return NextResponse.json({ ok: false, error: 'batch_name must be a string' }, { status: 400 })
  }
  if (segment != null && typeof segment !== 'string') {
    return NextResponse.json({ ok: false, error: 'segment must be a string' }, { status: 400 })
  }

  // ── Build query ─────────────────────────────────────────────────────────
  let query = supabase
    .from('contacts')
    .select(`
      id, type, status, company_name, contact_person, email, phone, source,
      score, health_score, created_at, tags, assigned_to, import_source,
      email_opted_out, email_status, custom_fields
    `)
    .eq('email_opted_out', false)
    .neq('email_status', 'bounced')
    .not('email', 'is', null)

  if (contact_ids && contact_ids.length > 0) {
    query = query.in('id', contact_ids)
  } else if (batch_name) {
    query = query.eq('import_batch', batch_name)
  } else if (segment) {
    // Filter by canonical segment field in custom_fields.
    query = query.contains('custom_fields', { segment })
  } else {
    // Sync contacts without a brevo_contact_id yet (un-synced)
    query = query.is('brevo_contact_id', null)
  }

  query = query.limit(500)

  const { data: contacts, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!contacts || contacts.length === 0) {
    return NextResponse.json({ ok: true, synced: 0, message: 'No contacts to sync' })
  }

  // ── Fetch assigned user names/emails ────────────────────────────────────
  const assignedIds = [...new Set(contacts.map(c => c.assigned_to).filter(Boolean) as string[])]
  const userMap = new Map<string, { name: string; email: string }>()
  if (assignedIds.length > 0) {
    const { data: users } = await supabase
      .from('user_profiles')
      .select('id, name, email')
      .in('id', assignedIds)
    for (const u of users || []) userMap.set(u.id, { name: u.name, email: u.email })
  }

  // ── Map contacts to Brevo format ─────────────────────────────────────────
  const brevoContacts = contacts.map(c => {
    const user = c.assigned_to ? userMap.get(c.assigned_to) : null
    const customFields = (c.custom_fields || {}) as Record<string, unknown>
    const segment = customFields.segment as string | undefined

    // Determine target list based on segment
    const listId = segment === 'active_customer'  ? BREVO_LISTS.ACTIVE_CUSTOMERS :
                   segment === 'lapsed_customer'  ? BREVO_LISTS.LAPSED_CUSTOMERS :
                   segment === 'warm_lead'         ? BREVO_LISTS.WARM_LEADS :
                   BREVO_LISTS.COLD_CSV

    return {
      email: c.email,
      attributes: contactToBrevoAttributes({
        company_name:       c.company_name,
        contact_person:     c.contact_person,
        phone:              c.phone,
        source:             c.source,
        status:             c.status,
        type:               c.type,
        score:              c.score,
        health_score:       c.health_score,
        created_at:         c.created_at,
        tags:               c.tags || [],
        assigned_to_name:   user?.name || null,
        assigned_to_email:  user?.email || null,
      }),
      listIds: [listId, BREVO_LISTS.ALL_CONTACTS],
      _contactId: c.id,
      _customFields: customFields,
    }
  })

  // ── Sync to Brevo ────────────────────────────────────────────────────────
  // Use per-contact upsert to persist real Brevo contact IDs (no sentinel writes).
  const CHUNK = 200
  let totalSynced = 0
  const errors: Array<{ email: string; error: string }> = []

  for (let i = 0; i < brevoContacts.length; i += CHUNK) {
    const chunk = brevoContacts.slice(i, i + CHUNK)

    for (const bc of chunk) {
      const attemptAt = new Date().toISOString()

      const syncResult = await upsertBrevoContactResult({
        email: bc.email,
        attributes: bc.attributes,
        listIds: bc.listIds,
        updateEnabled: true,
      })

      const brevoId = syncResult.id

      if (brevoId) {
        const nextCustomFields = buildSyncMetadata(bc._customFields, {
          brevo_sync_status: 'ok',
          brevo_last_sync_attempt_at: attemptAt,
          brevo_synced_at: attemptAt,
          brevo_last_sync_error: null,
          brevo_last_sync_error_at: null,
          brevo_last_sync_lists: bc.listIds,
        })

        await supabase
          .from('contacts')
          .update({
            brevo_contact_id: brevoId,
            custom_fields: nextCustomFields,
            updated_at: attemptAt,
          })
          .eq('id', bc._contactId)
        totalSynced++
      } else {
        const nextCustomFields = buildSyncMetadata(bc._customFields, {
          brevo_sync_status: 'error',
          brevo_last_sync_attempt_at: attemptAt,
          brevo_last_sync_error: syncResult.error || 'upsert_failed',
          brevo_last_sync_error_at: attemptAt,
          brevo_last_sync_lists: bc.listIds,
        })

        await supabase
          .from('contacts')
          .update({
            custom_fields: nextCustomFields,
            updated_at: attemptAt,
          })
          .eq('id', bc._contactId)

        errors.push({ email: bc.email, error: syncResult.error || 'upsert_failed' })
      }
    }
  }

  return NextResponse.json({
    ok: true,
    synced: totalSynced,
    total: contacts.length,
    failed: errors.length,
    batch_name: batch_name || null,
    errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
  })
}
