'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

export const dynamic = 'force-dynamic'

interface ObservabilityResponse {
  generated_at: string
  summary: {
    eligible_contacts: number
    synced_contacts: number
    pending_contacts: number
    sync_errors: number
    sync_coverage_percent: number
    webhook_events_24h: number
    webhook_events_7d: number
  }
  webhook_events_7d: Record<string, number>
  webhook_events_24h: Record<string, number>
  sync_dlq: Array<{
    contact_id: string
    email: string
    company_name: string
    brevo_contact_id: number | null
    last_error: string
    last_error_at: string
    last_attempt_at: string
  }>
}

function StatCard({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string
  value: string | number
  sub?: string
  tone?: 'neutral' | 'blue' | 'emerald' | 'amber' | 'red'
}) {
  const toneStyles: Record<string, string> = {
    neutral: 'bg-white/[0.02] border-white/[0.06] text-white',
    blue: 'bg-blue-600/10 border-blue-500/20 text-blue-300',
    emerald: 'bg-emerald-600/10 border-emerald-500/20 text-emerald-300',
    amber: 'bg-amber-600/10 border-amber-500/20 text-amber-300',
    red: 'bg-red-600/10 border-red-500/20 text-red-300',
  }

  return (
    <div className={`rounded-2xl border p-5 ${toneStyles[tone]}`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold opacity-80">{label}</p>
      <p className="text-2xl font-bold mt-2">{value}</p>
      {sub ? <p className="text-xs mt-1 opacity-80">{sub}</p> : null}
    </div>
  )
}

export default function IntegrationHealthPage() {
  const [data, setData] = useState<ObservabilityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/integrations/brevo/observability', { cache: 'no-store' })
      const payload = await res.json()
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to load integration metrics')
      }
      setData(payload as ObservabilityResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integration metrics')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const coverageTone: 'emerald' | 'amber' | 'red' = useMemo(() => {
    const coverage = data?.summary.sync_coverage_percent || 0
    if (coverage >= 95) return 'emerald'
    if (coverage >= 80) return 'amber'
    return 'red'
  }, [data])

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Integration Health</h1>
          <p className="text-gray-500 text-sm mt-1">
            Brevo sync coverage, webhook event volume, and DLQ-style sync failures.
          </p>
        </div>

        <button
          onClick={() => void load()}
          disabled={loading}
          className="px-4 py-2 rounded-xl border border-white/[0.08] bg-white/[0.03]
                     text-gray-300 text-sm hover:text-white hover:border-white/[0.14]
                     disabled:opacity-40 transition-all"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-600/10 p-5">
          <p className="text-red-300 text-sm font-medium">Unable to load integration metrics</p>
          <p className="text-red-200/80 text-xs mt-1">{error}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-6 gap-4">
        <StatCard
          label="Eligible"
          value={loading ? '...' : (data?.summary.eligible_contacts || 0).toLocaleString()}
          sub="Contacts eligible for Brevo"
          tone="neutral"
        />
        <StatCard
          label="Synced"
          value={loading ? '...' : (data?.summary.synced_contacts || 0).toLocaleString()}
          sub="With Brevo contact id"
          tone="blue"
        />
        <StatCard
          label="Pending"
          value={loading ? '...' : (data?.summary.pending_contacts || 0).toLocaleString()}
          sub="Still not synced"
          tone="amber"
        />
        <StatCard
          label="Sync Errors"
          value={loading ? '...' : (data?.summary.sync_errors || 0).toLocaleString()}
          sub="Currently in sync DLQ"
          tone={(data?.summary.sync_errors || 0) > 0 ? 'red' : 'emerald'}
        />
        <StatCard
          label="Coverage"
          value={loading ? '...' : `${(data?.summary.sync_coverage_percent || 0).toFixed(2)}%`}
          sub="Synced / eligible"
          tone={coverageTone}
        />
        <StatCard
          label="Webhooks 24h"
          value={loading ? '...' : (data?.summary.webhook_events_24h || 0).toLocaleString()}
          sub="Total events received"
          tone="neutral"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 space-y-4">
          <div>
            <p className="text-white text-sm font-semibold">Webhook Events (Last 24h)</p>
            <p className="text-gray-500 text-xs mt-0.5">Brevo event mix observed by webhook handler</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {Object.entries(data?.webhook_events_24h || {}).map(([event, count]) => (
              <div key={event} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wide text-gray-600 font-semibold">{event}</p>
                <p className="text-sm text-white font-semibold mt-1">{count.toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 space-y-4">
          <div>
            <p className="text-white text-sm font-semibold">Webhook Events (Last 7d)</p>
            <p className="text-gray-500 text-xs mt-0.5">Weekly rollup for trend checks and reconciliation</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {Object.entries(data?.webhook_events_7d || {}).map(([event, count]) => (
              <div key={event} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wide text-gray-600 font-semibold">{event}</p>
                <p className="text-sm text-white font-semibold mt-1">{count.toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div>
            <p className="text-white text-sm font-semibold">Sync DLQ</p>
            <p className="text-gray-500 text-xs mt-0.5">Contacts with latest Brevo sync failure metadata</p>
          </div>
          <p className="text-xs text-gray-500">{(data?.sync_dlq.length || 0).toLocaleString()} shown</p>
        </div>

        {(data?.sync_dlq.length || 0) === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-emerald-300 text-sm font-medium">No sync failures in DLQ</p>
            <p className="text-gray-500 text-xs mt-1">All recently attempted contacts are syncing cleanly</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.05]">
                {['Contact', 'Company', 'Error', 'Last Attempt', 'Brevo ID'].map((h) => (
                  <th
                    key={h}
                    className="text-left px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-600"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.sync_dlq || []).map((row, idx) => (
                <tr key={row.contact_id} className={`border-b border-white/[0.03] ${idx % 2 ? 'bg-white/[0.01]' : ''}`}>
                  <td className="px-6 py-3">
                    <p className="text-gray-300 text-xs font-mono">{row.email}</p>
                  </td>
                  <td className="px-6 py-3">
                    <p className="text-white text-sm">{row.company_name || '—'}</p>
                  </td>
                  <td className="px-6 py-3">
                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-semibold uppercase bg-red-600/10 border border-red-500/20 text-red-300">
                      {row.last_error}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <p className="text-gray-400 text-xs">{new Date(row.last_attempt_at).toLocaleString()}</p>
                  </td>
                  <td className="px-6 py-3">
                    <p className="text-gray-500 text-xs">{row.brevo_contact_id ?? '—'}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-gray-600">
        Last refresh: {data ? new Date(data.generated_at).toLocaleString() : '—'}
      </p>
    </div>
  )
}
