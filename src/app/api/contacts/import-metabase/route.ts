import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import { queryMetabase } from '@/lib/metabase'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireDashboardRole } from '@/lib/api-security'

export const dynamic = 'force-dynamic'

// Vendor IDs to always exclude (test accounts)
const TEST_VENDOR_IDS = [83, 121, 122, 211, 356, 397, 399, 403, 410, 417, 419, 425, 426, 521, 843, 926, 939, 976]

// Determine segment based on order history
function classifyVendor(totalOrders: number, lastOrderDate: string | null): {
  type: 'customer' | 'lead'
  status: string
  healthScore: number
  segment: 'active_customer' | 'lapsed_customer' | 'warm_lead' | 'never_ordered'
  tags: string[]
} {
  const now = new Date()

  if (!lastOrderDate || totalOrders === 0) {
    return {
      type: 'lead',
      status: 'new',
      healthScore: 30,
      segment: 'never_ordered',
      tags: ['never_ordered', 'warm_lead'],
    }
  }

  const last = new Date(lastOrderDate)
  const daysSinceLast = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24))

  if (daysSinceLast <= 30) {
    return {
      type: 'customer',
      status: 'won',
      healthScore: 85,
      segment: 'active_customer',
      tags: ['active_customer', 'shipped_recently'],
    }
  }

  if (daysSinceLast <= 90) {
    return {
      type: 'customer',
      status: 'won',
      healthScore: 55,
      segment: 'lapsed_customer',
      tags: ['lapsed_customer', `last_order_${daysSinceLast}d_ago`],
    }
  }

  // > 90 days — dormant
  return {
    type: 'customer',
    status: 'won',
    healthScore: 20,
    segment: 'lapsed_customer',
    tags: ['dormant_customer', `last_order_${daysSinceLast}d_ago`],
  }
}

