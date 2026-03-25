export const dynamic = 'force-dynamic'

export default function CampaignsOverviewPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Campaigns</h1>
        <p className="text-gray-500 text-sm mt-1">Overview of all drip campaigns and performance</p>
      </div>

      {/* Stats row — placeholder */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Active Campaigns', value: '—' },
          { label: 'Total Enrolled', value: '—' },
          { label: 'Avg Open Rate', value: '—' },
          { label: 'Avg Click Rate', value: '—' },
        ].map(stat => (
          <div key={stat.label} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">{stat.label}</p>
            <p className="text-white text-2xl font-bold mt-2">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Campaign list — placeholder */}
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
        <a
          href="/admin/campaigns/ai-builder"
          className="mt-2 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600
                     text-white text-sm font-semibold hover:from-blue-500 hover:to-violet-500
                     transition-all duration-150 shadow-lg shadow-blue-600/20"
        >
          Open AI Builder
        </a>
      </div>
    </div>
  )
}
