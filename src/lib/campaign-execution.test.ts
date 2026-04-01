import { describe, expect, it } from 'vitest'
import {
  campaignMatchesBrevoName,
  resolveEnrollmentMutationForEvent,
  selectEnrollmentForWebhookEvent,
  type EnrollmentCandidate,
} from './campaign-execution'

function buildEnrollment(overrides: Partial<EnrollmentCandidate> = {}): EnrollmentCandidate {
  return {
    id: 'enrollment-1',
    campaign_id: 'campaign-1',
    current_step: 1,
    status: 'active',
    last_email_sent_at: null,
    completed_at: null,
    campaign_title: 'Warm Lead Nurture',
    sequence: {
      steps: [
        { step: 1, timing_days: 0, subject: 'One', content_outline: ['a'], cta: 'Go', personalization_vars: [] },
        { step: 2, timing_days: 2, subject: 'Two', content_outline: ['b'], cta: 'Go', personalization_vars: [] },
      ],
      branches: [],
    },
    ...overrides,
  }
}

describe('campaign execution helpers', () => {
  it('matches campaign names with normalized formatting', () => {
    expect(campaignMatchesBrevoName('Warm Lead Nurture', 'warm-lead nurture')).toBe(true)
  })

  it('selects the only active enrollment when there is a single candidate', () => {
    const item = buildEnrollment()
    expect(selectEnrollmentForWebhookEvent([item], null)?.id).toBe(item.id)
  })

  it('advances to the next step when a delivery occurs before the final step', () => {
    const mutation = resolveEnrollmentMutationForEvent('delivered', buildEnrollment(), '2026-03-28T00:00:00.000Z')
    expect(mutation).toMatchObject({ current_step: 2, last_email_sent_at: '2026-03-28T00:00:00.000Z' })
  })

  it('completes the enrollment when the final step is delivered', () => {
    const mutation = resolveEnrollmentMutationForEvent(
      'delivered',
      buildEnrollment({ current_step: 2 }),
      '2026-03-28T00:00:00.000Z',
    )
    expect(mutation).toMatchObject({ status: 'completed', exit_reason: 'sequence_completed' })
  })

  it('exits by rule on hard bounce', () => {
    const mutation = resolveEnrollmentMutationForEvent('hardBounce', buildEnrollment(), '2026-03-28T00:00:00.000Z')
    expect(mutation).toMatchObject({ status: 'exited_by_rule', exit_reason: 'hardBounce' })
  })
})