export async function POST(req: NextRequest) {
  const forbidden = requireDashboardRole(req, 'ops')
  if (forbidden) return forbidden

  const startedAt = new Date().toISOString()
  const supabase = getSupabaseAdmin()

  // ── 1. Pull all vendors from Metabase ───────────────────────────────────
  const excludeList = TEST_VENDOR_IDS.join(',')

  let vendors: Array<{
    vendor_id: number
    firstname: string
    lastname: string
    email: string
    spoc_id: number | null
    total_orders: number
    last_order_date: string | null
  }>

  try {
    const rows = await queryMetabase(`
      SELECT
        v.vendor_id,
        v.firstname,
        v.lastname,
        v.email,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(v.meta_data, '$.user_admin_id')) AS UNSIGNED) AS spoc_id,
        COUNT(o.order_id)                                                             AS total_orders,
        MAX(o.date_added)                                                             AS last_order_date
      FROM vendor v
      LEFT JOIN oc_order o ON o.vendor_id = v.vendor_id
        AND o.order_status_id NOT IN (0, 11)
      WHERE v.vendor_id NOT IN (${excludeList})
        AND (v.email IS NOT NULL AND v.email != '')
      GROUP BY v.vendor_id, v.firstname, v.lastname, v.email, v.meta_data
      ORDER BY v.vendor_id
    `)
    vendors = rows.map(r => ({
      vendor_id:       Number(r.vendor_id),
      firstname:       String(r.firstname || ''),
      lastname:        String(r.lastname || ''),
      email:           String(r.email || '').toLowerCase().trim(),
      spoc_id:         r.spoc_id ? Number(r.spoc_id) : null,
      total_orders:    Number(r.total_orders || 0),
      last_order_date: r.last_order_date ? String(r.last_order_date) : null,
    }))
  } catch (err) {
    return NextResponse.json({ error: `Metabase query failed: ${String(err)}` }, { status: 500 })
  }

  // ── 2. Pull seller_metadata from Supabase for enrichment ─────────────────
  const vendorIds = vendors.map(v => v.vendor_id)
  const { data: metaRows } = await supabase
    .from('seller_metadata')
    .select('seller_id, phone, whatsapp, business_name, city, state, customer_tier, email')
    .in('seller_id', vendorIds)

  type MetaRow = { seller_id: number; phone: string | null; whatsapp: string | null; business_name: string | null; city: string | null; state: string | null; customer_tier: string | null; email: string | null }
  const metaByVendorId = new Map<number, MetaRow>()
  for (const m of (metaRows || []) as MetaRow[]) {
    metaByVendorId.set(m.seller_id, m)
  }

  // ── 3. Pull existing contacts by metabase_vendor_id to detect updates ────
  const { data: existingContacts } = await supabase
    .from('contacts')
    .select('id, metabase_vendor_id, email')
    .in('metabase_vendor_id', vendorIds)

  const existingByVendorId = new Map<number, string>()  // vendor_id → contact.id
  for (const c of existingContacts || []) {
    if (c.metabase_vendor_id) existingByVendorId.set(c.metabase_vendor_id, c.id)
  }

  // ── 4. Upsert contacts ────────────────────────────────────────────────────
  const batchName = `metabase_sync_${startedAt.slice(0, 10)}`
  const stats = { created: 0, updated: 0, skipped: 0, errors: 0 }
  const errors: string[] = []

  // Process in batches of 50 to avoid Supabase rate limits
  const BATCH_SIZE = 50
  for (let i = 0; i < vendors.length; i += BATCH_SIZE) {
    const batch = vendors.slice(i, i + BATCH_SIZE)

    const upserts = batch.map(v => {
      const meta = metaByVendorId.get(v.vendor_id)
      const classification = classifyVendor(v.total_orders, v.last_order_date)
      const contactPerson = [v.firstname, v.lastname].filter(Boolean).join(' ') || 'Unknown'
      const companyName = meta?.business_name || contactPerson
      const phone = meta?.phone || meta?.whatsapp || null
      const emailToUse = meta?.email || v.email

      // Skip if no valid email
      if (!emailToUse || !emailToUse.includes('@')) return null

      const existingId = existingByVendorId.get(v.vendor_id)

      const record = {
        ...(existingId ? { id: existingId } : {}),
        type:               classification.type,
        status:             classification.status,
        company_name:       companyName,
        contact_person:     contactPerson,
        email:              emailToUse,
        phone:              phone,
        source:             'website' as const,
        tags:               classification.tags,
        health_score:       classification.healthScore,
        score:              classification.type === 'customer' ? 70 : 30,
        import_source:      'metabase' as const,
        import_batch:       batchName,
        metabase_vendor_id: v.vendor_id,
        custom_fields: {
          spoc_id:         v.spoc_id,
          total_orders:    v.total_orders,
          last_order_date: v.last_order_date,
          city:            meta?.city || null,
          state:           meta?.state || null,
          customer_tier:   meta?.customer_tier || null,
          segment:         classification.segment,
        },
        updated_at: new Date().toISOString(),
        ...(!existingId ? { created_at: new Date().toISOString() } : {}),
      }

      return { record, isNew: !existingId }
    }).filter(Boolean) as { record: Record<string, unknown>; isNew: boolean }[]

    if (upserts.length === 0) continue

    const { error } = await supabase
      .from('contacts')
      .upsert(upserts.map(u => u.record), { onConflict: 'metabase_vendor_id' })

    if (error) {
      errors.push(`Batch ${i / BATCH_SIZE + 1}: ${error.message}`)
      stats.errors += upserts.length
    } else {
      for (const u of upserts) {
        if (u.isNew) stats.created++; else stats.updated++
      }
    }
  }

  // ── 5. Return summary ─────────────────────────────────────────────────────
  const segmentCounts = vendors.reduce((acc, v) => {
    const seg = classifyVendor(v.total_orders, v.last_order_date).segment
    acc[seg] = (acc[seg] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return NextResponse.json({
    ok: true,
    summary: {
      total_vendors_fetched: vendors.length,
      ...stats,
      batch_name: batchName,
    },
    segments: segmentCounts,
    errors: errors.length > 0 ? errors : undefined,
  })
}
