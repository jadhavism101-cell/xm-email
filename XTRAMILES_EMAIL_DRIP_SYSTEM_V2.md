# XTRAMILES EMAIL DRIP SYSTEM — SETUP, CAMPAIGNS & AI AGENT PLAYBOOK

## OVERVIEW

This document is an operational guide for setting up an AI-assisted email drip system for Xtramiles — an AI-powered cross-border air freight platform serving Indian MSMEs, D2C brands, and marketplace sellers shipping to 220+ countries.

The system uses **Brevo (formerly Sendinblue)** as the email automation engine, fully integrated into the existing Xtramiles platform ecosystem:

- **xm-dash** — the admin dashboard (Next.js App Router + Tailwind + Supabase + Vercel)
- **xm-crm** — the internal CRM module (lead management, deal pipeline, communication hub, scoring)
- **xm-drip** — this module (email automation, campaign management, AI campaign builder)

All three share the same Supabase database, auth system, role model, UI component library, and admin panel layout. The drip system is NOT a standalone tool — it is a new section within the existing admin panel at `/admin/campaigns/*`, using the same sidebar navigation, breadcrumbs, audit logging, and role-based access already built for xm-dash and xm-crm.

**Architecture:** CRM (Supabase) = system of record → Brevo = email sending & automation engine → AI Agent = campaign builder & optimizer.

**Scope:** Email drip only (for now). WhatsApp drip will be layered on later using Brevo's WhatsApp channel or the existing WhatsApp Business API integration in xm-crm.

---

## PLATFORM INTEGRATION — SHARED INFRASTRUCTURE

### What xm-drip inherits from xm-dash / xm-crm

The drip module does NOT build its own:

- **Auth** — uses existing Supabase Auth. Same login, same session, same middleware.
- **Role model** — uses the existing 5-role matrix (super_admin, admin, ops_manager, sales_manager, finance). Campaign management access: `super_admin`, `admin`, `sales_manager`.
- **UI shell** — sits inside the existing admin panel layout. Collapsible sidebar gets a new "Campaigns" section. Same breadcrumbs, same top bar, same notification bell.
- **Component library** — uses whatever is already set up (shadcn/ui, custom components). No new design system.
- **Audit logging** — all campaign actions (create, edit, activate, pause, delete) log to the existing `admin_audit_log` table with the same `(actor_id, action, entity_type, entity_id, before_state, after_state)` pattern.
- **Contact data model** — the `contacts` table from xm-crm IS the source of truth. No duplicate contact tables. The drip system reads from `contacts` and writes engagement data back as activities.
- **Activity logging** — email events (sent, opened, clicked, bounced, unsubscribed) log to the existing CRM `activities` table with `type: 'email_event'` and `subtype: 'opened' / 'clicked' / etc.` — so email engagement appears in the unified contact timeline alongside WhatsApp messages, calls, and notes.
- **Customer health scoring** — email engagement data feeds back into the existing customer health score (communication recency component) and lead score (engagement recency component).

### New tables for xm-drip

These are the ONLY new tables. Everything else reuses existing xm-crm/xm-dash tables.

```sql
-- Campaign definitions (AI-generated or manual)
drip_campaigns
├── id (uuid, PK)
├── title (text)
├── goal (text)
├── campaign_type (enum: 'lead_nurture', 'onboarding', 're_engagement', 'upsell', 'csv_import', 'custom')
├── target_segment (jsonb — enrollment rules as structured conditions)
├── exit_conditions (jsonb)
├── sequence (jsonb — array of email steps with timing, subject, content, branches)
├── brevo_automation_id (text, nullable — linked Brevo automation once deployed)
├── status (enum: 'draft', 'reviewed', 'active', 'paused', 'archived')
├── created_by (uuid, FK → users.id)
├── approved_by (uuid, FK → users.id, nullable)
├── performance_data (jsonb — aggregated stats synced from Brevo)
├── created_at (timestamptz)
├── updated_at (timestamptz)

-- Tracks which contacts are in which campaigns
drip_enrollments
├── id (uuid, PK)
├── campaign_id (uuid, FK → drip_campaigns.id)
├── contact_id (uuid, FK → contacts.id)
├── current_step (integer — which email in the sequence they're on)
├── status (enum: 'active', 'completed', 'exited_by_rule', 'unsubscribed', 'manually_removed')
├── exit_reason (text, nullable)
├── enrolled_at (timestamptz)
├── completed_at (timestamptz, nullable)
├── last_email_sent_at (timestamptz, nullable)

-- AI agent conversation history for campaign building
campaign_ai_sessions
├── id (uuid, PK)
├── campaign_id (uuid, FK → drip_campaigns.id, nullable — linked once saved)
├── messages (jsonb[] — conversation history with the AI agent)
├── created_by (uuid, FK → users.id)
├── created_at (timestamptz)
├── updated_at (timestamptz)
```

### Admin panel navigation addition

