/**
 * Brevo (formerly Sendinblue) API client for xm-email
 * Docs: https://developers.brevo.com/reference
 */

const BREVO_API_KEY = process.env.BREVO_API_KEY || ''
const BASE_URL = 'https://api.brevo.com/v3'
const BREVO_MAX_ATTEMPTS = 3

// ── Brevo list IDs (created 2026-03-25) ────────────────────────────────────
export const BREVO_LISTS = {
  ACTIVE_CUSTOMERS:    3,   // shipped < 30 days
  LAPSED_CUSTOMERS:    4,   // shipped > 30d, health < 40
  WARM_LEADS:          5,   // signed up, never shipped
  COLD_CSV:            6,   // CSV import, no prior relationship
  ALL_CONTACTS:        7,   // master list
} as const

export type BrevoListId = (typeof BREVO_LISTS)[keyof typeof BREVO_LISTS]

// ── Types ──────────────────────────────────────────────────────────────────

export interface BrevoContact {
  email: string
  attributes?: Record<string, string | number | boolean | null>
  listIds?: number[]
  updateEnabled?: boolean
}

export interface BrevoContactResponse {
  id: number
  email: string
  attributes: Record<string, unknown>
  listIds: number[]
  createdAt: string
  modifiedAt: string
}

export interface BrevoWebhookEvent {
  event: 'delivered' | 'opened' | 'clicked' | 'click' | 'softBounce' | 'hardBounce' | 'unsubscribed' | 'spam'
  email: string
  messageId: string
  subject?: string
  link?: string
  date: string
  ts: number
  ts_event: number
  'message-id': string
  camp_name?: string
  list_id?: number[]
  sender_email?: string
}

export interface BrevoImportResult {
  created: number
  updated: number
  failed: number
  errors: { email: string; error: string }[]
}

export interface BrevoTemplateSummary {
  id: number
  name: string
  subject: string | null
  isActive: boolean | null
  modifiedAt: string | null
  createdAt: string | null
}

export interface BrevoSmtpTemplateUpsertInput {
  name: string
  subject: string
  htmlContent: string
  senderName: string
  senderEmail: string
  replyToEmail?: string | null
  existingTemplateId?: number | null
}

export interface BrevoSmtpTemplateUpsertResult {
  templateId: number
  created: boolean
}

export interface BrevoWebhookSummary {
  id: number
  url: string
  description?: string | null
  events?: string[]
  type?: string | null
  channel?: string | null
}

export class BrevoApiError extends Error {
  status: number | null
  path: string
  transient: boolean

  constructor(message: string, options: { status?: number | null; path: string; transient: boolean }) {
    super(message)
    this.name = 'BrevoApiError'
    this.status = options.status ?? null
    this.path = options.path
    this.transient = options.transient
  }
}

export function isRetryableBrevoStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

export function getBrevoRetryDelayMs(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 1500)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function formatBrevoError(error: unknown): string {
  if (error instanceof BrevoApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Unknown Brevo error'
}

// ── HTTP helper ───────────────────────────────────────────────────────────

async function brevoFetch<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<T> {
  let lastError: unknown = null

  for (let attempt = 0; attempt < BREVO_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      })

      if (!res.ok) {
        const text = await res.text()
        const error = new BrevoApiError(`Brevo API error [${res.status}] ${path}: ${text}`, {
          status: res.status,
          path,
          transient: isRetryableBrevoStatus(res.status),
        })

        if (!error.transient || attempt === BREVO_MAX_ATTEMPTS - 1) {
          throw error
        }

        lastError = error
        await sleep(getBrevoRetryDelayMs(attempt))
        continue
      }

      if (res.status === 204) return {} as T
      return res.json() as Promise<T>
    } catch (error) {
      const retryable = error instanceof BrevoApiError ? error.transient : true
      if (!retryable || attempt === BREVO_MAX_ATTEMPTS - 1) {
        throw error
      }

      lastError = error
      await sleep(getBrevoRetryDelayMs(attempt))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Brevo request failed')
}

// ── Contact operations ────────────────────────────────────────────────────

/**
 * Create or update a single contact in Brevo.
 * Returns the Brevo contact ID.
 */
export async function upsertBrevoContact(contact: BrevoContact): Promise<number | null> {
  const result = await upsertBrevoContactResult(contact)
  return result.id
}

export async function upsertBrevoContactResult(
  contact: BrevoContact,
): Promise<{ id: number | null; error: string | null }> {
  try {
    const result = await brevoFetch<{ id?: number }>('/contacts', 'POST', {
      ...contact,
      updateEnabled: true,
    })
    return {
      id: result.id ?? null,
      error: result.id ? null : 'Brevo did not return a contact id',
    }
  } catch (error) {
    return {
      id: null,
      error: formatBrevoError(error),
    }
  }
}

/**
 * Get a contact from Brevo by email.
 */
