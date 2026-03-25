/**
 * Brevo (formerly Sendinblue) API client for xm-email
 * Docs: https://developers.brevo.com/reference
 */

const BREVO_API_KEY = process.env.BREVO_API_KEY || ''
const BASE_URL = 'https://api.brevo.com/v3'

// ── Brevo list IDs — update these after creating lists in Brevo dashboard ──
export const BREVO_LISTS = {
  ACTIVE_CUSTOMERS:    1,   // shipped < 30 days
  LAPSED_CUSTOMERS:    2,   // shipped > 30d, health < 40
  WARM_LEADS:          3,   // signed up, never shipped
  COLD_CSV:            4,   // CSV import, no prior relationship
  ALL_CONTACTS:        5,   // master list
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
  event: 'delivered' | 'opened' | 'clicked' | 'softBounce' | 'hardBounce' | 'unsubscribed' | 'spam'
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

// ── HTTP helper ───────────────────────────────────────────────────────────

async function brevoFetch<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<T> {
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
    throw new Error(`Brevo API error [${res.status}] ${path}: ${text}`)
  }

  // 204 No Content
  if (res.status === 204) return {} as T
  return res.json() as Promise<T>
}

// ── Contact operations ────────────────────────────────────────────────────

/**
 * Create or update a single contact in Brevo.
 * Returns the Brevo contact ID.
 */
export async function upsertBrevoContact(contact: BrevoContact): Promise<number | null> {
  try {
    const result = await brevoFetch<{ id?: number }>('/contacts', 'POST', {
      ...contact,
      updateEnabled: true,
    })
    return result.id ?? null
  } catch {
    return null
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

/**
 * Register a webhook endpoint in Brevo.
 * Call this once during initial setup.
 */
export async function registerBrevoWebhook(webhookUrl: string): Promise<{ id: number } | null> {
  try {
    return await brevoFetch<{ id: number }>('/webhooks', 'POST', {
      url: webhookUrl,
      description: 'xm-email engagement tracking',
      events: ['delivered', 'opened', 'clicked', 'softBounce', 'hardBounce', 'unsubscribed', 'spam'],
      type: 'marketing',
    })
  } catch {
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
