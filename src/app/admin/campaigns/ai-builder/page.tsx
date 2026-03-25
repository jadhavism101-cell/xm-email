export const dynamic = 'force-dynamic'

export default function AiBuilderPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">AI Campaign Builder</h1>
        <p className="text-gray-500 text-sm mt-1">
          Describe your campaign goal — Claude will generate a full sequence with timing, copy outlines, and conditional branches.
        </p>
      </div>

      {/* Two-panel layout placeholder */}
      <div className="grid grid-cols-2 gap-4 min-h-[600px]">
        {/* Chat panel */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 flex flex-col">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-600 mb-4">Chat with AI</p>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                </svg>
              </div>
              <p className="text-white text-sm font-medium">AI Builder coming next</p>
              <p className="text-gray-500 text-xs max-w-[200px]">
                Chat interface with Claude will be built here
              </p>
            </div>
          </div>
        </div>

        {/* Campaign spec preview panel */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 flex flex-col">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-600 mb-4">Campaign Preview</p>
          <div className="flex-1 flex items-center justify-center">
            <p className="text-gray-600 text-sm text-center">
              Generated campaign spec will appear here
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