export async function getBrevoContact(email: string): Promise<BrevoContactResponse | null> {
  try {
    return await brevoFetch<BrevoContactResponse>(`/contacts/${encodeURIComponent(email)}`)
  } catch {
    return null
  }
}

/**
 * Batch import contacts into Brevo.
 * Brevo supports up to 1000 contacts per batch import call.
 */
export async function batchImportBrevoContacts(
  contacts: BrevoContact[],
  listIds: number[],
): Promise<{ processId: number } | null> {
  // Build CSV body for batch import
  if (contacts.length === 0) return null

  const headers = ['EMAIL', 'FIRST_NAME', 'LAST_NAME', 'COMPANY_NAME', 'PHONE',
    'LEAD_SOURCE', 'LEAD_STATUS', 'CONTACT_TYPE', 'ASSIGNED_TO', 'ASSIGNED_TO_EMAIL',
    'LEAD_SCORE', 'CUSTOMER_HEALTH', 'SIGNUP_DATE', 'TAGS']

  const rows = contacts.map(c => {
    const a = c.attributes || {}
    return [
      c.email,
      a.FIRST_NAME ?? '',
      a.LAST_NAME ?? '',
      a.COMPANY_NAME ?? '',
      a.PHONE ?? '',
      a.LEAD_SOURCE ?? '',
      a.LEAD_STATUS ?? '',
      a.CONTACT_TYPE ?? '',
      a.ASSIGNED_TO ?? '',
      a.ASSIGNED_TO_EMAIL ?? '',
      a.LEAD_SCORE ?? '',
      a.CUSTOMER_HEALTH ?? '',
      a.SIGNUP_DATE ?? '',
      a.TAGS ?? '',
    ].map(v => String(v).replace(/,/g, ' ')).join(',')
  })

  const fileBody = [headers.join(','), ...rows].join('\n')

  try {
    return await brevoFetch<{ processId: number }>('/contacts/import', 'POST', {
      fileBody,
      listIds,
      updateEnabled: true,
    })
  } catch {
    return null
  }
}

/**
 * Remove a contact from a Brevo list.
 */
export async function removeFromBrevoList(email: string, listId: number): Promise<boolean> {
  try {
    await brevoFetch(`/contacts/lists/${listId}/contacts/remove`, 'POST', {
      emails: [email],
    })
    return true
  } catch {
    return false
  }
}

/**
 * Add a contact to a Brevo list.
 */
export async function addToBrevoList(email: string, listId: number): Promise<boolean> {
  try {
    await brevoFetch(`/contacts/lists/${listId}/contacts/add`, 'POST', {
      emails: [email],
    })
    return true
  } catch {
    return false
  }
}

// ── Webhook helpers ───────────────────────────────────────────────────────

export async function listBrevoWebhooks(limit = 50): Promise<BrevoWebhookSummary[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100)

  const result = await brevoFetch<{
    webhooks?: Array<{
      id: number
      url: string
      description?: string
      events?: string[]
      type?: string
      channel?: string
    }>
  }>(`/webhooks?limit=${safeLimit}&offset=0`)

  return (result.webhooks || []).map((webhook) => ({
    id: webhook.id,
    url: webhook.url,
    description: webhook.description ?? null,
    events: webhook.events || [],
    type: webhook.type ?? null,
    channel: webhook.channel ?? null,
  }))
}

/**
 * Register a webhook endpoint in Brevo.
 * Call this once during initial setup.
 */
export async function registerBrevoWebhook(
  webhookUrl: string,
): Promise<{ id: number; alreadyExists?: boolean } | null> {
  try {
    const existingWebhooks = await listBrevoWebhooks(100)
    const existing = existingWebhooks.find((webhook) => webhook.url === webhookUrl)
    if (existing) {
      return { id: existing.id, alreadyExists: true }
    }
  } catch {
    // Ignore list failures and still attempt create.
  }

  try {
    return await brevoFetch<{ id: number }>('/webhooks', 'POST', {
      url: webhookUrl,
      description: 'xm-email engagement tracking',
      events: ['delivered', 'opened', 'click', 'softBounce', 'hardBounce', 'unsubscribed', 'spam'],
      type: 'transactional',
    })
  } catch {
    // Retry by checking whether webhook already exists now (e.g. duplicate URL race).
    try {
      const existingWebhooks = await listBrevoWebhooks(100)
      const existing = existingWebhooks.find((webhook) => webhook.url === webhookUrl)
      if (existing) {
        return { id: existing.id, alreadyExists: true }
      }
    } catch {
      // Ignore and return null below.
    }

    return null
  }
}

// ── Contact attribute mapping ─────────────────────────────────────────────

/**
 * Map a Supabase contact record to Brevo attributes.
 * These must match your custom attribute names in Brevo account settings.
 */
