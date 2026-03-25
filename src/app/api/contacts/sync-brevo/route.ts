import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import {
  upsertBrevoContact,
  batchImportBrevoContacts,
  contactToBrevoAttributes,
  BREVO_LISTS,
} from '@/lib/brevo'

export const dynamic = 'force-dynamic'

/**
 * POST /api/contacts/sync-brevo
 *
 * Syncs contacts from Supabase → Brevo.
 * Body (optional):
 *   { contact_ids?: string[] }   — sync specific contacts
 *   { segment?: string }         — 'active_customer' | 'lapsed_customer' | 'warm_lead' | 'new_cold'
 *   {}                           — sync all un-synced or recently-updated contacts
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { contact_ids, segment } = body as { contact_ids?: string[]; segment?: string }

  const supabase = getSupabaseAdmin()

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
  } else if (segment) {
    // Filter by segment tag in custom_fields
    query = query.contains('tags', [segment])
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
    }
  })

  // ── Batch import to Brevo ────────────────────────────────────────────────
  // Use batch import for efficiency, then update brevo_contact_id individually
  const CHUNK = 200
  let totalSynced = 0
  const errors: string[] = []

  for (let i = 0; i < brevoContacts.length; i += CHUNK) {
    const chunk = brevoContacts.slice(i, i + CHUNK)

    // For batch import we don't get back individual IDs, so use individual upsert
    // for the first 50, batch import for the rest
    if (chunk.length <= 50) {
      for (const bc of chunk) {
        const brevoId = await upsertBrevoContact({
          email: bc.email,
          attributes: bc.attributes,
          listIds: bc.listIds,
          updateEnabled: true,
        })
        if (brevoId) {
          await supabase
            .from('contacts')
            .update({ brevo_contact_id: brevoId })
            .eq('id', bc._contactId)
          totalSynced++
        } else {
          errors.push(bc.email)
        }
      }
    } else {
      const result = await batchImportBrevoContacts(
        chunk.map(({ _contactId: _, ...rest }) => rest),
        [BREVO_LISTS.ALL_CONTACTS],
      )
      if (result?.processId) {
        // Mark contacts as synced (no individual IDs from batch)
        const ids = chunk.map(c => c._contactId)
        await supabase.from('contacts').update({ brevo_contact_id: -1 }).in('id', ids)
        totalSynced += chunk.length
      } else {
        errors.push(`Batch ${i / CHUNK + 1} failed`)
      }
    }
  }

  return NextResponse.json({
    ok: true,
    synced: totalSynced,
    total: contacts.length,
    errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
  })
}
