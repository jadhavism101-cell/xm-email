import { supabaseAdmin, type DripCampaign } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type EnrollmentRow = {
  id: string
  campaign_id: string
  status: string
}

function toPercent(value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0.0%'
  return `${value.toFixed(1)}%`
}

export default async function ActiveCampaignsPage() {
  const { data: campaignsData } = await supabaseAdmin
    .from('drip_campaigns')
    .select('*')
    .eq('status', 'active')
    .order('updated_at', { ascending: false })

  const campaigns = (campaignsData as DripCampaign[]) || []
  const campaignIds = campaigns.map((campaign) => campaign.id)

  const enrollmentMap = new Map<string, { active: number; total: number }>()
  if (campaignIds.length > 0) {
    const { data: enrollmentsData } = await supabaseAdmin
      .from('drip_enrollments')
      .select('id, campaign_id, status')
      .in('campaign_id', campaignIds)

    for (const row of (enrollmentsData as EnrollmentRow[] | null) || []) {
      const existing = enrollmentMap.get(row.campaign_id) || { active: 0, total: 0 }
      existing.total += 1
      if (row.status === 'active') existing.active += 1
      enrollmentMap.set(row.campaign_id, existing)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Active Campaigns</h1>
        <p className="text-gray-500 text-sm mt-1">Campaigns currently running and enrolling contacts</p>
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
              />
            </svg>
          </div>
          <p className="text-white font-semibold">No active campaigns</p>
          <p className="text-gray-500 text-sm max-w-xs">
            Campaigns you activate will appear here with live enrollment and performance data.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {campaigns.map((campaign) => {
            const stats = enrollmentMap.get(campaign.id) || { active: 0, total: 0 }
            const performance = (campaign.performance_data || {}) as Record<string, unknown>
            const openRate =
              typeof performance.open_rate === 'number'
                ? performance.open_rate
                : typeof performance.avg_open_rate === 'number'
                  ? performance.avg_open_rate
                  : undefined
            const clickRate =
              typeof performance.click_rate === 'number'
                ? performance.click_rate
                : typeof performance.avg_click_rate === 'number'
                  ? performance.avg_click_rate
                  : undefined

            return (
              <div key={campaign.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-white font-semibold">{campaign.title}</p>
                    <p className="text-gray-500 text-xs mt-1">{campaign.goal}</p>
                    <p className="text-gray-600 text-xs mt-1">Type: {campaign.campaign_type}</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-md text-xs font-medium border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                    Active
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-gray-600">Active Enrolled</p>
                    <p className="text-white text-lg font-semibold mt-1">{stats.active.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-gray-600">Total Enrolled</p>
                    <p className="text-white text-lg font-semibold mt-1">{stats.total.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-gray-600">Open Rate</p>
                    <p className="text-white text-lg font-semibold mt-1">{toPercent(openRate)}</p>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-gray-600">Click Rate</p>
                    <p className="text-white text-lg font-semibold mt-1">{toPercent(clickRate)}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