export function contactToBrevoAttributes(contact: {
  company_name: string
  contact_person: string
  phone?: string | null
  source?: string | null
  status?: string | null
  type?: string | null
  score?: number | null
  health_score?: number | null
  created_at?: string
  tags?: string[]
  assigned_to_name?: string | null
  assigned_to_email?: string | null
}): Record<string, string | number | null> {
  const [firstName, ...lastParts] = (contact.contact_person || '').trim().split(' ')
  const lastName = lastParts.join(' ')

  return {
    FIRST_NAME:        firstName || contact.company_name || '',
    LAST_NAME:         lastName || '',
    COMPANY_NAME:      contact.company_name || '',
    PHONE:             contact.phone || '',
    LEAD_SOURCE:       contact.source || '',
    LEAD_STATUS:       contact.status || '',
    CONTACT_TYPE:      contact.type || 'lead',
    ASSIGNED_TO:       contact.assigned_to_name || '',
    ASSIGNED_TO_EMAIL: contact.assigned_to_email || '',
    LEAD_SCORE:        contact.score ?? 0,
    CUSTOMER_HEALTH:   contact.health_score ?? 0,
    SIGNUP_DATE:       contact.created_at?.slice(0, 10) || '',
    TAGS:              (contact.tags || []).join(', '),
  }
}

// ── Template operations ───────────────────────────────────────────────────

export async function listBrevoTemplates(limit = 50): Promise<BrevoTemplateSummary[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100)

  const result = await brevoFetch<{
    templates?: Array<{
      id: number
      name: string
      subject?: string | null
      isActive?: boolean
      modifiedAt?: string
      createdAt?: string
    }>
  }>(`/smtp/templates?limit=${safeLimit}&offset=0&sort=desc`)

  const templates = result.templates || []
  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    subject: template.subject ?? null,
    isActive: typeof template.isActive === 'boolean' ? template.isActive : null,
    modifiedAt: template.modifiedAt ?? null,
    createdAt: template.createdAt ?? null,
  }))
}

async function createBrevoSmtpTemplate(input: BrevoSmtpTemplateUpsertInput): Promise<number> {
  const result = await brevoFetch<{ id: number }>('/smtp/templates', 'POST', {
    templateName: input.name,
    subject: input.subject,
    htmlContent: input.htmlContent,
    sender: {
      name: input.senderName,
      email: input.senderEmail,
    },
    replyTo: input.replyToEmail
      ? {
          email: input.replyToEmail,
          name: input.senderName,
        }
      : undefined,
    isActive: true,
  })

  return result.id
}

async function updateBrevoSmtpTemplate(
  templateId: number,
  input: BrevoSmtpTemplateUpsertInput,
): Promise<void> {
  await brevoFetch(`/smtp/templates/${templateId}`, 'PUT', {
    templateName: input.name,
    subject: input.subject,
    htmlContent: input.htmlContent,
    sender: {
      name: input.senderName,
      email: input.senderEmail,
    },
    replyTo: input.replyToEmail
      ? {
          email: input.replyToEmail,
          name: input.senderName,
        }
      : undefined,
    isActive: true,
  })
}

// ── Transactional email send ──────────────────────────────────────────────

export interface BrevoTransactionalSendInput {
  templateId: number
  toEmail: string
  toName?: string | null
  params?: Record<string, string | number | null>
  tags?: string[]
}

export interface BrevoTransactionalSendResult {
  messageId: string
}

/**
 * Send a transactional email via a pre-provisioned Brevo SMTP template.
 * Used by the campaign execution engine to dispatch drip steps.
 */
export async function sendBrevoTransactionalEmail(
  input: BrevoTransactionalSendInput,
): Promise<BrevoTransactionalSendResult> {
  const result = await brevoFetch<{ messageId: string }>('/smtp/email', 'POST', {
    templateId: input.templateId,
    to: [
      {
        email: input.toEmail,
        name: input.toName || input.toEmail,
      },
    ],
    params: input.params || {},
    tags: input.tags || [],
  })

  return { messageId: result.messageId }
}

export async function upsertBrevoSmtpTemplate(
  input: BrevoSmtpTemplateUpsertInput,
): Promise<BrevoSmtpTemplateUpsertResult> {
  let templateId = input.existingTemplateId ?? null

  if (!templateId) {
    const templates = await listBrevoTemplates(100)
    const existing = templates.find((template) => template.name === input.name)
    if (existing?.id) {
      templateId = existing.id
    }
  }

  if (templateId) {
    try {
      await updateBrevoSmtpTemplate(templateId, input)
      return {
        templateId,
        created: false,
      }
    } catch (error) {
      const missingTemplate = error instanceof BrevoApiError && error.status === 404
      if (!missingTemplate) {
        throw error
      }
    }
  }

  return {
    templateId: await createBrevoSmtpTemplate(input),
    created: true,
  }
}
