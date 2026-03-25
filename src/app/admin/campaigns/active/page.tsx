export const dynamic = 'force-dynamic'

export default function ActiveCampaignsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Active Campaigns</h1>
        <p className="text-gray-500 text-sm mt-1">Campaigns currently running and enrolling contacts</p>
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
        <div className="w-12 h-12 rounded-2xl bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center">
          <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
          </svg>
        </div>
        <p className="text-white font-semibold">No active campaigns</p>
        <p className="text-gray-500 text-sm max-w-xs">
          Campaigns you activate will appear here with live enrollment and performance data.
        </p>
      </div>
    </div>
  )
}
