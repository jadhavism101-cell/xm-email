/**
 * POST /api/campaigns/execute
 *
 * Runs the campaign execution pass: checks all active enrollments for due
 * drip steps and dispatches transactional emails via Brevo.
 *
 * Callable:
 *   - Manually from the dashboard (ops role or above)
 *   - Automatically by Vercel cron (every hour, secured by CRON_SECRET)
 *
 * Returns a summary of sends dispatched, skipped, and errors encountered.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardRole } from '@/lib/api-security'
import { logCampaignAuditEvent } from '@/lib/campaign-audit'
import { executeScheduledSends } from '@/lib/campaign-scheduler'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // seconds — allow up to 1 min for large batches

function isCronRequest(req: NextRequest): boolean {
  const cronSecret = (process.env.CRON_SECRET || '').trim()
  if (!cronSecret) return false
  const authHeader = req.headers.get('authorization') || ''
  return authHeader === `Bearer ${cronSecret}`
}

export async function POST(req: NextRequest) {
  // Allow either dashboard session (manual trigger) or cron bearer token
  const isCron = isCronRequest(req)
  if (!isCron) {
    const forbidden = requireDashboardRole(req, 'ops')
    if (forbidden) return forbidden
  }

  const now = new Date()

  let result
  try {
    result = await executeScheduledSends(now)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Execution failed' },
      { status: 500 },
    )
  }

  // Audit log the execution pass if anything was sent or errored
  if (result.sent > 0 || result.errors.length > 0) {
    await logCampaignAuditEvent({
      action: 'deploy', // closest action type — represents a batch dispatch pass
      campaignId: 'scheduler',
      actor: isCron ? 'cron@xm-email' : 'dashboard@xm-email',
      metadata: {
        executedAt: now.toISOString(),
        sent: result.sent,
        skipped: result.skipped,
        errors: result.errors.length,
      },
    })
  }

  return NextResponse.json({
    ok: true,
    executedAt: now.toISOString(),
    sent: result.sent,
    skipped: result.skipped,
    errors: result.errors,
    sentDetails: result.sentDetails,
  })
}
