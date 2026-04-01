import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireDashboardRole, requireDashboardSession } from '@/lib/api-security'

export const dynamic = 'force-dynamic'

const ALLOWED_STATUS = new Set(['pending', 'enriched', 'skipped', 'all'])
const ALLOWED_ACTION = new Set(['enriched', 'skipped'])

function toInt(value: string | null, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.floor(n) : fallback
}

/**
 * GET  /api/contacts/enrichment-queue  — list pending items
 * POST /api/contacts/enrichment-queue/:id — mark as enriched / skipped
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireDashboardSession(req)
  if (unauthorized) return unauthorized

  const { searchParams } = new URL(req.url)
  const status = (searchParams.get('status') || 'pending').trim()
  const page = Math.max(toInt(searchParams.get('page'), 1), 1)
  const limit = Math.min(Math.max(toInt(searchParams.get('limit'), 50), 1), 200)
  const batch = (searchParams.get('batch') || '').trim()

  if (!ALLOWED_STATUS.has(status)) {
    return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  let query = supabase
    .from('enrichment_queue')
    .select(`
      id, import_batch, missing_fields, status, notes, created_at, updated_at,
      contacts (
        id, email, company_name, contact_person, phone, source, type, status,
        tags, health_score, score, created_at
      )
    `)
    .order('created_at', { ascending: true })
    .range((page - 1) * limit, page * limit - 1)

  if (status !== 'all') query = query.eq('status', status)
  if (batch) query = query.eq('import_batch', batch)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Get total count for pagination
  let totalQuery = supabase
    .from('enrichment_queue')
    .select('*', { count: 'exact', head: true })

  if (status !== 'all') totalQuery = totalQuery.eq('status', status)
  if (batch) totalQuery = totalQuery.eq('import_batch', batch)

  const { count: total, error: totalError } = await totalQuery
  if (totalError) return NextResponse.json({ error: totalError.message }, { status: 500 })

  return NextResponse.json({
    items: data || [],
    pagination: { page, limit, total: total || 0, totalPages: Math.ceil((total || 0) / limit) },
  })
}

export async function PATCH(req: NextRequest) {
  const forbidden = requireDashboardRole(req, 'ops')
  if (forbidden) return forbidden

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { queue_id, action, enriched_fields, notes } = body as {
    queue_id: string
    action: 'enriched' | 'skipped'
    enriched_fields?: Record<string, string>
    notes?: string
  }

  if (!queue_id || !action) {
    return NextResponse.json({ error: 'queue_id and action required' }, { status: 400 })
  }
  if (!ALLOWED_ACTION.has(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }
  if (notes != null && typeof notes !== 'string') {
    return NextResponse.json({ error: 'notes must be a string' }, { status: 400 })
  }
  if (enriched_fields != null && (typeof enriched_fields !== 'object' || Array.isArray(enriched_fields))) {
    return NextResponse.json({ error: 'enriched_fields must be an object' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // If enriched, apply fields to the contact
  if (action === 'enriched' && enriched_fields) {
    const { data: qItem, error: queueReadError } = await supabase
      .from('enrichment_queue')
      .select('contact_id')
      .eq('id', queue_id)
      .single()

    if (queueReadError) {
      return NextResponse.json({ error: queueReadError.message }, { status: 500 })
    }

    if (qItem?.contact_id) {
      const { error: contactUpdateError } = await supabase
        .from('contacts')
        .update({ ...enriched_fields, updated_at: new Date().toISOString() })
        .eq('id', qItem.contact_id)

      if (contactUpdateError) {
        return NextResponse.json({ error: contactUpdateError.message }, { status: 500 })
      }
    }
  }

  const { error } = await supabase
    .from('enrichment_queue')
    .update({
      status:      action,
      notes:       notes || null,
      enriched_at: new Date().toISOString(),
    })
    .eq('id', queue_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
