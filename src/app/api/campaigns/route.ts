import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardRole, requireDashboardSession } from '@/lib/api-security'
import { supabaseAdmin, type CampaignStatus, type CampaignType } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type CreateCampaignBody = {
  title?: string
  goal?: string
  campaign_type?: CampaignType
  target_segment?: Record<string, unknown>
  exit_conditions?: Record<string, unknown>
  sequence?: Record<string, unknown>
  status?: CampaignStatus
}

export async function GET(req: NextRequest) {
  const unauthorized = requireDashboardSession(req)
  if (unauthorized) return unauthorized

  try {
    const status = req.nextUrl.searchParams.get('status')
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') || '50'), 1), 200)
    const page = Math.max(Number(req.nextUrl.searchParams.get('page') || '1'), 1)

    let query = supabaseAdmin
      .from('drip_campaigns')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error, count } = await query
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      items: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
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

export async function POST(req: NextRequest) {
  const forbidden = requireDashboardRole(req, 'sales')
  if (forbidden) return forbidden

  try {
    const body = (await req.json()) as CreateCampaignBody

    const title = String(body.title || '').trim()
    const goal = String(body.goal || '').trim()
    if (!title || !goal) {
      return NextResponse.json({ ok: false, error: 'title and goal are required' }, { status: 400 })
    }

    const payload = {
      title,
      goal,
      campaign_type: (body.campaign_type || 'custom') as CampaignType,
      target_segment: body.target_segment || {},
      exit_conditions: body.exit_conditions || {},
      sequence: body.sequence || { steps: [], branches: [] },
      status: (body.status || 'draft') as CampaignStatus,
      created_by: 'dashboard',
      approved_by: null,
      performance_data: null,
      brevo_automation_id: null,
    }

    const { data, error } = await supabaseAdmin
      .from('drip_campaigns')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, item: data }, { status: 201 })
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
