import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardRole } from '@/lib/api-security'
import { supabaseAdmin } from '@/lib/supabase'
import { logCampaignAuditEvent } from '@/lib/campaign-audit'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, context: RouteContext) {
  const forbidden = requireDashboardRole(req, 'sales')
  if (forbidden) return forbidden

  try {
    const { id } = await context.params

    const { data, error } = await supabaseAdmin
      .from('drip_campaigns')
      .update({ status: 'paused', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, status')
      .single()

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    await logCampaignAuditEvent({
      action: 'pause',
      campaignId: id,
      actor: 'dashboard',
      metadata: { resultingStatus: data.status },
    })

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
