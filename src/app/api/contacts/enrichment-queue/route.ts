import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * GET  /api/contacts/enrichment-queue  — list pending items
 * POST /api/contacts/enrichment-queue/:id — mark as enriched / skipped
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || 'pending'
  const page   = Number(searchParams.get('page') || '1')
  const limit  = Number(searchParams.get('limit') || '50')
  const batch  = searchParams.get('batch')

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

  const { data, error, count } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Get total count for pagination
  const { count: total } = await supabase
    .from('enrichment_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', status === 'all' ? undefined : status)

  return NextResponse.json({
    items: data || [],
    pagination: { page, limit, total: total || 0, totalPages: Math.ceil((total || 0) / limit) },
  })
}

export async function PATCH(req: Request) {
  const body = await req.json()
  const { queue_id, action, enriched_fields, notes } = body as {
    queue_id: string
    action: 'enriched' | 'skipped'
    enriched_fields?: Record<string, string>
    notes?: string
  }

  if (!queue_id || !action) {
    return NextResponse.json({ error: 'queue_id and action required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // If enriched, apply fields to the contact
  if (action === 'enriched' && enriched_fields) {
    const { data: qItem } = await supabase
      .from('enrichment_queue')
      .select('contact_id')
      .eq('id', queue_id)
      .single()

    if (qItem?.contact_id) {
      await supabase
        .from('contacts')
        .update({ ...enriched_fields, updated_at: new Date().toISOString() })
        .eq('id', qItem.contact_id)
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