```
/admin
├── ... (existing sections) ...
│
├── Campaigns (NEW — xm-drip)
│   ├── Overview Dashboard
│   ├── Active Campaigns
│   ├── AI Campaign Builder
│   ├── Email Templates (synced with Brevo)
│   ├── Contact Segments
│   ├── Import & Segment (CSV upload + auto-routing)
│   └── Settings (Brevo config, frequency caps, sender profiles)
```

### API route pattern

Follow the existing xm-dash API pattern. If the project uses Next.js API routes:

```
/api/campaigns/            — CRUD for drip_campaigns
/api/campaigns/[id]/deploy — push to Brevo
/api/campaigns/[id]/pause  — pause in Brevo
/api/campaigns/ai-builder  — Claude API proxy for campaign generation
/api/webhooks/brevo        — Brevo engagement webhook receiver
/api/contacts/sync-brevo   — manual trigger for contact sync
/api/contacts/import-csv   — CSV upload + segmentation + routing
```

All routes protected by existing auth middleware + role check. All writes logged to `admin_audit_log`.

---

## PART 1: TOOL SETUP — BREVO

### 1.1 Why Brevo

- Free tier: 300 emails/day (enough for early-stage drip testing)
- Visual automation builder for non-technical users
- Transactional + marketing email in one platform (consolidates shipping notifications + drip campaigns)
- Strong API for CRM sync (REST + webhooks)
- WhatsApp campaigns built in (future-proofs the multi-channel plan)
- GDPR and Indian IT Act compliant; local deliverability infrastructure
- Contact segmentation with unlimited lists and dynamic segments

### 1.2 Account Setup Checklist

1. **Create Brevo account** at https://www.brevo.com — use the Xtramiles business email as the account owner
2. **Verify sending domain** — add DNS records (DKIM, SPF, DMARC) for your sending domain (e.g., `mail.xtramiles.com` or `notifications.xtramiles.com`)
   - SPF: `v=spf1 include:sendinblue.com ~all`
   - DKIM: Brevo provides a unique key per account
   - DMARC: `v=DMARC1; p=quarantine; rua=mailto:dmarc@xtramiles.com`
