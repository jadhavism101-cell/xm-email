import type { BrevoWebhookEvent } from './brevo'
import type { CampaignSequence } from './supabase'

export type EnrollmentCandidate = {
  id: string
  campaign_id: string
  current_step: number
  status: string
  last_email_sent_at: string | null
  completed_at: string | null
  campaign_title: string
  sequence: CampaignSequence | null
}

export type EnrollmentMutation = {
  status?: 'active' | 'completed' | 'exited_by_rule' | 'unsubscribed'
  exit_reason?: string | null
  current_step?: number
  last_email_sent_at?: string | null
  completed_at?: string | null
}

function normalizeCampaignName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function campaignMatchesBrevoName(title: string, eventCampaignName: string): boolean {
  const left = normalizeCampaignName(title)
  const right = normalizeCampaignName(eventCampaignName)

  if (!left || !right) return false
  return left === right || left.includes(right) || right.includes(left)
}

export function selectEnrollmentForWebhookEvent(
  enrollments: EnrollmentCandidate[],
  eventCampaignName?: string | null,
): EnrollmentCandidate | null {
  if (enrollments.length === 0) return null

  const campaignName = (eventCampaignName || '').trim()
  if (campaignName) {
    const matched = enrollments.find((item) => campaignMatchesBrevoName(item.campaign_title, campaignName))
    if (matched) return matched
  }

  if (enrollments.length === 1) {
    return enrollments[0]
  }

  return null
}

export function resolveEnrollmentMutationForEvent(
  eventType: BrevoWebhookEvent['event'],
  enrollment: EnrollmentCandidate,
  occurredAt: string,
): EnrollmentMutation | null {
  if (eventType === 'delivered') {
    const totalSteps = Array.isArray(enrollment.sequence?.steps) ? enrollment.sequence.steps.length : 0
    if (totalSteps <= 0) return null

    const currentStep = Math.max(1, Number(enrollment.current_step || 1))

    if (currentStep >= totalSteps) {
      return {
        status: 'completed',
        current_step: totalSteps,
        completed_at: occurredAt,
        last_email_sent_at: occurredAt,
        exit_reason: 'sequence_completed',
      }
    }

    return {
      current_step: currentStep + 1,
      last_email_sent_at: occurredAt,
    }
  }

  if (eventType === 'hardBounce') {
    return {
      status: 'exited_by_rule',
      exit_reason: 'hardBounce',
      completed_at: occurredAt,
    }
  }

  if (eventType === 'unsubscribed' || eventType === 'spam') {
    return {
      status: 'unsubscribed',
      exit_reason: eventType,
      completed_at: occurredAt,
    }
  }

  return null
}