import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardRole } from '@/lib/api-security'
import { supabaseAdmin } from '@/lib/supabase'
import { logCampaignAuditEvent } from '@/lib/campaign-audit'
import { runCampaignPreflight } from '@/lib/campaign-preflight'
import type { CampaignDraftPayload } from '@/lib/campaign-draft'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, context: RouteContext) {
  const forbidden = requireDashboardRole(req, 'sales')
  if (forbidden) return forbidden

  try {
    const { id } = await context.params

    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from('drip_campaigns')
      .select('title, goal, campaign_type, target_segment, exit_conditions, sequence')
      .eq('id', id)
      .single()

    if (campaignError || !campaign) {
      return NextResponse.json({ ok: false, error: 'Campaign not found' }, { status: 404 })
    }

    const preflight = await runCampaignPreflight({
      title: String(campaign.title || ''),
      goal: String(campaign.goal || ''),
      campaign_type: campaign.campaign_type,
      target_segment: (campaign.target_segment as Record<string, unknown>) || {},
      exit_conditions: (campaign.exit_conditions as Record<string, unknown>) || {},
      sequence: (campaign.sequence as CampaignDraftPayload['sequence']) || { steps: [], branches: [] },
      status: 'draft',
    })

    if (!preflight.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Campaign is not activate-ready',
          preflight,
        },
        { status: 400 },
      )
    }

    const { data, error } = await supabaseAdmin
      .from('drip_campaigns')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, status')
      .single()

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    await logCampaignAuditEvent({
      action: 'activate',
      campaignId: id,
      actor: 'dashboard',
      metadata: {
        resultingStatus: data.status,
        estimatedAudience: preflight.audienceEstimate.total,
      },
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
