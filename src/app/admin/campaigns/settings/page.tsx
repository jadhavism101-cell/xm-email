"use client"

import { useEffect, useMemo, useState } from 'react'

export const dynamic = 'force-dynamic'

type SenderProfile = {
  name: string
  email: string
  note: string
}

type SettingsState = {
  brevoApiKey: string
  sendingDomain: string
  maxEmailsPerContactPerDay: number
  defaultSendTime: string
  senderProfiles: SenderProfile[]
}

const DEFAULT_SETTINGS: SettingsState = {
  brevoApiKey: '',
  sendingDomain: '',
  maxEmailsPerContactPerDay: 1,
  defaultSendTime: '10:00',
  senderProfiles: [
    { name: 'Sales drips', email: 'saurabh@xtramiles.com', note: 'Uses assigned salesperson name' },
    { name: 'Onboarding', email: 'team@xtramiles.com', note: 'Generic team sender' },
    { name: 'Re-engagement', email: 'saurabh@xtramiles.com', note: 'Founder touch - feels personal' },
  ],
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState<string>('')
  const [error, setError] = useState<string>('')

  const canTest = useMemo(() => settings.brevoApiKey.trim().length > 0, [settings.brevoApiKey])

  useEffect(() => {
    async function loadSettings() {
      setLoading(true)
      setError('')
      try {
        const res = await fetch('/api/campaigns/settings', { cache: 'no-store' })
        const json = await res.json()
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || 'Failed to load settings')
        }
        setSettings({ ...DEFAULT_SETTINGS, ...(json.settings || {}) })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings')
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [])

  async function saveSettings() {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/campaigns/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to save settings')
      }
      setMessage('Settings saved successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  async function testConnection() {
    setTesting(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/campaigns/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: settings.brevoApiKey }),
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Connection test failed')
      }
      setMessage('Brevo connection successful')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection test failed')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-gray-500 text-sm mt-1">Brevo configuration, sender profiles, and frequency caps</p>
      </div>

      <div className="space-y-4 max-w-2xl">
        {loading && <p className="text-sm text-gray-500">Loading settings...</p>}
        {!loading && error && <p className="text-sm text-red-400">{error}</p>}
        {!loading && message && <p className="text-sm text-emerald-400">{message}</p>}

        {/* Brevo config */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 space-y-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
              </svg>
            </div>
            <div>
              <p className="text-white text-sm font-semibold">Brevo Integration</p>
              <p className="text-gray-500 text-xs">Connect your Brevo account to enable email automation</p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1.5">Brevo API Key</label>
              <input
                type="password"
                placeholder="xkeysib-…"
                value={settings.brevoApiKey}
                onChange={(e) => setSettings((prev) => ({ ...prev, brevoApiKey: e.target.value }))}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5
                           text-white placeholder-gray-600 text-sm
                           focus:outline-none focus:border-blue-500/50 transition-all duration-150"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1.5">Sending Domain</label>
              <input
                type="text"
                placeholder="mail.xtramiles.com"
                value={settings.sendingDomain}
                onChange={(e) => setSettings((prev) => ({ ...prev, sendingDomain: e.target.value }))}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5
                           text-white placeholder-gray-600 text-sm
                           focus:outline-none focus:border-blue-500/50 transition-all duration-150"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={saveSettings}
              disabled={loading || saving}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600
                             text-white text-sm font-semibold hover:from-blue-500 hover:to-violet-500
                             transition-all duration-150 shadow-lg shadow-blue-600/20 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            <button
              onClick={testConnection}
              disabled={loading || testing || !canTest}
              className="px-4 py-2 rounded-xl border border-white/[0.1] bg-white/[0.03]
                             text-white text-sm font-semibold hover:bg-white/[0.06]
                             transition-all duration-150 disabled:opacity-60"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
          </div>
        </div>

        {/* Frequency caps */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 space-y-4">
          <div>
            <p className="text-white text-sm font-semibold">Frequency Caps</p>
            <p className="text-gray-500 text-xs mt-0.5">Prevent contacts from receiving too many emails</p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-300 text-sm">Max emails per contact per day</p>
                <p className="text-gray-600 text-xs">Across all campaigns combined</p>
              </div>
              <input
                type="number"
                min={1}
                value={settings.maxEmailsPerContactPerDay}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    maxEmailsPerContactPerDay: Math.max(1, Number(e.target.value || 1)),
                  }))
                }
                className="w-16 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-white text-sm text-center"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-300 text-sm">Default send time</p>
                <p className="text-gray-600 text-xs">IST — Brevo best-time optimization available</p>
              </div>
              <input
                type="time"
                value={settings.defaultSendTime}
                onChange={(e) => setSettings((prev) => ({ ...prev, defaultSendTime: e.target.value }))}
                className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-white text-sm"
              />
            </div>
          </div>
        </div>

        {/* Sender profiles */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 space-y-4">
          <div>
            <p className="text-white text-sm font-semibold">Sender Profiles</p>
            <p className="text-gray-500 text-xs mt-0.5">Who emails appear to come from</p>
          </div>
          <div className="space-y-2">
            {settings.senderProfiles.map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-xl bg-white/[0.02] border border-white/[0.05] px-4 py-3">
                <div>
                  <p className="text-gray-300 text-sm">{p.name}</p>
                  <p className="text-gray-600 text-xs">{p.note}</p>
                </div>
                <p className="text-gray-400 text-xs font-mono">{p.email}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
