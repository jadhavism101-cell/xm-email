import { supabaseAdmin } from '@/lib/supabase'

export type CampaignAuditAction = 'activate' | 'pause' | 'enroll' | 'deploy'

export type CampaignAuditEvent = {
  action: CampaignAuditAction
  campaignId: string
  /** Email or system identifier for the actor. Defaults to 'dashboard@xm-email' for system actions. */
  actor: string
  /** UUID of the actor if available (nullable). */
  actorId?: string | null
  /** IP address of the request if available (nullable). */
  ipAddress?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Logs campaign actions to admin_audit_log (primary sink).
 * Falls back silently to campaign_ai_sessions if the primary write fails,
 * preserving backward compatibility until the migration is fully verified.
 */
export async function logCampaignAuditEvent(event: CampaignAuditEvent): Promise<void> {
  const now = new Date().toISOString()

  // Resolve actor_email: use provided actor, or fall back to system sentinel.
  const actorEmail =
    event.actor && event.actor !== 'dashboard'
      ? event.actor
      : 'dashboard@xm-email'

  // Primary sink: admin_audit_log
  const { error: primaryError } = await supabaseAdmin.from('admin_audit_log').insert({
    actor_id: event.actorId ?? null,
    actor_email: actorEmail,
    action: event.action,
    entity_type: 'drip_campaign',
    entity_id: event.campaignId,
    after_value: event.metadata ?? null,
    ip_address: event.ipAddress ?? null,
    notes: null,
  })

  if (!primaryError) return

  // Fallback: campaign_ai_sessions — kept until primary sink is verified in production.
  console.error('[campaign-audit] admin_audit_log write failed, falling back to campaign_ai_sessions:', primaryError.message)

  const payload = { ...event, at: now }
  const { error: fallbackError } = await supabaseAdmin.from('campaign_ai_sessions').insert({
    campaign_id: event.campaignId,
    created_by: 'system/audit',
    messages: [
      {
        role: 'assistant',
        content: JSON.stringify(payload),
        timestamp: now,
      },
    ],
  })

  if (fallbackError) {
    // Do not break user actions for audit-only failures.
    console.error('[campaign-audit] fallback also failed:', fallbackError.message)
  }
}
