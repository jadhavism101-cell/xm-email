import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _supabase: SupabaseClient | null = null
let _supabaseAdmin: SupabaseClient | null = null

function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  return url
}

// Browser/client-side client (uses anon key, respects RLS)
export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = getSupabaseUrl()
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')
    _supabase = createClient(url, anonKey)
  }
  return _supabase
}

// Server-side client (uses service role key, bypasses RLS)
export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const url = getSupabaseUrl()
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
    _supabaseAdmin = createClient(url, serviceKey)
  }
  return _supabaseAdmin
}

// Convenience proxy objects — property access triggers lazy init
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get: (_target, prop) => {
    const client = getSupabase()
    const value = (client as unknown as Record<string | symbol, unknown>)[prop]
    if (typeof value === 'function') return (value as (...args: unknown[]) => unknown).bind(client)
    return value
  },
})

export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get: (_target, prop) => {
    const client = getSupabaseAdmin()
    const value = (client as unknown as Record<string | symbol, unknown>)[prop]
    if (typeof value === 'function') return (value as (...args: unknown[]) => unknown).bind(client)
    return value
  },
})

// ── xm-drip type definitions ─────────────────────────────────────────────

export type CampaignType =
  | 'lead_nurture'
  | 'onboarding'
  | 're_engagement'
  | 'upsell'
  | 'csv_import'
  | 'custom'

export type CampaignStatus = 'draft' | 'reviewed' | 'active' | 'paused' | 'archived'

export type EnrollmentStatus =
  | 'active'
  | 'completed'
  | 'exited_by_rule'
  | 'unsubscribed'
  | 'manually_removed'

export type EmailStep = {
  step: number
  timing_days: number        // days after previous step (or trigger for step 1)
  subject: string
  subject_variant?: string   // A/B test variant
  preview_text?: string
  content_outline: string[]  // key points / body outline
  cta: string
  cta_url?: string
  personalization_vars: string[]
}

export type ConditionalBranch = {
  trigger: string            // e.g. "opens #3, no click"
  action: string             // e.g. "send variant of #4"
}

export type CampaignSequence = {
  steps: EmailStep[]
  branches: ConditionalBranch[]
}

export type DripCampaign = {
  id: string
  title: string
  goal: string
  campaign_type: CampaignType
  target_segment: Record<string, unknown>   // enrollment rules as structured conditions
  exit_conditions: Record<string, unknown>
  sequence: CampaignSequence
  brevo_automation_id: string | null
  status: CampaignStatus
  created_by: string
  approved_by: string | null
  performance_data: Record<string, unknown> | null   // aggregated stats from Brevo
  created_at: string
  updated_at: string
}

export type DripEnrollment = {
  id: string
  campaign_id: string
  contact_id: string
  current_step: number
  status: EnrollmentStatus
  exit_reason: string | null
  enrolled_at: string
  completed_at: string | null
  last_email_sent_at: string | null
}

export type AiMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export type CampaignAiSession = {
  id: string
  campaign_id: string | null
  messages: AiMessage[]
  created_by: string
  created_at: string
  updated_at: string
}

// ── admin_audit_log ───────────────────────────────────────────────────────

export type AdminAuditLog = {
  id: string
  actor_id: string | null
  actor_email: string
  action: string
  entity_type: string
  entity_id: string | null
  before_value: Record<string, unknown> | null
  after_value: Record<string, unknown> | null
  ip_address: string | null
  notes: string | null
  created_at: string
}

// ── xm-crm shared types (read-only from this module) ─────────────────────

export type ContactType = 'lead' | 'customer'

export type ContactStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'negotiation'
  | 'won'
  | 'lost'

export type Contact = {
  id: string
  company_name: string
  contact_person: string
  email: string
  phone: string | null
  type: ContactType
  status: ContactStatus
  source: string | null
  assigned_to: string | null
  score: number | null
  health_score: number | null
  tags: string[]
  email_opted_out: boolean
  email_status: 'active' | 'bounced' | 'unsubscribed' | null
  last_engaged_at: string | null
  created_at: string
  updated_at: string
}
