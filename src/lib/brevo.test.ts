import { describe, expect, it } from 'vitest'
import { getBrevoRetryDelayMs, isRetryableBrevoStatus } from './brevo'

describe('brevo retry helpers', () => {
  it('marks transient Brevo statuses as retryable', () => {
    expect(isRetryableBrevoStatus(429)).toBe(true)
    expect(isRetryableBrevoStatus(503)).toBe(true)
    expect(isRetryableBrevoStatus(400)).toBe(false)
  })

  it('backs off with a capped exponential delay', () => {
    expect(getBrevoRetryDelayMs(0)).toBe(250)
    expect(getBrevoRetryDelayMs(1)).toBe(500)
    expect(getBrevoRetryDelayMs(5)).toBe(1500)
  })
})