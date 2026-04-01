'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  campaignId: string
  status: string
}

export default function CampaignStatusActions({ campaignId, status }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canDeploy = status !== 'active' && status !== 'archived'
  const canPause = status === 'active'
  const deployLabel = status === 'paused' ? 'Resume' : 'Deploy'

  async function runAction(action: 'deploy' | 'pause') {
    setLoading(true)
    setError('')

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/${action}`, {
        method: 'POST',
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) {
        const issues = Array.isArray(json?.preflight?.issues)
          ? json.preflight.issues.slice(0, 2).map((issue: { message?: string }) => issue.message).filter(Boolean)
          : []
        const detail = issues.length > 0 ? `: ${issues.join(' ')}` : ''
        throw new Error(`${json?.error || `Failed to ${action} campaign`}${detail}`)
      }

      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} campaign`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      {canDeploy && (
        <button
          onClick={() => runAction('deploy')}
          disabled={loading}
          className="text-emerald-400 hover:text-emerald-300 transition-colors text-xs font-medium disabled:opacity-60"
        >
          {deployLabel}
        </button>
      )}
      {canPause && (
        <button
          onClick={() => runAction('pause')}
          disabled={loading}
          className="text-amber-400 hover:text-amber-300 transition-colors text-xs font-medium disabled:opacity-60"
        >
          Pause
        </button>
      )}
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </div>
  )
}
