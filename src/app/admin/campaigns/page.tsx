import { supabaseAdmin, type DripCampaign } from '@/lib/supabase'
import Link from 'next/link'
import CampaignStatusActions from '@/components/CampaignStatusActions'

export const dynamic = 'force-dynamic'

type EnrollmentRow = {
  campaign_id: string
  status: string
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

export default async function CampaignsOverviewPage() {
  const { data: campaigns } = await supabaseAdmin
    .from('drip_campaigns')
    .select('*')
    .order('created_at', { ascending: false })

  const { data: enrollmentsData } = await supabaseAdmin
    .from('drip_enrollments')
    .select('status, campaign_id')

  const now = new Date()
  const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [deliveredResult, openedResult, clickedResult] = await Promise.all([
    supabaseAdmin
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'email')
      .gte('created_at', since30d)
      .not('metadata', 'is', null)
      .contains('metadata', { brevo_event: 'delivered' }),
    supabaseAdmin
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'email')
      .gte('created_at', since30d)
      .not('metadata', 'is', null)
      .contains('metadata', { brevo_event: 'opened' }),
    supabaseAdmin
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'email')
      .gte('created_at', since30d)
      .not('metadata', 'is', null)
      .contains('metadata', { brevo_event: 'clicked' }),
  ])

  const campaignsList = (campaigns as DripCampaign[]) || []
  const enrollments = (enrollmentsData as EnrollmentRow[] | null) || []

  const activeCampaignsCount = campaignsList.filter(c => c.status === 'active').length
  const totalEnrolled = enrollments.length

  const enrollmentStatsByCampaign = new Map<string, { active: number; total: number }>()
  for (const row of enrollments) {
    const existing = enrollmentStatsByCampaign.get(row.campaign_id) || { active: 0, total: 0 }
    existing.total += 1
    if (row.status === 'active') existing.active += 1
    enrollmentStatsByCampaign.set(row.campaign_id, existing)
  }

  const deliveredCount = deliveredResult.count ?? 0
  const openedCount = openedResult.count ?? 0
  const clickedCount = clickedResult.count ?? 0
  const avgOpenRate = deliveredCount > 0 ? (openedCount / deliveredCount) * 100 : 0
  const avgClickRate = deliveredCount > 0 ? (clickedCount / deliveredCount) * 100 : 0

  const statCards = [
    { label: 'Active Campaigns', value: activeCampaignsCount.toLocaleString() },
    { label: 'Total Enrolled', value: totalEnrolled.toLocaleString() },
    { label: 'Avg Open Rate (30d)', value: formatPercent(avgOpenRate) },
    { label: 'Avg Click Rate (30d)', value: formatPercent(avgClickRate) },
  ]

  const campaignRows = campaignsList.map((campaign) => ({
    campaign,
    enrollmentStats: enrollmentStatsByCampaign.get(campaign.id) || { active: 0, total: 0 },
  }))

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Campaigns</h1>
          <p className="text-gray-500 text-sm mt-1">Overview of all drip campaigns and performance</p>
        </div>
        <Link
          href="/admin/campaigns/ai-builder"
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600
                     text-white text-sm font-semibold hover:from-blue-500 hover:to-violet-500
                     transition-all duration-150 shadow-lg shadow-blue-600/20"
        >
          Open AI Builder
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        {statCards.map(stat => (
          <div key={stat.label} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">{stat.label}</p>
            <p className="text-white text-2xl font-bold mt-2">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Campaign list */}
      <div className="space-y-4">
        {campaignsList.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
            <div className="w-12 h-12 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
            </div>
            <p className="text-white font-semibold">No campaigns yet</p>
            <p className="text-gray-500 text-sm max-w-xs">
              Use the AI Builder to generate your first campaign, or create one manually.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.02] border-b border-white/[0.06]">
                <tr>
                  <th className="px-6 py-4 font-semibold text-white">Campaign Name</th>
                  <th className="px-6 py-4 font-semibold text-gray-400">Status</th>
                  <th className="px-6 py-4 font-semibold text-gray-400">Enrolled</th>
                  <th className="px-6 py-4 font-semibold text-gray-400">Goal</th>
                  <th className="px-6 py-4 font-semibold text-gray-400">Created</th>
                  <th className="px-6 py-4 font-semibold text-gray-400 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {campaignRows.map(({ campaign, enrollmentStats }) => (
                  <tr key={campaign.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4 font-medium text-white">
                      {campaign.title}
                      <div className="text-xs text-gray-500 mt-0.5">{campaign.campaign_type}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-md text-xs font-medium border ${
                        campaign.status === 'active' 
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-white/5 text-gray-400 border-white/10'
                      }`}>
                        {campaign.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-300">
                      {enrollmentStats.total.toLocaleString()}
                      <div className="text-xs text-gray-500 mt-0.5">active: {enrollmentStats.active.toLocaleString()}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-300">{campaign.goal}</td>
                    <td className="px-6 py-4 text-gray-400">
                      {new Date(campaign.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <CampaignStatusActions campaignId={campaign.id} status={campaign.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