3. **Set up a dedicated sending subdomain** — do NOT send drip campaigns from your primary domain. Use `mail.xtramiles.com` or `campaigns.xtramiles.com` to protect your main domain's reputation
4. **Configure sender profiles:**
   - Sales drips: `saurabh@xtramiles.com` (or the assigned salesperson's name — personalized sender)
   - Onboarding drips: `team@xtramiles.com`
   - Re-engagement: `saurabh@xtramiles.com` (founder touch feels personal)
5. **Enable transactional email** — if not already using Brevo for transactional (shipping updates, invoices), enable this module. Keeps everything in one platform.
6. **API key generation** — create a v3 API key with the following permissions:
   - Contacts: read/write
   - Email campaigns: read/write
   - Automation: read/write
   - Webhooks: read/write
   Store as `BREVO_API_KEY` in your environment variables (same `.env` as xm-dash). Never expose client-side.

### 1.3 Contact Sync Architecture (CRM ↔ Brevo)

**Direction: CRM → Brevo (one-way push, CRM is master)**

The xm-crm `contacts` table is the system of record. Contacts are pushed to Brevo for email automation. Brevo never writes back to the CRM directly — engagement data (opens, clicks, bounces) flows back via webhooks and is logged as CRM activities.

**Sync implementation:** Supabase database webhook (via `pg_notify` or Supabase Realtime listener) triggers a Next.js API route or Supabase Edge Function on contact changes. Same pattern as existing xm-crm webhooks if any are already set up — check the codebase first.

**Sync triggers:**

| CRM Event | Brevo Action |
|---|---|
| New lead created in xm-crm | Create contact in Brevo, add to list based on segment |
| Lead status changes (e.g., qualified → customer) | Move contact to appropriate Brevo list, trigger onboarding automation |
| Lead assigned to salesperson | Update `owner` attribute in Brevo (used for personalized sender) |
| Contact info updated in xm-crm | Update Brevo contact attributes |
| Customer health score drops below 40 | Add to re-engagement list, trigger Campaign 3 |
| CSV bulk import via admin panel | Batch create contacts via Brevo API, add to specified list |
| Contact unsubscribes (Brevo webhook) | Update xm-crm `contacts.email_opted_out = true`, log activity |
| Email bounces (Brevo webhook) | Update xm-crm `contacts.email_status = bounced`, log activity |

**Brevo contact attributes to sync (mapped from xm-crm contacts table):**

```
email              — primary identifier (from contacts.email)
first_name         — from contacts.contact_person (split)
last_name          — from contacts.contact_person (split)
company_name       — from contacts.company_name
phone              — from contacts.phone (for future WhatsApp)
lead_source        — from contacts.source
lead_status        — from contacts.status
contact_type       — from contacts.type (lead/customer)
assigned_to        — from users.name via contacts.assigned_to FK
assigned_to_email  — from users.email via contacts.assigned_to FK
shipment_corridors — from contacts.tags or custom field
monthly_volume_kg  — from contacts custom field or deal data
last_shipment_date — from shipments table (latest by contact_id)
lead_score         — from contacts.score
customer_health    — from contacts.health_score
signup_date        — from contacts.created_at
tags               — from contacts.tags
```

### 1.4 Webhook Setup (Brevo → CRM)

Register webhooks in Brevo for engagement events. These fire back to xm-crm so email activity appears in the unified contact timeline alongside WhatsApp and call logs.

**Webhook endpoint:** `POST /api/webhooks/brevo` (same Next.js API route pattern as other xm-dash webhooks)

**Events to subscribe:** `delivered`, `opened`, `clicked`, `soft_bounce`, `hard_bounce`, `unsubscribed`, `spam`

**Webhook processing logic:**
1. Verify webhook signature (Brevo sends a secret header)
2. Find contact in xm-crm `contacts` table by email
3. Log as CRM activity in the existing `activities` table:
   - `type: 'email_event'`
   - `subtype: 'opened' / 'clicked' / 'bounced' / 'unsubscribed'`
   - `contact_id: <matched contact>`
   - `metadata: { campaign_id, email_subject, link_clicked, timestamp }`
4. Update contact fields as needed (`email_status`, `last_engaged_at`)
5. If `unsubscribed` or `spam` → immediately remove from all Brevo lists, update xm-crm, update `drip_enrollments.status = 'unsubscribed'`
6. Trigger CRM scoring recalculation (email engagement affects lead score and customer health score)

---

## PART 2: EXISTING USER SEGMENTATION

Before running any drip campaign on your existing user base, you must segment them properly. Treating everyone as a "cold import" wastes your warmest contacts and annoys active customers.

### 2.1 Segmentation Logic

Run this segmentation query against the xm-crm `contacts` table (and `shipments` table if available) to classify every existing user:

```sql
-- Segment 1: Active Customers
-- Shipped in last 30 days. DO NOT drip-nurture. They know you.
SELECT * FROM contacts
WHERE type = 'customer'
  AND id IN (SELECT contact_id FROM shipments WHERE shipped_at > NOW() - INTERVAL '30 days')

-- Segment 2: Lapsed Customers
-- Shipped before, but not in last 30-60 days. They trusted you once.
SELECT * FROM contacts
WHERE type = 'customer'
  AND id IN (SELECT contact_id FROM shipments)
  AND id NOT IN (SELECT contact_id FROM shipments WHERE shipped_at > NOW() - INTERVAL '30 days')
  AND (health_score IS NULL OR health_score < 40)

-- Segment 3: Signed Up, Never Shipped
-- Created an account / entered the system but never converted. Warmest leads.
SELECT * FROM contacts
WHERE type = 'lead'
  AND status IN ('new', 'contacted', 'qualified')
  AND id NOT IN (SELECT contact_id FROM shipments)
  AND created_at < NOW() - INTERVAL '7 days'  -- give fresh leads time before dripping

-- Segment 4: Truly Cold / Legacy
-- Old CSV imports, event lists, no account, no activity.
-- These come from manual CSV upload, not from the existing contacts table.
```

### 2.2 Segment → Campaign Routing

| Segment | Campaign | Why |
|---|---|---|
| Active Customers (shipped <30d) | Campaign 4: Upsell/Cross-sell (if single-corridor) OR no drip (just regular comms) | They're already engaged. Don't re-introduce yourself. |
| Lapsed Customers (shipped, but >30d ago) | Campaign 3: Re-engagement | They know you, they trusted you. "Welcome back" tone, not "let me introduce myself." |
| Signed Up, Never Shipped | Campaign 1B: Warm Lead Activation (NEW — see below) | They showed intent. Acknowledge they have an account. "You signed up X months ago — here's what's changed." |
| Truly Cold / Legacy CSV | Campaign 5: CSV Cold-to-Warm Nurture | Full re-introduction needed. Transparent about why you're emailing. |

### 2.3 Admin UI: Import & Segment Tool

Build this at `/admin/campaigns/import` within the existing admin panel:

**Step 1: Upload** — drag-and-drop CSV with column mapping UI. Required: `email`. Recommended: `first_name`, `company_name`, `phone`, `source`.

**Step 2: Clean** — auto-detect and flag: invalid emails, duplicates (against existing `contacts` table), role-based emails (info@, admin@), disposable email domains. Show counts and let the user review/remove.

**Step 3: Match & Segment** — auto-match uploaded emails against existing xm-crm contacts:
- **Found in CRM as active customer** → show as "Already Active" (gray, excluded from import)
- **Found in CRM as lapsed customer** → show as "Lapsed — route to Re-engagement" (yellow)
- **Found in CRM as lead (never shipped)** → show as "Warm Lead — route to Activation" (blue)
- **Not found in CRM** → show as "New — route to Cold Nurture" (green, will be created in contacts table)

**Step 4: Confirm & Import** — user reviews the segments, can override routing, and clicks "Import & Enroll." This:
1. Creates new contacts in xm-crm `contacts` table (tagged with `source: 'csv_import'`, `import_batch: '<batch_name>'`)
2. Syncs all contacts to Brevo
3. Creates `drip_enrollments` records for each contact → assigned campaign
4. Logs the import action to `admin_audit_log`

**The AI agent should also assist here** — user uploads a CSV, agent analyzes data quality, suggests segmentation, and recommends routing. See Part 3.

---

## PART 3: DRIP CAMPAIGN BLUEPRINTS

### CAMPAIGN 1: NEW LEAD NURTURING (Post-Inquiry, Pre-Sales)

**Trigger:** New lead enters xm-crm (any source: website form, WhatsApp inquiry, referral)
**Goal:** Educate → build trust → get them to request a quote or book a trial shipment
**Exit conditions:** Lead requests quote, books shipment, opts out, or is marked "lost" in xm-crm
**Duration:** 14 days (7 emails)

**Enrollment rules (reads from xm-crm contacts table):**
- `contacts.type = 'lead'`
- `contacts.status IN ('new', 'contacted')`
- `contacts.email_opted_out = false`
- NOT already in `drip_enrollments` for this campaign

| # | Timing | Subject Line | Content Focus | CTA |
|---|---|---|---|---|
| 1 | Immediately | Welcome to Xtramiles — here's how we help {{company_name}} ship globally | Introduction: who we are, 220+ countries, CSB-IV/V compliance handled, 1-2 social proof stats. Brief, personal tone from assigned salesperson. | Reply with your top shipping corridor |
| 2 | Day 2 | The 3 mistakes Indian sellers make with cross-border shipping | Educational: wrong HS codes, customs delays, overpaying. Position Xtramiles as expert. | Download our free corridor guide |
| 3 | Day 4 | How {{similar_company}} saved 30% on US shipments | Case study / social proof for their likely corridor based on `contacts.tags` or inquiry data. | See our rate card for {{primary_corridor}} |
| 4 | Day 6 | Your shipping quote is ready (no, seriously) | Soft push: indicative rates for their corridor. Attach or link corridor-specific rate snapshot. | Get your custom quote |
| 5 | Day 9 | What's holding you back? (Honest question) | Objection handling: FAQ on complexity, returns, small volumes. | Book a 15-min call with {{assigned_to}} |
| 6 | Day 12 | Limited-time: Free trial shipment for new sellers | Incentive push. Only send if `contacts.status` still `new` or `contacted`. | Claim your trial shipment |
| 7 | Day 14 | Last note from me — here whenever you're ready | Graceful close. No hard sell. Keeps door open. | Reply to restart |

**Conditional branches:**
- Opens #3, no click → variant of #4 with different subject
- Clicks rate card in #4 → skip #5, jump to #6
- Replies to any email → exit drip, alert salesperson in xm-crm (creates task), mark as hot lead
- Status changes to `qualified` / `negotiation` / `won` in xm-crm → auto-exit drip (salesperson owns it)

---

### CAMPAIGN 1B: WARM LEAD ACTIVATION (Signed Up, Never Shipped) — NEW

**Trigger:** Existing xm-crm contact with `type = 'lead'`, no shipments, account age >7 days
**Goal:** Acknowledge they already signed up → show what's new → remove friction → convert to first shipment
**Exit conditions:** Books first shipment, opts out, or moves to Campaign 1 (if re-qualified as hot)
**Duration:** 18 days (6 emails)

**This is NOT the same as Campaign 1.** Campaign 1 assumes the person has never heard of you. Campaign 1B knows they signed up and speaks to that directly.

**Enrollment rules:**
- `contacts.type = 'lead'`
- `contacts.status IN ('new', 'contacted', 'qualified')`
- `contacts.created_at < NOW() - INTERVAL '7 days'`
- No shipments linked to this contact
- `contacts.email_opted_out = false`
- NOT in Campaign 1 or any other active drip

| # | Timing | Subject Line | Content Focus | CTA |
|---|---|---|---|---|
| 1 | Day 0 | {{first_name}}, you signed up {{days_since_signup}} days ago — here's what's changed | Personal, acknowledges they already have an account. Quick summary of platform improvements, new corridors, rate drops since their signup date. Shows momentum. | Log in and explore |
| 2 | Day 3 | The one thing stopping most sellers from their first shipment | Address the #1 friction point: "Is it complicated?" Walk through the booking flow in 3 steps. Screenshot or GIF of the actual UI. | Start your first booking (link to xm-dash) |
| 3 | Day 6 | Your first shipment is free (well, almost) | Trial shipment offer. Remove financial risk. "We'll handle customs, pickup, and delivery. You just pack the box." | Claim your trial shipment |
| 4 | Day 10 | {{first_name}}, quick question — what corridor are you most interested in? | Engagement/qualification email. Include clickable options (US / EU / UAE / SEA / Other). Click tracking segments them for future campaigns. | Click your corridor |
| 5 | Day 14 | Here's exactly what it costs to ship to {{clicked_corridor}} | Personalized based on their click in #4. Actual rate breakdown for their corridor. Transparent pricing builds trust. If no click on #4, use most popular corridor (US). | Get a detailed quote |
| 6 | Day 18 | Last one — your account is ready, just say when | Founder-signed close. Direct WhatsApp link + calendar link + reply option. Multiple channels to respond. | WhatsApp us / Book a call / Reply |

**Conditional branches:**
- Clicks a corridor in #4 → personalize #5 with that corridor's rates
- No click on #4 → send #5 with US corridor (highest volume)
- Replies to any email → exit drip, alert salesperson, create follow-up task in xm-crm
- Books a shipment at any point → exit drip, move to Campaign 2 (Onboarding)
- No engagement after all 6 emails → tag as `activation_failed`, park for 60 days, then try Campaign 3 (Re-engagement) once

---

### CAMPAIGN 2: ONBOARDING SEQUENCE (Post-First Shipment / Signup)

**Trigger:** `contacts.type` changes to `customer` in xm-crm OR first shipment booked (detected via shipments table)
**Goal:** Activate → educate on platform features → drive second shipment → collect feedback
**Exit conditions:** Runs to completion unless customer opts out
**Duration:** 30 days (8 emails)

| # | Timing | Subject Line | Content Focus | CTA |
|---|---|---|---|---|
| 1 | Immediately | Welcome aboard, {{first_name}} — your quick start guide | Welcome: what to expect, key contacts, tracking, support channels. | Bookmark your tracking dashboard |
| 2 | Day 2 | 3 things to set up before your first shipment arrives | Profile completion, GST, corridors, documentation. | Complete your account setup |
| 3 | Day 5 | Your shipment to {{destination_country}} — what happens next | Shipment lifecycle explainer with timing expectations. | Track your shipment |
| 4 | Day 8 | Pro tip: Cut 2 days off your {{primary_corridor}} transit time | Corridor-specific advanced tips. Shows expertise. | Explore corridor guides |
| 5 | Day 12 | How was your first shipment experience? | Feedback survey (3 questions max). Updates customer_health in xm-crm. | Take 30-second survey |
| 6 | Day 16 | Ready for shipment #2? Here's a special rate | Activation push — critical first-to-repeat conversion point. | Book your next shipment |
| 7 | Day 22 | 5 features most sellers miss | Feature discovery: bulk booking, rate alerts, API, multi-corridor. | Explore features |
| 8 | Day 30 | Your first month with Xtramiles — by the numbers | Personalized recap (pull data from shipments table via xm-crm). | Refer a fellow seller |

**Conditional branches:**
- Books second shipment before #6 → skip #6
- Negative survey → alert salesperson in xm-crm, create task
- No shipments after day 30 → move to Campaign 3

---

### CAMPAIGN 3: RE-ENGAGEMENT (Dormant Leads & Customers)

**Trigger:**
- For leads: `contacts.status IN ('contacted', 'qualified')` AND no activity in `activities` table >30 days
- For customers: no shipments >30 days AND `contacts.health_score < 40`

**Goal:** Reignite interest → understand why → reactivate
**Duration:** 21 days (5 emails)

| # | Timing | Subject Line | Content Focus | CTA |
|---|---|---|---|---|
| 1 | Day 0 | We miss shipping for you, {{first_name}} | Personal check-in, non-pushy. | Reply and let us know |
| 2 | Day 4 | What's changed since you last shipped with us | Product updates, new corridors, rate improvements. | See what's new |
| 3 | Day 8 | Is shipping to {{primary_corridor}} still on your radar? | Corridor-specific updated rate comparison. | Get updated rates |
| 4 | Day 14 | A gift to welcome you back — ₹500 off next shipment | Incentive (only if not re-engaged). | Claim ₹500 credit |
| 5 | Day 21 | Final note — your rates and account are saved | Graceful exit. | Reactivate my account |

**Conditional branches:**
- Reply → exit drip, create task in xm-crm, mark "re-engaged"
- Clicks rate link in #3 → skip #4 (don't discount prematurely), personal follow-up from salesperson
- Books a shipment → exit drip, move to Campaign 2 (Onboarding repeat path)

---

### CAMPAIGN 4: UPSELL / CROSS-SELL (Active Customers)

**Trigger:** Customer with 3+ shipments (from `shipments` table) AND only 1 corridor
**Goal:** Expand to new corridors, higher volumes, premium services
**Duration:** 28 days (5 emails)

| # | Timing | Subject Line | Content Focus | CTA |
|---|---|---|---|---|
| 1 | Day 0 | Your {{primary_corridor}} game is strong — what about {{suggested_corridor}}? | Data-driven corridor suggestion. | Explore rates |
| 2 | Day 5 | How {{similar_company}} expanded to 3 new markets | Case study with growth numbers. | Full case study |
| 3 | Day 12 | {{suggested_corridor}} rates just dropped | Rate-based trigger or market opportunity. | Compare corridors |
| 4 | Day 20 | Volume discounts unlocked — you're closer than you think | Show proximity to next volume tier. Gamify. | See tier progress |
| 5 | Day 28 | Your growth report — and what's next | Personalized shipment trends from xm-crm data. | Book strategy call |

---

### CAMPAIGN 5: CSV BULK IMPORT — COLD-TO-WARM NURTURE

**Trigger:** New contacts uploaded via CSV that don't match any existing xm-crm contacts
**Goal:** Warm up cold contacts → qualify interest → route to sales or appropriate drip
**Duration:** 21 days (6 emails)

**Compliance (critical for imported lists):**
- Every email has unsubscribe link (Brevo auto-handles)
- First email explains WHY they're receiving it
- Preference center in email #1
- Pause if bounce rate >5% on first send

| # | Timing | Subject Line | Content Focus | CTA |
|---|---|---|---|---|
| 1 | Day 0 | {{first_name}}, it's been a while — Xtramiles has changed a lot | Re-introduction, transparent about why emailing. | Update preferences |
| 2 | Day 3 | The state of cross-border shipping from India in 2026 | Pure value: industry report, no pitch. | Download report |
| 3 | Day 7 | Are you still shipping internationally? | Qualification: yes/no click to segment. | Yes / No buttons |
| 4 | Day 11 | (Yes only) Here's what Xtramiles can do for you now | Targeted pitch. | Get rate quote |
| 5 | Day 16 | What sellers like {{company_name}} are saying about us | Social proof, testimonials. | See stories |
| 6 | Day 21 | Last one — here's a direct line to our team | Personal close, multiple channels. | Reply / WhatsApp / Call |

**Post-sequence routing:**
- Clicked "Yes" in #3 → move to Campaign 1 (Lead Nurturing) after this sequence
- Clicked "No" → tag `inactive_shipper`, quarterly newsletter only
- No engagement → tag `unresponsive_import`, exclude from drip

---

## PART 4: AI AGENT — CAMPAIGN BUILDER

### 4.1 What the AI Agent Does

The AI agent is an internal tool within xm-dash (not customer-facing) that helps the team create, modify, and optimize drip campaigns.

**Core capabilities:**

1. **Campaign generation from plain language:** Describe the goal → AI generates full sequence with timing, subjects, content outlines, conditional branches, and Brevo automation config.
2. **Email draft generation:** Complete send-ready drafts per step — subject, preview text, body, CTA — using Xtramiles brand voice and contact personalization variables.
3. **Sequence optimization:** Given performance data from Brevo (stored in `drip_campaigns.performance_data`), suggests specific changes with actual alternatives.
4. **Template library management:** Generates reusable templates and stores in Brevo.
5. **CSV import assistant:** Analyzes uploaded CSV quality, suggests segmentation, recommends campaign routing.

### 4.2 AI Agent System Prompt

```
SYSTEM PROMPT FOR XTRAMILES DRIP CAMPAIGN AI AGENT

You are the email campaign strategist for Xtramiles, an AI-powered cross-border air freight platform based in India. You help the team design email drip campaigns that convert leads into customers and keep existing customers engaged.

COMPANY CONTEXT:
- Xtramiles handles cross-border air freight for Indian MSMEs, D2C brands, and marketplace sellers
- We ship to 220+ countries with CSB-IV/V customs compliance
- Our customers are Indian sellers (typically small-medium businesses) shipping products internationally
- Key corridors: US, EU (Germany, UK, France), UAE, SEA (Singapore, Malaysia), Australia
- We compete on reliability, compliance expertise, and competitive rates
- Tone: professional but warm, knowledgeable but not jargon-heavy, founder-led feel

BRAND VOICE GUIDELINES:
- Write like a knowledgeable friend, not a corporate entity
- Use "we" and "our team" — never "Xtramiles" in third person within emails
- Be specific with numbers and data when possible
- Acknowledge cross-border shipping pain points honestly
- Keep emails scannable: short paragraphs, one idea per paragraph, clear CTA
- Subject lines: conversational, curiosity-driven, or value-first. Never clickbait. Never ALL CAPS.
- Always include recipient's first name in greeting
- Emails feel like they're from a real person (assigned salesperson or founder), not marketing dept

PLATFORM CONTEXT (important — you are part of a larger system):
- The CRM (xm-crm) is the source of truth for all contact data
- Email engagement events are logged back to xm-crm activities table
- The contacts table has: type (lead/customer), status, source, assigned_to, score, health_score, tags
- The shipments table has: contact_id, corridor, shipped_at, delivered_at, value
- You can reference CRM data in your campaign designs (e.g., "if health_score < 40" or "if no shipments in 30 days")
- All campaigns must define enrollment rules as conditions against the contacts/shipments tables

AVAILABLE PERSONALIZATION VARIABLES:
{{first_name}}, {{last_name}}, {{company_name}}, {{assigned_to}} (salesperson name),
{{assigned_to_email}}, {{primary_corridor}}, {{suggested_corridor}}, {{monthly_volume_kg}},
{{last_shipment_date}}, {{lead_source}}, {{signup_date}}, {{destination_country}},
{{days_since_signup}}, {{days_since_last_shipment}}, {{shipment_count}}, {{lead_score}},
{{customer_health}}

WHEN GENERATING A CAMPAIGN, ALWAYS INCLUDE:
1. Campaign name and goal (one sentence)
2. Target segment definition (who enters — with SQL-like conditions against xm-crm tables)
3. Enrollment rules (CRM field conditions)
4. Exit conditions (what pulls someone out — include CRM-triggered exits like status changes)
5. For each email in the sequence:
   - Timing (delay from previous email or trigger)
   - Subject line (primary + one A/B variant)
   - Preview text
   - Content outline (key points)
   - CTA
   - Personalization variables used
6. Conditional branches (if/then logic based on engagement AND CRM data)
7. Success metrics (KPIs to track)
8. CRM integration points (what should update in xm-crm when events happen)

CONSTRAINTS:
- Maximum 8 emails per sequence
- Minimum 2 days between emails
- Every email has a single clear CTA
- Never more than 1 email per day per contact across ALL campaigns (Brevo frequency cap)
- For imported lists: first email must explain why they're receiving it
- Always define CRM exit conditions (status changes in xm-crm should auto-exit drips)

WHEN ASKED TO OPTIMIZE:
- Ask for current performance data
- Identify biggest drop-off point
- Suggest specific alternatives (actual subject lines, not "improve your subject line")
- Recommend A/B tests with clear hypotheses

WHEN ASKED TO WRITE FULL EMAIL COPY:
- Complete send-ready format: subject, preview text, greeting, body, CTA button text, sign-off
- Under 200 words (mobile-first)
- 1-2 personalization variables per email
- Sign off with assigned salesperson's name and title
```

### 4.3 Integration Phases

**Phase 1 (Start here):** Chat interface at `/admin/campaigns/ai-builder`. Calls Claude API with the system prompt above. AI generates campaign spec as structured output. Human reviews, then manually creates automation in Brevo.

**Phase 2:** AI generates structured JSON → "Deploy to Brevo" button → automation created in Brevo (paused) → human activates.

**Phase 3:** AI monitors `drip_campaigns.performance_data` → proactively suggests optimizations → human approves → auto-deployed.

### 4.4 Claude Code Prompt — Build the Agent Interface

```
TASK: Build an AI Campaign Builder page within the existing xm-dash admin panel.

CONTEXT: This is part of the existing Next.js + Supabase + Tailwind project. Scan the
codebase for existing patterns, component library, layout shell, and API route conventions
before building. This page lives inside the admin panel alongside the CRM and ops sections.

ROUTE: /admin/campaigns/ai-builder

WHAT TO BUILD:

1. Chat-style interface where the user describes a campaign in plain language
2. Calls Claude API via Next.js API route (/api/campaigns/ai-builder) with system prompt
3. AI response rendered as formatted campaign spec (not raw JSON)
4. User can:
   - Iterate ("make email #3 more urgent", "add a branch for non-openers")
   - Request full email copy for any step
   - Export as PDF or markdown
   - Save to drip_campaigns table (status: 'draft')
   - View estimated audience size (queries contacts table with enrollment rules)

UI:
- Left panel: chat with AI agent
- Right panel: live campaign spec preview with visual email timeline
- Each email step expandable to show content
- Conditional branches shown as visual forks
- "Save Draft" and "Export" in top bar
- "Estimate Audience" button that runs enrollment rules against contacts table
- Mobile: stack vertically

SCHEMA: Use the drip_campaigns and campaign_ai_sessions tables defined in the
XTRAMILES_EMAIL_DRIP_SYSTEM docs.

ACCESS: super_admin, admin, sales_manager only (use existing role middleware)

AUDIT: Log all saves/edits to admin_audit_log (same pattern as rest of admin panel)

DO NOT:
- Build Brevo API integration (Phase 2)
- Build email template editor (use Brevo's)
- Build campaign scheduling/sending (happens in Brevo)
- Build analytics dashboard (comes from Brevo webhooks later)
- Create a new design system — use existing components
```

---

## PART 5: OPERATIONAL PLAYBOOK

### 5.1 Deliverability Best Practices

- **Warm up sending domain:** 50/day week 1 → 100/day week 2 → 200/day week 3
- **Clean lists before import:** verification service for CSVs >500 contacts
- **Frequency cap:** max 1 drip email per contact per day across ALL campaigns
- **Send time:** 10:00 AM IST default (Brevo "best time" feature if available)
- **Sunset policy:** no opens in last 10 sends → stop, re-engage quarterly max

### 5.2 Key Metrics Targets

| Metric | Target | Action if Missed |
|---|---|---|
| Hard bounce rate | Below 2% | Pause and clean list |
| Spam complaint rate | Below 0.1% | Review content and targeting |
| Unsubscribe rate | 0.2–0.5% | Above 1% = content mismatch |
| Open rate | 20–30% | Test subject lines via AI agent |
| Click rate | 3–5% | Review CTA placement and copy |

### 5.3 CSV Import Workflow

1. **Prepare CSV:** min `email` + `first_name`. Add `import_source` column.
2. **Clean:** email verification API (~₹400-800 per 1000 emails), remove junk/role-based.
3. **Upload to admin panel:** `/admin/campaigns/import` → auto-match against existing xm-crm contacts.
4. **Review segments:** active customers (excluded), lapsed (→ Campaign 3), warm leads (→ Campaign 1B), cold (→ Campaign 5).
5. **Import & Enroll:** creates contacts in xm-crm, syncs to Brevo, enrolls in campaigns.
6. **Monitor:** pause if >5% bounces in first 2 hours.

### 5.4 Review Cadence

| Frequency | What to Review | Action |
|---|---|---|
| Daily (first week) | Bounces, spam, delivery | Pause if bad |
| Weekly | Open/click per step, unsubscribes | Ask AI agent for suggestions |
| Bi-weekly | Conversion rate per campaign | Adjust targeting/sequence |
| Monthly | Campaign ROI, cohort analysis | Archive losers, scale winners |

---

## PART 6: FUTURE — ADDING WHATSAPP DRIP

When ready (Month 3+):

**Option A: Brevo WhatsApp** — add WhatsApp as a step in existing automations ("if email not opened after 48h, send WhatsApp template"). Requires WhatsApp Business API approval.

**Option B: xm-crm native** — build WhatsApp drip as a CRM feature using the existing WhatsApp Business API integration. More control, more engineering.

**Recommended:** Option A for marketing drip, Option B for 1:1 sales conversations.

**Multi-channel drip logic (future):**
```
Email sent → Wait 48h → Opened?
  → Yes: continue email sequence
  → No: send WhatsApp (template) → Wait 24h → Read?
    → Yes: continue email
    → No: create task for salesperson in xm-crm to call
```

---

## PART 7: IMPLEMENTATION TIMELINE

| When | What | Dependencies |
|---|---|---|
| Day 1 | Create Brevo account, verify domain, DNS records | Domain access |
| Day 2 | Build CRM → Brevo contact sync (Edge Function / API route) | xm-crm contacts table |
| Day 3 | Set up Brevo → CRM webhook + activity logging | xm-crm activities table |
| Day 4 | Create Campaign 1 (Lead Nurturing) in Brevo | Brevo account ready |
| Day 5 | Create Campaign 1B (Warm Lead Activation) in Brevo | Brevo account ready |
| Day 6 | Build AI Campaign Builder page in xm-dash | Claude API key |
| Day 7 | Build Import & Segment tool at /admin/campaigns/import | xm-crm contacts table |
| Day 8 | Test Campaign 1 with small segment, monitor deliverability | Live contacts |
| Week 2 | Segment existing user base, enroll in appropriate campaigns | Segmentation queries |
| Week 2 | Create Campaigns 2, 3, 4 in Brevo | Content ready |
| Week 3 | Import old CSV user base via Import tool | CSV file, verification |
| Week 3 | Review performance, use AI agent to optimize | Performance data |
| Month 2 | Build semi-automated Brevo deployment (Phase 2) | Campaign validation |
| Month 3 | Add WhatsApp drip channel | WhatsApp Business API |

---

## APPENDIX: BREVO API QUICK REFERENCE

```
Base URL: https://api.brevo.com/v3
Auth header: api-key: BREVO_API_KEY

# Create/update contact
POST /contacts
{ "email": "...", "attributes": {...}, "listIds": [12], "updateEnabled": true }

# Batch import
POST /contacts/import
{ "fileBody": "EMAIL;FIRST_NAME\ntest@test.com;John", "listIds": [12] }

# Send transactional email
POST /smtp/email
{ "sender": {"email":"...","name":"..."}, "to": [{"email":"..."}], "subject": "...", "htmlContent": "..." }

# Get contact info
GET /contacts/{email}

# Webhooks
POST /webhooks
{ "url": "https://app.xtramiles.com/api/webhooks/brevo",
  "events": ["delivered","opened","clicked","hardBounce","unsubscribed","spam"] }
```
