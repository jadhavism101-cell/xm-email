"use client"

import { useEffect, useState } from 'react'

export const dynamic = 'force-dynamic'

type TemplateItem = {
  id: number
  name: string
  subject: string | null
  isActive: boolean | null
  modifiedAt: string | null
  createdAt: string | null
}

export default function TemplatesPage() {
  const [items, setItems] = useState<TemplateItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadTemplates() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/campaigns/templates?limit=50', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to load templates')
      }
      setItems(Array.isArray(json.items) ? json.items : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTemplates()
  }, [])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Email Templates</h1>
        <p className="text-gray-500 text-sm mt-1">Templates synced with Brevo — manage and preview email designs</p>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 text-sm text-gray-500">
          Loading templates...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 space-y-3">
          <p className="text-red-300 text-sm">{error}</p>
          <a
            href="/admin/campaigns/settings"
            className="inline-block px-4 py-2 rounded-xl border border-white/[0.08] bg-white/[0.04]
                       text-white text-sm font-medium hover:bg-white/[0.08] transition-all duration-150"
          >
            Go to Settings
          </a>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
          <div className="w-12 h-12 rounded-2xl bg-amber-600/10 border border-amber-500/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
              />
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
      ) : (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
            <p className="text-white text-sm font-semibold">Brevo Templates</p>
            <button
              onClick={loadTemplates}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              Refresh
            </button>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-white/[0.02] border-b border-white/[0.06]">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-400">Name</th>
                <th className="px-6 py-3 font-medium text-gray-400">Subject</th>
                <th className="px-6 py-3 font-medium text-gray-400">Status</th>
                <th className="px-6 py-3 font-medium text-gray-400">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-6 py-3 text-white">{item.name}</td>
                  <td className="px-6 py-3 text-gray-300">{item.subject || '—'}</td>
                  <td className="px-6 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-md text-xs border ${
                        item.isActive
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-white/5 text-gray-400 border-white/10'
                      }`}
                    >
                      {item.isActive ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-gray-400">
                    {item.modifiedAt ? new Date(item.modifiedAt).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
