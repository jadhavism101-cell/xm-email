"use client"

import { useMemo, useState } from 'react'
import { toCampaignDraftPayload, type CampaignDraftPayload } from '@/lib/campaign-draft'

export const dynamic = 'force-dynamic'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

type AudienceEstimate = {
  total: number | null
  resolvedSegments: string[]
  inferenceSource: 'explicit' | 'campaign_type' | 'none'
  deliverableOnly: boolean
  filtersApplied: Record<string, unknown>
  note: string
}

function formatSegmentLabel(value: string): string {
  return value.replace(/_/g, ' ')
}

function formatInferenceSource(value: AudienceEstimate['inferenceSource']): string {
  if (value === 'campaign_type') return 'inferred from campaign type'
  if (value === 'explicit') return 'taken from AI target segment'
  return 'not resolved yet'
}

export default function AiBuilderPage() {
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [draft, setDraft] = useState<CampaignDraftPayload | null>(null)
  const [audienceEstimate, setAudienceEstimate] = useState<AudienceEstimate | null>(null)
  const [draftParseError, setDraftParseError] = useState('')

  const lastAssistant = useMemo(
    () => [...messages].reverse().find((msg) => msg.role === 'assistant')?.content || '',
    [messages],
  )

  async function sendPrompt() {
    const prompt = input.trim()
    if (!prompt || loading) return

    setLoading(true)
    setError('')
    setSuccessMessage('')
    setDraftParseError('')
    setInput('')

    const optimisticUserMessage: ChatMessage = {
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticUserMessage])

    try {
      const res = await fetch('/api/campaigns/ai-builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, sessionId }),
      })

      const json = await res.json()
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to generate campaign draft')
      }

      if (json.sessionId) {
        setSessionId(String(json.sessionId))
      }

      if (Array.isArray(json.messages)) {
        setMessages(json.messages as ChatMessage[])
      }

      setDraft((json.draft as CampaignDraftPayload | null) || null)
      setAudienceEstimate((json.audienceEstimate as AudienceEstimate | null) || null)
      setDraftParseError(typeof json.draftParseError === 'string' ? json.draftParseError : '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate campaign draft')
    } finally {
      setLoading(false)
    }
  }

  async function saveAsDraft() {
    if (!lastAssistant || savingDraft) return

    setSavingDraft(true)
    setError('')
    setSuccessMessage('')

    try {
      const payload = draft || toCampaignDraftPayload(lastAssistant)
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const json = await res.json()
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to save campaign draft')
      }

      setSuccessMessage('Campaign draft saved successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save campaign draft')
    } finally {
      setSavingDraft(false)
    }
  }

  function resolveFileNameBase(payload: CampaignDraftPayload): string {
    return (
      (payload.title || 'ai-draft-campaign')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'ai-draft-campaign'
    )
  }

  function downloadBlob(content: string, mimeType: string, filename: string) {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  function exportDraftJson() {
    try {
      const payload = draft || (lastAssistant ? toCampaignDraftPayload(lastAssistant) : null)
      if (!payload) { setError('No valid campaign draft is available to export'); return }
      downloadBlob(JSON.stringify(payload, null, 2), 'application/json', `${resolveFileNameBase(payload)}.json`)
      setSuccessMessage('Campaign draft exported as JSON')
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export campaign draft')
    }
  }

  function exportDraftMarkdown() {
    try {
      const payload = draft || (lastAssistant ? toCampaignDraftPayload(lastAssistant) : null)
      if (!payload) { setError('No valid campaign draft is available to export'); return }

      const lines: string[] = []
      const date = new Date().toISOString().split('T')[0]

      lines.push(`# ${payload.title || 'Untitled Campaign'}`)
      lines.push('')
      lines.push(`> **Goal:** ${payload.goal || '—'}`)
      lines.push(`> **Type:** ${(payload.campaign_type || '').replace(/_/g, ' ')}`)
      lines.push(`> **Generated:** ${date}`)
      lines.push('')

      // Audience
      if (audienceEstimate) {
        lines.push('## Audience Estimate')
        lines.push('')
        if (audienceEstimate.total != null) {
          lines.push(`- **Estimated contacts:** ${audienceEstimate.total.toLocaleString()}`)
        }
        if (audienceEstimate.resolvedSegments.length > 0) {
          lines.push(`- **Segments:** ${audienceEstimate.resolvedSegments.map(s => s.replace(/_/g, ' ')).join(', ')}`)
        }
        lines.push(`- **Inference source:** ${formatInferenceSource(audienceEstimate.inferenceSource)}`)
        if (audienceEstimate.note) lines.push(`- ${audienceEstimate.note}`)
        lines.push('')
      }

      // Sequence
      lines.push('## Email Sequence')
      lines.push('')
      for (const step of payload.sequence.steps) {
        lines.push(`### Step ${step.step} — Day ${step.timing_days}: ${step.subject}`)
        if (step.preview_text) lines.push(`*${step.preview_text}*`)
        lines.push('')
        if (step.content_outline.length > 0) {
          lines.push('**Content outline:**')
          for (const item of step.content_outline) {
            lines.push(`- ${item}`)
          }
          lines.push('')
        }
        const ctaLine = step.cta_url
          ? `**CTA:** [${step.cta}](${step.cta_url})`
          : `**CTA:** ${step.cta}`
        lines.push(ctaLine)
        if (step.personalization_vars.length > 0) {
          lines.push(`**Personalization:** ${step.personalization_vars.join(', ')}`)
        }
        lines.push('')
      }

      // Branches
      if (payload.sequence.branches.length > 0) {
        lines.push('## Conditional Branches')
        lines.push('')
        for (const branch of payload.sequence.branches) {
          lines.push(`- **Trigger:** ${branch.trigger} → **Action:** ${branch.action}`)
        }
        lines.push('')
      }

      // Exit conditions
      if (payload.exit_conditions && Object.keys(payload.exit_conditions).length > 0) {
        lines.push('## Exit Conditions')
        lines.push('')
        lines.push('```json')
        lines.push(JSON.stringify(payload.exit_conditions, null, 2))
        lines.push('```')
        lines.push('')
      }

      downloadBlob(lines.join('\n'), 'text/markdown', `${resolveFileNameBase(payload)}.md`)
      setSuccessMessage('Campaign spec exported as Markdown')
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export Markdown')
    }
  }

  function exportDraftPdf() {
    try {
      const payload = draft || (lastAssistant ? toCampaignDraftPayload(lastAssistant) : null)
      if (!payload) { setError('No valid campaign draft is available to export'); return }

      const date = new Date().toISOString().split('T')[0]
      const stepsHtml = payload.sequence.steps.map(step => {
        const outlineHtml = step.content_outline.length > 0
          ? `<ul>${step.content_outline.map(i => `<li>${i}</li>`).join('')}</ul>`
          : ''
        const ctaHtml = step.cta_url
          ? `<a href="${step.cta_url}" class="cta">${step.cta}</a>`
          : `<span class="cta-plain">${step.cta}</span>`
        const varsHtml = step.personalization_vars.length > 0
          ? `<p class="vars">Personalization: ${step.personalization_vars.join(', ')}</p>`
          : ''
        return `
          <div class="step">
            <div class="step-header">
              <span class="step-num">Step ${step.step}</span>
              <span class="step-day">Day ${step.timing_days}</span>
            </div>
            <h3>${step.subject}</h3>
            ${step.preview_text ? `<p class="preview">${step.preview_text}</p>` : ''}
            ${outlineHtml}
            <div class="step-footer">${ctaHtml}${varsHtml}</div>
          </div>`
      }).join('')

      const audienceHtml = audienceEstimate && audienceEstimate.total != null
        ? `<p class="meta">Estimated audience: <strong>${audienceEstimate.total.toLocaleString()} contacts</strong>
           (${audienceEstimate.resolvedSegments.map(s => s.replace(/_/g, ' ')).join(', ')})</p>`
        : ''

      const html = `<!doctype html><html><head><meta charset="utf-8">
        <title>${payload.title}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111; max-width: 720px; margin: 0 auto; padding: 32px; }
          h1 { font-size: 24px; margin-bottom: 4px; }
          .goal { color: #555; font-size: 14px; margin-bottom: 4px; }
          .meta { color: #555; font-size: 13px; margin-bottom: 24px; }
          .type-badge { display: inline-block; background: #ede9fe; color: #5b21b6; border-radius: 4px; padding: 2px 8px; font-size: 12px; font-weight: 600; }
          h2 { font-size: 16px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-top: 32px; }
          .step { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; }
          .step-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
          .step-num { font-weight: 700; font-size: 12px; color: #2563eb; text-transform: uppercase; }
          .step-day { font-size: 12px; color: #888; }
          .step h3 { font-size: 15px; margin: 0 0 6px 0; }
          .preview { color: #777; font-size: 13px; font-style: italic; margin-bottom: 10px; }
          ul { margin: 8px 0 12px 0; padding-left: 20px; }
          li { font-size: 13px; color: #374151; margin-bottom: 3px; }
          .step-footer { margin-top: 10px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
          .cta { background: #2563eb; color: #fff; text-decoration: none; padding: 5px 12px; border-radius: 4px; font-size: 13px; font-weight: 600; }
          .cta-plain { background: #f3f4f6; color: #111; padding: 5px 12px; border-radius: 4px; font-size: 13px; font-weight: 600; }
          .vars { font-size: 11px; color: #9ca3af; margin: 0; }
          .date { font-size: 11px; color: #bbb; margin-top: 40px; }
          @media print { body { padding: 0; } }
        </style>
      </head><body>
        <h1>${payload.title || 'Untitled Campaign'}</h1>
        <p class="goal">${payload.goal || ''}</p>
        <p class="meta">
          <span class="type-badge">${(payload.campaign_type || '').replace(/_/g, ' ')}</span>
          &nbsp;&nbsp;Generated ${date}
        </p>
        ${audienceHtml}
        <h2>Email Sequence (${payload.sequence.steps.length} steps)</h2>
        ${stepsHtml}
        <p class="date">Exported from XtraMiles xm-email · ${date}</p>
      </body></html>`

      const win = window.open('', '_blank')
      if (!win) { setError('Pop-up blocked — please allow pop-ups and try again'); return }
      win.document.write(html)
      win.document.close()
      win.focus()
      win.print()
      setSuccessMessage('PDF print dialog opened')
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export PDF')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">AI Campaign Builder</h1>
        <p className="text-gray-500 text-sm mt-1">
          Describe your campaign goal and Gemini will generate a complete campaign draft with sequence, timing, and CTA structure.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-[620px]">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 flex flex-col">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-600 mb-4">Chat with Gemini</p>

          <div className="flex-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/10 p-4 space-y-3">
            {messages.length === 0 ? (
              <p className="text-gray-600 text-sm">Try: Build a 6-step warm lead nurture campaign for exporters with two CTAs.</p>
            ) : (
              messages.map((msg, idx) => (
                <div
                  key={`${msg.timestamp}-${idx}`}
                  className={`rounded-xl px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-600/15 border border-blue-500/20 text-blue-100'
                      : 'bg-white/[0.03] border border-white/[0.06] text-gray-200'
                  }`}
                >
                  <p className="text-[10px] uppercase tracking-wider opacity-70 mb-1">{msg.role}</p>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              ))
            )}
          </div>

          {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
          {!error && successMessage && <p className="text-emerald-400 text-xs mt-3">{successMessage}</p>}

          <div className="mt-4 flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe your campaign objective, audience, and tone..."
              className="flex-1 min-h-[84px] bg-white/[0.03] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50"
            />
            <button
              onClick={sendPrompt}
              disabled={loading || input.trim().length === 0}
              className="self-end px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white text-sm font-semibold disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">Campaign Preview</p>
            <div className="flex items-center gap-2">
              <button
                onClick={exportDraftMarkdown}
                disabled={!lastAssistant}
                className="px-3 py-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] text-white text-xs font-medium hover:bg-white/[0.08] disabled:opacity-50"
                title="Export as Markdown spec"
              >
                Export .md
              </button>
              <button
                onClick={exportDraftPdf}
                disabled={!lastAssistant}
                className="px-3 py-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] text-white text-xs font-medium hover:bg-white/[0.08] disabled:opacity-50"
                title="Export as PDF (opens print dialog)"
              >
                Export PDF
              </button>
              <button
                onClick={exportDraftJson}
                disabled={!lastAssistant}
                className="px-3 py-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] text-white text-xs font-medium hover:bg-white/[0.08] disabled:opacity-50"
                title="Export raw JSON payload"
              >
                Export JSON
              </button>
              <button
                onClick={saveAsDraft}
                disabled={!lastAssistant || savingDraft}
                className="px-3 py-1.5 rounded-lg border border-blue-500/30 bg-blue-600/10 text-blue-300 text-xs font-medium hover:bg-blue-600/20 disabled:opacity-50"
              >
                {savingDraft ? 'Saving...' : 'Save as Draft'}
              </button>
            </div>
          </div>
          <div className="flex-1 rounded-xl border border-white/[0.06] bg-black/10 p-4 overflow-y-auto">
            {draft ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-gray-600">Campaign</p>
                    <p className="text-white text-sm font-semibold mt-1">{draft.title}</p>
                    <p className="text-gray-400 text-xs mt-1">{draft.goal}</p>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-gray-600">Audience Estimate</p>
                    <p className="text-white text-sm font-semibold mt-1">
                      {audienceEstimate?.total == null ? 'Pending resolution' : `${audienceEstimate.total.toLocaleString()} contacts`}
                    </p>
                    <p className="text-gray-400 text-xs mt-1">
                      {audienceEstimate ? formatInferenceSource(audienceEstimate.inferenceSource) : 'No estimate yet'}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-white text-sm font-semibold">Sequence Summary</p>
                    <span className="text-xs text-gray-500">{draft.sequence.steps.length} steps</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.03] text-xs text-gray-300">
                      {draft.campaign_type.replace(/_/g, ' ')}
                    </span>
                    {audienceEstimate?.resolvedSegments.map((segment) => (
                      <span
                        key={segment}
                        className="px-2 py-1 rounded-md border border-blue-500/20 bg-blue-500/10 text-xs text-blue-300"
                      >
                        {formatSegmentLabel(segment)}
                      </span>
                    ))}
                  </div>
                  {audienceEstimate?.note && (
                    <p className="text-xs text-gray-500">{audienceEstimate.note}</p>
                  )}
                  {draftParseError && <p className="text-xs text-amber-300">{draftParseError}</p>}
                </div>

                <div className="space-y-3">
                  {draft.sequence.steps.map((step) => (
                    <div key={step.step} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-white text-sm font-semibold">Step {step.step}: {step.subject}</p>
                        <span className="text-xs text-gray-500">Day {step.timing_days}</span>
                      </div>
                      {step.preview_text && <p className="text-gray-400 text-xs mt-1">{step.preview_text}</p>}
                      {step.content_outline.length > 0 && (
                        <ul className="mt-3 space-y-1 text-xs text-gray-300 list-disc list-inside">
                          {step.content_outline.map((item, index) => (
                            <li key={`${step.step}-${index}`}>{item}</li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.03] text-gray-300">
                          CTA: {step.cta}
                        </span>
                        {step.personalization_vars.map((item) => (
                          <span
                            key={`${step.step}-${item}`}
                            className="px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.03] text-gray-400"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <details className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <summary className="cursor-pointer text-xs font-medium text-gray-400">Raw AI output</summary>
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed mt-3">{lastAssistant}</pre>
                </details>
              </div>
            ) : lastAssistant ? (
              <div className="space-y-3">
                {draftParseError && <p className="text-amber-300 text-xs">{draftParseError}</p>}
                <pre className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">{lastAssistant}</pre>
              </div>
            ) : (
              <p className="text-gray-600 text-sm">Generated campaign JSON/spec will appear here.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
