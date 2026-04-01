import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardRole } from '@/lib/api-security'
import { supabaseAdmin } from '@/lib/supabase'
import { logCampaignAuditEvent } from '@/lib/campaign-audit'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

type EnrollBody = {
  batch_name?: string
  segment?: string
  contact_ids?: string[]
}

export async function POST(req: NextRequest, context: RouteContext) {
  const forbidden = requireDashboardRole(req, 'sales')
  if (forbidden) return forbidden

  try {
    const { id: campaignId } = await context.params
    const body = (await req.json().catch(() => ({}))) as EnrollBody

    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from('drip_campaigns')
      .select('id, status, title')
      .eq('id', campaignId)
      .single()

    if (campaignError || !campaign) {
      return NextResponse.json({ ok: false, error: 'Campaign not found' }, { status: 404 })
    }

    let contactsQuery = supabaseAdmin.from('contacts').select('id')

    if (Array.isArray(body.contact_ids) && body.contact_ids.length > 0) {
      contactsQuery = contactsQuery.in('id', body.contact_ids)
    } else if (body.batch_name) {
      contactsQuery = contactsQuery.eq('import_batch', body.batch_name)
    } else if (body.segment) {
      contactsQuery = contactsQuery.contains('custom_fields', { segment: body.segment })
    } else {
      return NextResponse.json(
        {
          ok: false,
          error: 'Provide one of: contact_ids, batch_name, or segment',
        },
        { status: 400 },
      )
    }

    const { data: contacts, error: contactsError } = await contactsQuery.limit(5000)
    if (contactsError) {
      return NextResponse.json({ ok: false, error: contactsError.message }, { status: 500 })
    }

    const contactIds = (contacts || []).map((contact) => contact.id)
    if (contactIds.length === 0) {
      return NextResponse.json({ ok: true, enrolled: 0, skipped: 0, totalCandidates: 0 })
    }

    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from('drip_enrollments')
      .select('contact_id')
      .eq('campaign_id', campaignId)
      .in('contact_id', contactIds)

    if (existingError) {
      return NextResponse.json({ ok: false, error: existingError.message }, { status: 500 })
    }

    const existingContactIds = new Set((existingRows || []).map((row) => row.contact_id))
    const toEnroll = contactIds.filter((contactId) => !existingContactIds.has(contactId))

    if (toEnroll.length === 0) {
      return NextResponse.json({
        ok: true,
        enrolled: 0,
        skipped: contactIds.length,
        totalCandidates: contactIds.length,
      })
    }

    const now = new Date().toISOString()
    const rows = toEnroll.map((contactId) => ({
      campaign_id: campaignId,
      contact_id: contactId,
      current_step: 1,
      status: 'active',
      exit_reason: null,
      enrolled_at: now,
      completed_at: null,
      last_email_sent_at: null,
    }))

    const { error: insertError } = await supabaseAdmin.from('drip_enrollments').insert(rows)
    if (insertError) {
      return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 })
    }

    await logCampaignAuditEvent({
      action: 'enroll',
      campaignId,
      actor: 'dashboard',
      metadata: {
        enrolled: toEnroll.length,
        skipped: contactIds.length - toEnroll.length,
        totalCandidates: contactIds.length,
        source: body.batch_name ? 'batch_name' : body.segment ? 'segment' : 'contact_ids',
      },
    })

    return NextResponse.json({
      ok: true,
      campaign: { id: campaign.id, title: campaign.title },
      enrolled: toEnroll.length,
      skipped: contactIds.length - toEnroll.length,
      totalCandidates: contactIds.length,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
