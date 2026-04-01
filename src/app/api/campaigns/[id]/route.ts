import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardRole, requireDashboardSession } from '@/lib/api-security'
import { supabaseAdmin, type CampaignStatus, type CampaignType } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type UpdateCampaignBody = {
  title?: string
  goal?: string
  campaign_type?: CampaignType
  target_segment?: Record<string, unknown>
  exit_conditions?: Record<string, unknown>
  sequence?: Record<string, unknown>
  status?: CampaignStatus
  approved_by?: string | null
  performance_data?: Record<string, unknown> | null
}

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, context: RouteContext) {
  const unauthorized = requireDashboardSession(req)
  if (unauthorized) return unauthorized

  try {
    const { id } = await context.params
    const { data, error } = await supabaseAdmin
      .from('drip_campaigns')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 404 })
    }

    return NextResponse.json({ ok: true, item: data })
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

export async function PATCH(req: NextRequest, context: RouteContext) {
  const forbidden = requireDashboardRole(req, 'sales')
  if (forbidden) return forbidden

  try {
    const { id } = await context.params
    const body = (await req.json()) as UpdateCampaignBody

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (typeof body.title === 'string') updatePayload.title = body.title.trim()
    if (typeof body.goal === 'string') updatePayload.goal = body.goal.trim()
    if (typeof body.campaign_type === 'string') updatePayload.campaign_type = body.campaign_type
    if (body.target_segment && typeof body.target_segment === 'object') updatePayload.target_segment = body.target_segment
    if (body.exit_conditions && typeof body.exit_conditions === 'object') updatePayload.exit_conditions = body.exit_conditions
    if (body.sequence && typeof body.sequence === 'object') updatePayload.sequence = body.sequence
    if (typeof body.status === 'string') updatePayload.status = body.status
    if (body.approved_by === null || typeof body.approved_by === 'string') updatePayload.approved_by = body.approved_by
    if (body.performance_data === null || typeof body.performance_data === 'object') {
      updatePayload.performance_data = body.performance_data
    }

    const { data, error } = await supabaseAdmin
      .from('drip_campaigns')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, item: data })
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
