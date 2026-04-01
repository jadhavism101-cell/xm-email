'use client'
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export const dynamic = 'force-dynamic'

// ── Types ───────────────────────────────────────────────────────────────────
type ImportMode = 'csv' | 'metabase'

interface CSVImportResult {
  ok: boolean
  batch_name: string
  stats: {
    total: number; valid: number; invalid: number
    duplicate_csv: number; exists_crm: number
    created: number; enrichment_queued: number; errors: number
  }
  segments: { new_cold: number; warm_lead: number; lapsed: number; already_active: number }
  invalid_rows: { row: number; email: string; reason: string }[]
  error?: string
}

interface MetabaseImportResult {
  ok: boolean
  summary: { total_vendors_fetched: number; created: number; updated: number; skipped: number; errors: number; batch_name: string }
  segments: { active_customer: number; lapsed_customer: number; never_ordered: number }
  error?: string
  errors?: string[]
}

interface CampaignListItem {
  id: string
  title: string
  status: string
}

// ── Step indicator ──────────────────────────────────────────────────────────
const STEPS_CSV = ['Upload', 'Review', 'Confirm', 'Done']
const STEPS_META = ['Select Source', 'Preview', 'Import', 'Done']

function StepBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center flex-1">
          <div className="flex flex-col items-center">
            <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all
              ${i < current ? 'bg-blue-600 border-blue-600 text-white' :
                i === current ? 'bg-blue-600/20 border-blue-500 text-blue-400' :
                'bg-white/[0.03] border-white/[0.1] text-gray-600'}`}>
              {i < current ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : i + 1}
            </div>
            <span className={`mt-1.5 text-[10px] font-medium whitespace-nowrap
              ${i === current ? 'text-blue-400' : i < current ? 'text-gray-400' : 'text-gray-600'}`}>
              {s}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-px mx-2 mt-[-10px] ${i < current ? 'bg-blue-600/50' : 'bg-white/[0.06]'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Stat pill ───────────────────────────────────────────────────────────────
function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-600/10 border-emerald-500/20 text-emerald-400',
    blue:    'bg-blue-600/10 border-blue-500/20 text-blue-400',
    amber:   'bg-amber-600/10 border-amber-500/20 text-amber-400',
    violet:  'bg-violet-600/10 border-violet-500/20 text-violet-400',
    red:     'bg-red-600/10 border-red-500/20 text-red-400',
    gray:    'bg-white/[0.04] border-white/[0.08] text-gray-400',
  }
  return (
    <div className={`rounded-xl border px-4 py-3 ${colorMap[color] || colorMap.gray}`}>
      <p className="text-2xl font-bold">{value.toLocaleString()}</p>
      <p className="text-xs font-medium mt-0.5 opacity-80">{label}</p>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────
export default function ImportPage() {
  const [mode, setMode] = useState<ImportMode | null>(null)
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [batchName, setBatchName] = useState(`csv_import_${new Date().toISOString().slice(0, 10)}`)
  const [dragOver, setDragOver] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [csvResult, setCsvResult] = useState<CSVImportResult | null>(null)
  const [metaResult, setMetaResult] = useState<MetabaseImportResult | null>(null)
  const [syncingBrevo, setSyncingBrevo] = useState(false)
  const [brevoSynced, setBrevoSynced] = useState(false)
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState('')
  const [loadingCampaigns, setLoadingCampaigns] = useState(false)
  const [enrolling, setEnrolling] = useState(false)
  const [enrollMessage, setEnrollMessage] = useState('')
  const [enrollError, setEnrollError] = useState('')
  const [importError, setImportError] = useState('')
  const [syncMessage, setSyncMessage] = useState('')
  const [syncError, setSyncError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function loadCampaigns() {
      setLoadingCampaigns(true)
      try {
        const res = await fetch('/api/campaigns?limit=100', { cache: 'no-store' })
        const data = await res.json()
        if (!res.ok || !data?.ok || !Array.isArray(data.items)) return
        const items = data.items as CampaignListItem[]
        setCampaigns(items)
        if (!selectedCampaignId && items.length > 0) {
          setSelectedCampaignId(items[0].id)
        }
      } finally {
        setLoadingCampaigns(false)
      }
    }

    loadCampaigns()
    // Load campaign options once on initial render.
  }, [])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped?.name.endsWith('.csv')) setFile(dropped)
  }

  async function handleCSVUpload() {
    if (!file) return
    setLoading(true)
    setImportError('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('batch_name', batchName)
    fd.append('source', 'csv_import')
    try {
      const res = await fetch('/api/contacts/import-csv', { method: 'POST', body: fd })
      const data: CSVImportResult = await res.json()
      setCsvResult(data)

      if (!res.ok || !data.ok) {
        setImportError(data.error || 'CSV import failed')
      }

      if (data.ok || data.stats?.valid > 0 || data.stats?.created > 0) {
        setStep(2)
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'CSV import failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleMetabaseImport() {
    setLoading(true)
    setImportError('')
    try {
      const res = await fetch('/api/contacts/import-metabase', { method: 'POST' })
      const data: MetabaseImportResult = await res.json()
      setMetaResult(data)

      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Metabase import failed')
      }

      setStep(3)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Metabase import failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSyncBrevo(batch: string) {
    if (!batch) {
      setSyncError('Import batch is missing. Re-run the import and try again.')
      return
    }

    setSyncingBrevo(true)
    setSyncMessage('')
    setSyncError('')

    try {
      const res = await fetch('/api/contacts/sync-brevo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_name: batch }),
      })
      const data = await res.json()

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Brevo sync failed')
      }

      const synced = Number(data.synced || 0)
      const total = Number(data.total || 0)
      const failed = Array.isArray(data.errors) ? data.errors.length : 0

      if (failed > 0 && synced < total) {
        setBrevoSynced(false)
        setSyncError(`Brevo sync partially completed: ${synced} of ${total} contacts synced. Retry to pick up the remaining contacts.`)
      } else {
        setBrevoSynced(true)
        setSyncMessage(total > 0 ? `Synced ${synced} of ${total} contacts to Brevo.` : 'No contacts in this batch needed syncing.')
      }
    } catch (err) {
      setBrevoSynced(false)
      setSyncError(err instanceof Error ? err.message : 'Brevo sync failed')
    } finally {
      setSyncingBrevo(false)
    }
  }

  async function handleEnrollImportedContacts(batch: string) {
    if (!selectedCampaignId || !batch) return
    setEnrolling(true)
    setEnrollError('')
    setEnrollMessage('')

    try {
      const res = await fetch(`/api/campaigns/${selectedCampaignId}/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_name: batch }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Enrollment failed')
      }

      const enrolled = Number(data.enrolled || 0)
      const skipped = Number(data.skipped || 0)
      setEnrollMessage(`Enrollment complete: ${enrolled} enrolled, ${skipped} skipped.`)
    } catch (err) {
      setEnrollError(err instanceof Error ? err.message : 'Enrollment failed')
    } finally {
      setEnrolling(false)
    }
  }

  function reset() {
    setMode(null)
    setStep(0)
    setFile(null)
    setCsvResult(null)
    setMetaResult(null)
    setBrevoSynced(false)
    setImportError('')
    setEnrollError('')
    setEnrollMessage('')
    setSyncMessage('')
    setSyncError('')
  }

  const steps = mode === 'metabase' ? STEPS_META : STEPS_CSV

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Import & Segment</h1>
        <p className="text-gray-500 text-sm mt-1">Pull contacts from Metabase or upload a CSV, then route them into the right campaigns</p>
      </div>

      {/* Mode selector */}
      {!mode && (
        <div className="grid grid-cols-2 gap-4">
          <button onClick={() => { setMode('metabase'); setStep(0) }}
            className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 text-left
                       hover:border-blue-500/30 hover:bg-blue-600/[0.03] transition-all duration-200 group">
            <div className="w-10 h-10 rounded-xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
              </svg>
            </div>
            <p className="text-white font-semibold mb-1">Import from Metabase</p>
            <p className="text-gray-500 text-sm">Pull all 736 onboarded sellers from the production database. Automatically segments into active, lapsed, and never-ordered.</p>
            <div className="mt-4 flex items-center gap-1.5 text-blue-400 text-xs font-medium">
              <span>736 sellers ready</span>
              <svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </div>
          </button>

          <button onClick={() => { setMode('csv'); setStep(0) }}
            className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 text-left
                       hover:border-violet-500/30 hover:bg-violet-600/[0.03] transition-all duration-200 group">
            <div className="w-10 h-10 rounded-xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <p className="text-white font-semibold mb-1">Upload CSV</p>
            <p className="text-gray-500 text-sm">Upload a CSV of cold leads or event contacts. Auto-validates, deduplicates against your CRM, and routes to the right campaign.</p>
            <div className="mt-4 flex items-center gap-1.5 text-violet-400 text-xs font-medium">
              <span>Up to 5,000 contacts per upload</span>
              <svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </div>
          </button>
        </div>
      )}

      {/* Wizard */}
      <AnimatePresence mode="wait">
        {mode && (
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8"
          >
            <div className="flex items-center justify-between mb-6">
              <p className="text-white font-semibold">
                {mode === 'csv' ? 'CSV Import' : 'Metabase Import'}
              </p>
              <button onClick={reset} className="text-gray-500 hover:text-gray-300 text-xs transition-colors">
                ← Change source
              </button>
            </div>

            <StepBar steps={steps} current={step} />

            {/* ── CSV Steps ──────────────────────────────────────────────── */}
            {mode === 'csv' && (
              <>
                {/* Step 0: Upload */}
                {step === 0 && (
                  <div className="space-y-5">
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1.5">Batch name</label>
                      <input type="text" value={batchName} onChange={e => setBatchName(e.target.value)}
                        className="w-full max-w-xs bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5
                                   text-white text-sm focus:outline-none focus:border-blue-500/50 transition-all" />
                    </div>

                    <div
                      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDrop}
                      onClick={() => fileRef.current?.click()}
                      className={`rounded-2xl border-2 border-dashed p-10 flex flex-col items-center justify-center text-center gap-3 cursor-pointer transition-all duration-200
                        ${dragOver ? 'border-blue-500/60 bg-blue-600/[0.05]' :
                          file ? 'border-emerald-500/40 bg-emerald-600/[0.03]' :
                          'border-white/[0.08] hover:border-blue-500/30 hover:bg-blue-600/[0.02]'}`}
                    >
                      <input ref={fileRef} type="file" accept=".csv" className="hidden"
                        onChange={e => setFile(e.target.files?.[0] || null)} />

                      {file ? (
                        <>
                          <div className="w-10 h-10 rounded-xl bg-emerald-600/15 border border-emerald-500/20 flex items-center justify-center">
                            <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                          <p className="text-white font-medium">{file.name}</p>
                          <p className="text-gray-500 text-xs">{(file.size / 1024).toFixed(1)} KB · click to change</p>
                        </>
                      ) : (
                        <>
                          <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                            </svg>
                          </div>
                          <p className="text-white font-medium">Drop your CSV here or click to browse</p>
                          <p className="text-gray-600 text-xs">Required: <code className="text-gray-400">email</code> · Recommended: <code className="text-gray-400">first_name, company_name, phone</code></p>
                        </>
                      )}
                    </div>

                    <button onClick={() => setStep(1)} disabled={!file}
                      className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white text-sm font-semibold
                                 disabled:opacity-40 disabled:cursor-not-allowed hover:from-blue-500 hover:to-violet-500
                                 transition-all duration-150 shadow-lg shadow-blue-600/20">
                      Continue →
                    </button>
                  </div>
                )}

                {/* Step 1: Review & upload */}
                {step === 1 && (
                  <div className="space-y-5">
                    <div className="rounded-xl bg-blue-600/[0.06] border border-blue-500/20 p-4">
                      <p className="text-blue-300 text-sm font-medium mb-1">Ready to process</p>
                      <p className="text-gray-400 text-sm"><span className="text-white font-medium">{file?.name}</span> · {((file?.size || 0) / 1024).toFixed(1)} KB</p>
                      <p className="text-gray-500 text-xs mt-2">The system will: validate emails, remove duplicates and role-based addresses, match against your existing CRM contacts, and flag contacts with missing fields for the enrichment queue.</p>
                    </div>

                    <div className="flex gap-3">
                      <button onClick={() => setStep(0)} className="px-4 py-2 rounded-xl border border-white/[0.08] text-gray-400 text-sm hover:text-white hover:border-white/[0.15] transition-all">
                        ← Back
                      </button>
                      <button onClick={handleCSVUpload} disabled={loading}
                        className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white text-sm font-semibold
                                   disabled:opacity-40 hover:from-blue-500 hover:to-violet-500 transition-all duration-150 shadow-lg shadow-blue-600/20 flex items-center gap-2">
                        {loading ? (
                          <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Processing…</>
                        ) : 'Validate & Process CSV'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 2: Results */}
                {step === 2 && csvResult && (
                  <div className="space-y-6">
                    {importError && (
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">
                        {importError}
                      </div>
                    )}
                    <div className="grid grid-cols-4 gap-3">
                      <StatPill label="Valid emails" value={csvResult.stats.valid} color="emerald" />
                      <StatPill label="New contacts" value={csvResult.stats.created} color="blue" />
                      <StatPill label="Enrichment queue" value={csvResult.stats.enrichment_queued} color="amber" />
                      <StatPill label="Skipped/invalid" value={csvResult.stats.invalid + csvResult.stats.duplicate_csv} color="gray" />
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-600 mb-3">Segment routing</p>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: 'New cold leads → Campaign 5', value: csvResult.segments.new_cold, color: 'violet' },
                          { label: 'Warm leads in CRM → Campaign 1B', value: csvResult.segments.warm_lead, color: 'blue' },
                          { label: 'Lapsed customers → Campaign 3', value: csvResult.segments.lapsed, color: 'amber' },
                          { label: 'Already active — excluded', value: csvResult.segments.already_active, color: 'gray' },
                        ].map(s => (
                          <div key={s.label} className="flex items-center justify-between rounded-xl bg-white/[0.02] border border-white/[0.05] px-4 py-2.5">
                            <span className="text-gray-400 text-xs">{s.label}</span>
                            <span className="text-white font-semibold text-sm">{s.value.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {csvResult.invalid_rows.length > 0 && (
                      <details className="rounded-xl border border-red-500/15 bg-red-600/[0.03] p-4">
                        <summary className="text-red-400 text-xs font-medium cursor-pointer">{csvResult.invalid_rows.length} invalid rows (click to expand)</summary>
                        <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
                          {csvResult.invalid_rows.slice(0, 30).map((r, i) => (
                            <p key={i} className="text-gray-500 text-xs">Row {r.row}: <span className="text-gray-400">{r.email || '(empty)'}</span> — {r.reason}</p>
                          ))}
                        </div>
                      </details>
                    )}

                    <div className="flex gap-3">
                      <button onClick={() => setStep(3)}
                        className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white text-sm font-semibold
                                   hover:from-blue-500 hover:to-violet-500 transition-all duration-150 shadow-lg shadow-blue-600/20">
                        Sync to Brevo →
                      </button>
                      <button onClick={reset} className="px-4 py-2 rounded-xl border border-white/[0.08] text-gray-400 text-sm hover:text-white transition-all">
                        Done — skip Brevo
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 3: Brevo sync */}
                {step === 3 && (
                  <div className="space-y-6">
                    <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-5 space-y-3">
                      <p className="text-white font-medium text-sm">Sync new contacts to Brevo</p>
                      <p className="text-gray-500 text-sm">This will push contacts from this import batch to your Brevo account, add them to the correct lists, and make them available for campaign enrollment.</p>
                      {syncMessage && (
                        <div className="text-emerald-400 text-sm">{syncMessage}</div>
                      )}
                      {syncError && (
                        <div className="text-amber-300 text-sm">{syncError}</div>
                      )}
                      {brevoSynced && !syncError && (
                        <div className="flex items-center gap-2 text-emerald-400 text-sm">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Synced to Brevo successfully
                        </div>
                      )}
                    </div>
                    <div className="flex gap-3">
                      {!brevoSynced && (
                        <button onClick={() => csvResult && handleSyncBrevo(csvResult.batch_name)} disabled={syncingBrevo || !csvResult}
                          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white text-sm font-semibold
                                     disabled:opacity-40 hover:from-blue-500 hover:to-violet-500 transition-all duration-150 shadow-lg shadow-blue-600/20 flex items-center gap-2">
                          {syncingBrevo ? (
                            <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Syncing…</>
                          ) : 'Sync to Brevo'}
                        </button>
                      )}
                      <button onClick={reset} className="px-4 py-2 rounded-xl border border-white/[0.08] text-gray-400 text-sm hover:text-white transition-all">
                        {brevoSynced ? 'Import another file' : 'Skip & finish'}
                      </button>
                    </div>

                    <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-5 space-y-3">
                      <p className="text-gray-300 text-sm font-medium">Optional: Enroll this imported batch into a campaign</p>
                      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                        <select
                          value={selectedCampaignId}
                          onChange={(e) => setSelectedCampaignId(e.target.value)}
                          disabled={loadingCampaigns || campaigns.length === 0}
                          className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white"
                        >
                          {campaigns.length === 0 ? (
                            <option value="">{loadingCampaigns ? 'Loading campaigns...' : 'No campaigns found'}</option>
                          ) : (
                            campaigns.map((campaign) => (
                              <option key={campaign.id} value={campaign.id}>
                                {campaign.title} ({campaign.status})
                              </option>
                            ))
                          )}
                        </select>
                        <button
                          onClick={() => csvResult && handleEnrollImportedContacts(csvResult.batch_name)}
                          disabled={!csvResult || !selectedCampaignId || enrolling}
                          className="px-4 py-2 rounded-xl border border-white/[0.1] bg-white/[0.04] text-white text-sm font-medium disabled:opacity-50"
                        >
                          {enrolling ? 'Enrolling...' : 'Enroll imported contacts'}
                        </button>
                      </div>
                      {enrollMessage && <p className="text-emerald-400 text-xs">{enrollMessage}</p>}
                      {enrollError && <p className="text-red-400 text-xs">{enrollError}</p>}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Metabase Steps ─────────────────────────────────────────── */}
            {mode === 'metabase' && (
              <>
                {/* Step 0: Preview */}
                {step === 0 && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: 'Total sellers', value: '736', sub: 'In production DB', color: 'blue' },
                        { label: 'With email', value: '~700', sub: 'Estimated valid', color: 'emerald' },
                        { label: 'Test accounts', value: '18', sub: 'Auto-excluded', color: 'gray' },
                      ].map(s => (
                        <div key={s.label} className={`rounded-xl border p-4
                          ${s.color === 'blue' ? 'bg-blue-600/10 border-blue-500/20' :
                            s.color === 'emerald' ? 'bg-emerald-600/10 border-emerald-500/20' :
                            'bg-white/[0.03] border-white/[0.06]'}`}>
                          <p className="text-2xl font-bold text-white">{s.value}</p>
                          <p className="text-xs font-medium text-gray-400 mt-0.5">{s.label}</p>
                          <p className="text-xs text-gray-600">{s.sub}</p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">What will happen</p>
                      {[
                        'Pull all vendors from Metabase (excluding 18 test accounts)',
                        'Enrich with seller_metadata (business name, phone, city, tier)',
                        'Classify by order history: active / lapsed / never-ordered',
                        'Upsert into contacts table (create new, update existing)',
                        'Existing contacts matched by metabase_vendor_id (no duplicates)',
                      ].map((step, i) => (
                        <div key={i} className="flex items-start gap-2.5">
                          <div className="w-4 h-4 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <span className="text-[9px] text-blue-400 font-bold">{i + 1}</span>
                          </div>
                          <p className="text-gray-400 text-xs">{step}</p>
                        </div>
                      ))}
                    </div>

                    <button onClick={() => setStep(1)}
                      className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white text-sm font-semibold
                                 hover:from-blue-500 hover:to-violet-500 transition-all duration-150 shadow-lg shadow-blue-600/20">
                      Start import →
                    </button>
                  </div>
                )}

                {/* Step 1: Running */}
                {step === 1 && (
                  <div className="space-y-5">
                    {importError && (
                      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
                        {importError}
                      </div>
                    )}
                    <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-6 flex flex-col items-center justify-center text-center gap-4 min-h-[180px]">
                      {loading ? (
                        <>
                          <svg className="w-8 h-8 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                          <div>
                            <p className="text-white font-medium">Importing from Metabase</p>
                            <p className="text-gray-500 text-xs mt-1">Querying vendors, enriching with metadata, upserting contacts…</p>
                          </div>
                        </>
                      ) : (
                        <button onClick={handleMetabaseImport}
                          className="px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white text-sm font-semibold
                                     hover:from-blue-500 hover:to-violet-500 transition-all duration-150 shadow-lg shadow-blue-600/20">
                          Run import now
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Step 2: Not used for metabase */}

                {/* Step 3: Done */}
                {step === 3 && metaResult && (
                  <div className="space-y-6">
                    {importError && (
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">
                        {importError}
                      </div>
                    )}
                    <div className="grid grid-cols-4 gap-3">
                      <StatPill label="Fetched from Metabase" value={metaResult.summary.total_vendors_fetched} color="blue" />
                      <StatPill label="New contacts created" value={metaResult.summary.created} color="emerald" />
                      <StatPill label="Existing updated" value={metaResult.summary.updated} color="violet" />
                      <StatPill label="Errors" value={metaResult.summary.errors} color={metaResult.summary.errors > 0 ? 'red' : 'gray'} />
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-600 mb-3">Segments created</p>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { label: 'Active customers → Campaign 4', value: metaResult.segments.active_customer || 0, color: 'emerald' },
                          { label: 'Lapsed customers → Campaign 3', value: metaResult.segments.lapsed_customer || 0, color: 'amber' },
                          { label: 'Never ordered → Campaign 1B', value: metaResult.segments.never_ordered || 0, color: 'blue' },
                        ].map(s => (
                          <div key={s.label} className="flex items-center justify-between rounded-xl bg-white/[0.02] border border-white/[0.05] px-4 py-2.5">
                            <span className="text-gray-400 text-xs">{s.label}</span>
                            <span className="text-white font-semibold text-sm">{(s.value).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <button onClick={() => handleSyncBrevo(metaResult.summary.batch_name)} disabled={syncingBrevo || brevoSynced}
                        className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white text-sm font-semibold
                                   disabled:opacity-40 hover:from-blue-500 hover:to-violet-500 transition-all duration-150 shadow-lg shadow-blue-600/20 flex items-center gap-2">
                        {syncingBrevo ? (
                          <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Syncing to Brevo…</>
                        ) : brevoSynced ? '✓ Synced to Brevo' : 'Sync imported batch to Brevo'}
                      </button>
                      <button onClick={reset} className="px-4 py-2 rounded-xl border border-white/[0.08] text-gray-400 text-sm hover:text-white transition-all">
                        Done
                      </button>
                    </div>

                    {(syncMessage || syncError) && (
                      <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-5 space-y-2">
                        {syncMessage && <p className="text-emerald-400 text-sm">{syncMessage}</p>}
                        {syncError && <p className="text-amber-300 text-sm">{syncError}</p>}
                      </div>
                    )}

                    {Array.isArray(metaResult.errors) && metaResult.errors.length > 0 && (
                      <details className="rounded-xl border border-amber-500/15 bg-amber-600/[0.03] p-4">
                        <summary className="text-amber-300 text-xs font-medium cursor-pointer">
                          {metaResult.errors.length} import warnings (click to expand)
                        </summary>
                        <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
                          {metaResult.errors.slice(0, 20).map((item, index) => (
                            <p key={index} className="text-gray-400 text-xs">{item}</p>
                          ))}
                        </div>
                      </details>
                    )}

                    <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-5 space-y-3">
                      <p className="text-gray-300 text-sm font-medium">Optional: Enroll this imported batch into a campaign</p>
                      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                        <select
                          value={selectedCampaignId}
                          onChange={(e) => setSelectedCampaignId(e.target.value)}
                          disabled={loadingCampaigns || campaigns.length === 0}
                          className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white"
                        >
                          {campaigns.length === 0 ? (
                            <option value="">{loadingCampaigns ? 'Loading campaigns...' : 'No campaigns found'}</option>
                          ) : (
                            campaigns.map((campaign) => (
                              <option key={campaign.id} value={campaign.id}>
                                {campaign.title} ({campaign.status})
                              </option>
                            ))
                          )}
                        </select>
                        <button
                          onClick={() => handleEnrollImportedContacts(metaResult.summary.batch_name)}
                          disabled={!selectedCampaignId || enrolling}
                          className="px-4 py-2 rounded-xl border border-white/[0.1] bg-white/[0.04] text-white text-sm font-medium disabled:opacity-50"
                        >
                          {enrolling ? 'Enrolling...' : 'Enroll imported contacts'}
                        </button>
                      </div>
                      {enrollMessage && <p className="text-emerald-400 text-xs">{enrollMessage}</p>}
                      {enrollError && <p className="text-red-400 text-xs">{enrollError}</p>}
                    </div>
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
