"use client"

import { useEffect, useState } from 'react'

export const dynamic = 'force-dynamic'

const SEGMENTS = [
  {
    key: 'active_customer',
    name: 'Active Customers',
    description: 'Shipped in last 30 days',
    color: 'emerald',
    campaign: 'Campaign 4: Upsell / no drip',
    sql: `contacts.type = 'customer' AND last shipment ≤ 30 days ago`,
  },
  {
    key: 'lapsed_customer',
    name: 'Lapsed Customers',
    description: 'Shipped before, not in last 30–60 days, health score < 40',
    color: 'amber',
    campaign: 'Campaign 3: Re-engagement',
    sql: `contacts.type = 'customer' AND health_score < 40 AND no shipment in 30d`,
  },
  {
    key: 'warm_lead',
    name: 'Warm Leads',
    description: 'Signed up, never shipped, account age > 7 days',
    color: 'blue',
    campaign: 'Campaign 1B: Warm Lead Activation',
    sql: `contacts.type = 'lead' AND no shipments AND created_at < 7 days ago`,
  },
  {
    key: 'new_cold',
    name: 'Cold / CSV Import',
    description: 'Contacts not found in CRM — from manual CSV upload',
    color: 'violet',
    campaign: 'Campaign 5: Cold-to-Warm Nurture',
    sql: `Not found in contacts table — new from import`,
  },
]

const colorMap: Record<string, string> = {
  emerald: 'bg-emerald-600/10 border-emerald-500/20 text-emerald-400',
  amber: 'bg-amber-600/10 border-amber-500/20 text-amber-400',
  blue: 'bg-blue-600/10 border-blue-500/20 text-blue-400',
  violet: 'bg-violet-600/10 border-violet-500/20 text-violet-400',
}

export default function SegmentsPage() {
  const [counts, setCounts] = useState<Record<string, number | null>>({
    active_customer: null,
    lapsed_customer: null,
    warm_lead: null,
    new_cold: null,
  })
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({})

  async function loadAllCounts() {
    try {
      const res = await fetch('/api/contacts/segment-counts', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json?.ok) return
      setCounts((prev) => ({ ...prev, ...(json.counts || {}) }))
    } catch {
      // Keep placeholders on API errors.
    }
  }

  async function runCount(segment: string) {
    setLoadingMap((prev) => ({ ...prev, [segment]: true }))
    try {
      const res = await fetch(`/api/contacts/segment-counts?segment=${encodeURIComponent(segment)}`, {
        cache: 'no-store',
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) return
      setCounts((prev) => ({ ...prev, [segment]: Number(json.count || 0) }))
    } finally {
      setLoadingMap((prev) => ({ ...prev, [segment]: false }))
    }
  }

  useEffect(() => {
    loadAllCounts()
  }, [])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Contact Segments</h1>
        <p className="text-gray-500 text-sm mt-1">
          Segment definitions used to route contacts into the right drip campaigns
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {SEGMENTS.map(seg => (
          <div key={seg.name} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${colorMap[seg.color]}`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                </svg>
              </div>
              <div>
                <p className="text-white font-semibold text-sm">{seg.name}</p>
                <p className="text-gray-500 text-xs mt-0.5">{seg.description}</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-600 mb-1">Routes to</p>
                <p className="text-gray-300 text-xs">{seg.campaign}</p>
              </div>
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-600 mb-1">Filter condition</p>
                <p className="text-gray-400 text-xs font-mono">{seg.sql}</p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-gray-600 text-xs">
                Count: {counts[seg.key] === null ? '—' : counts[seg.key]?.toLocaleString()}
              </span>
              <button
                onClick={() => runCount(seg.key)}
                disabled={!!loadingMap[seg.key]}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:text-gray-600 disabled:cursor-not-allowed"
              >
                {loadingMap[seg.key] ? 'Counting...' : 'Run count →'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
