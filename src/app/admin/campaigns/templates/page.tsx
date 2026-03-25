export const dynamic = 'force-dynamic'

export default function TemplatesPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Email Templates</h1>
        <p className="text-gray-500 text-sm mt-1">Templates synced with Brevo — manage and preview email designs</p>
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
        <div className="w-12 h-12 rounded-2xl bg-amber-600/10 border border-amber-500/20 flex items-center justify-center">
          <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
        </div>
        <p className="text-white font-semibold">No templates synced</p>
        <p className="text-gray-500 text-sm max-w-xs">
          Connect your Brevo API key in Settings to sync and manage email templates here.
        </p>
        <a
          href="/admin/campaigns/settings"
          className="mt-2 px-4 py-2 rounded-xl border border-white/[0.08] bg-white/[0.04]
                     text-white text-sm font-medium hover:bg-white/[0.08] transition-all duration-150"
        >
          Go to Settings
        </a>
      </div>
    </div>
  )
}
