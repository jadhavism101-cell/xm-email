'use client'
import { useState, useEffect, useCallback } from 'react'

export const dynamic = 'force-dynamic'

interface QueueItem {
  id: string
  import_batch: string | null
  missing_fields: string[]
  status: 'pending' | 'in_review' | 'enriched' | 'skipped'
  notes: string | null
  created_at: string
  contacts: {
    id: string; email: string; company_name: string; contact_person: string
    phone: string | null; source: string; type: string; status: string; tags: string[]
  }
}

interface QueueResponse {
  items: QueueItem[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

const MISSING_FIELD_LABELS: Record<string, string> = {
  contact_person: 'Contact Name',
  company_name:   'Company',
  phone:          'Phone / WhatsApp',
}

export default function EnrichmentQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1, page: 1 })
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'pending' | 'enriched' | 'skipped' | 'all'>('pending')
  const [activeItem, setActiveItem] = useState<QueueItem | null>(null)
  const [editFields, setEditFields] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (page = 1) => {
    setLoading(true)
    const res = await fetch(`/api/contacts/enrichment-queue?status=${statusFilter}&page=${page}&limit=50`)
    const data: QueueResponse = await res.json()
    setItems(data.items || [])
    setPagination({ ...data.pagination, page })
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { load(1) }, [load])

  async function handleSave(action: 'enriched' | 'skipped') {
    if (!activeItem) return
    setSaving(true)
    await fetch('/api/contacts/enrichment-queue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queue_id: activeItem.id,
        action,
        enriched_fields: action === 'enriched' ? editFields : undefined,
      }),
    })
    setSaving(false)
    setActiveItem(null)
    setEditFields({})
    load(pagination.page)
  }

  function openItem(item: QueueItem) {
    setActiveItem(item)
    // Pre-fill with existing values
    const pre: Record<string, string> = {}
    for (const f of item.missing_fields) {
      const existing = (item.contacts as Record<string, unknown>)[f]
      pre[f] = existing ? String(existing) : ''
    }
    setEditFields(pre)
  }

  const statusColors: Record<string, string> = {
    pending:   'bg-amber-600/10 border-amber-500/20 text-amber-400',
    in_review: 'bg-blue-600/10 border-blue-500/20 text-blue-400',
    enriched:  'bg-emerald-600/10 border-emerald-500/20 text-emerald-400',
    skipped:   'bg-white/[0.04] border-white/[0.08] text-gray-500',
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Enrichment Queue</h1>
          <p className="text-gray-500 text-sm mt-1">
            Contacts imported with missing fields — review and fill in manually
          </p>
        </div>
        <button onClick={() => load(1)} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/[0.08]
          bg-white/[0.03] text-gray-400 text-sm hover:text-white hover:border-white/[0.15] transition-all">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-2">
        {(['pending', 'enriched', 'skipped', 'all'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all
              ${statusFilter === s
                ? 'bg-blue-600/20 border border-blue-500/30 text-blue-300'
                : 'text-gray-500 hover:text-gray-300'}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <span className="ml-auto text-gray-600 text-sm flex items-center">
          {pagination.total.toLocaleString()} total
        </span>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        {loading ? (
          <div className="p-10 flex items-center justify-center">
            <svg className="w-6 h-6 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-emerald-400 font-medium">No {statusFilter === 'all' ? '' : statusFilter} items in queue</p>
            <p className="text-gray-600 text-sm mt-1">Import a CSV to populate the enrichment queue</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.05]">
                {['Company', 'Email', 'Missing fields', 'Batch', 'Status', ''].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.id}
                  className={`border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors
                    ${i % 2 === 0 ? '' : 'bg-white/[0.01]'}`}>
                  <td className="px-5 py-3">
                    <p className="text-white font-medium text-sm">{item.contacts?.company_name || '—'}</p>
                    <p className="text-gray-600 text-xs">{item.contacts?.contact_person || '—'}</p>
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-gray-400 text-xs font-mono">{item.contacts?.email}</p>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {item.missing_fields.map(f => (
                        <span key={f} className="px-1.5 py-0.5 rounded bg-amber-600/10 border border-amber-500/20 text-amber-400 text-[10px] font-medium">
                          {MISSING_FIELD_LABELS[f] || f}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-gray-600 text-xs">{item.import_batch || '—'}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-semibold uppercase ${statusColors[item.status]}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {item.status === 'pending' && (
                      <button onClick={() => openItem(item)}
                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors font-medium">
                        Enrich →
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => load(pagination.page - 1)} disabled={pagination.page <= 1}
            className="px-3 py-1.5 rounded-lg border border-white/[0.06] text-gray-400 text-xs disabled:opacity-30 hover:text-white transition-all">
            ← Prev
          </button>
          <span className="text-gray-600 text-xs">Page {pagination.page} of {pagination.totalPages}</span>
          <button onClick={() => load(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages}
            className="px-3 py-1.5 rounded-lg border border-white/[0.06] text-gray-400 text-xs disabled:opacity-30 hover:text-white transition-all">
            Next →
          </button>
        </div>
      )}

      {/* Edit drawer */}
      {activeItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setActiveItem(null)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative bg-[#161D27] border border-white/[0.08] rounded-2xl p-6 w-full max-w-md space-y-5" onClick={e => e.stopPropagation()}>
            <div>
              <p className="text-white font-semibold">Fill missing fields</p>
              <p className="text-gray-500 text-xs mt-0.5">{activeItem.contacts?.company_name} · {activeItem.contacts?.email}</p>
            </div>

            <div className="space-y-3">
              {activeItem.missing_fields.map(field => (
                <div key={field}>
                  <label className="text-xs font-medium text-gray-500 block mb-1.5">
                    {MISSING_FIELD_LABELS[field] || field}
                  </label>
                  <input
                    type="text"
                    value={editFields[field] || ''}
                    onChange={e => setEditFields(p => ({ ...p, [field]: e.target.value }))}
                    placeholder={`Enter ${MISSING_FIELD_LABELS[field] || field}`}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5
                               text-white placeholder-gray-600 text-sm
                               focus:outline-none focus:border-blue-500/50 transition-all"
                  />
                </div>
              ))}
            </div>

            <div className="flex gap-3 pt-1">
              <button onClick={() => handleSave('enriched')} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white text-sm font-semibold
                           disabled:opacity-40 hover:from-blue-500 hover:to-violet-500 transition-all">
                {saving ? 'Saving…' : 'Save & mark enriched'}
              </button>
              <button onClick={() => handleSave('skipped')} disabled={saving}
                className="px-4 py-2 rounded-xl border border-white/[0.08] text-gray-400 text-sm hover:text-white transition-all">
                Skip
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
