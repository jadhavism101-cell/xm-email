-- ─────────────────────────────────────────────────────────────────────────────
-- Campaign 5 — Cold-to-Warm: 6-email sequence for cold CSV import contacts
-- Run this in the Supabase SQL editor once.
-- After inserting, deploy the campaign via the dashboard, then run enroll_campaign5.sql.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO drip_campaigns (
  title,
  goal,
  campaign_type,
  target_segment,
  exit_conditions,
  sequence,
  status
)
VALUES (
  'Campaign 5 – Cold-to-Warm Outreach',

  'Convert cold CSV contacts (D2C sellers on competitor platforms) into warm XtraMiles leads by educating them on shipping cost savings, building credibility, and earning a conversation.',

  'csv_import',

  '{"segment": "new_cold", "description": "Cold contacts from ShipGlobal, Bigship, SKART, and other competitor CSV imports — D2C brands not yet using XtraMiles"}',

  '{
    "on_click": "advance_to_next_step",
    "on_reply": "exit_and_notify_sales",
    "on_unsubscribe": "exit_immediately",
    "on_hard_bounce": "exit_immediately",
    "on_soft_bounce_3x": "exit_and_flag"
  }',

  '{
    "steps": [
      {
        "step": 1,
        "timing_days": 0,
        "subject": "Cutting your international shipping costs by 30–40%",
        "preview_text": "Most D2C brands leave lakhs on the table every month — here is why",
        "content_outline": [
          "Open with a direct question: are you happy with what you are paying per international shipment right now?",
          "Brief intro: XtraMiles is a Pune-based export logistics partner that helps Indian D2C brands cut international shipping costs by 30–40% without changing their workflow.",
          "The problem we keep seeing: most growing D2C brands are on platforms like ShipGlobal, Bigship, or SKART, paying retail rates while their margins shrink as volume grows.",
          "What we do differently: aggregated volumes + direct airline and courier relationships = better rates passed to you, not kept by us.",
          "No lock-in. No upfront fees. Just better rates from day one.",
          "CTA: see a quick estimate of what you could save on your current shipping spend."
        ],
        "cta": "See your savings estimate",
        "cta_url": "https://xtramiles.in/savings-calculator",
        "personalization_vars": ["contact_name", "company_name"]
      },
      {
        "step": 2,
        "timing_days": 3,
        "subject": "The hidden fees eating your shipping margins",
        "preview_text": "Fuel surcharges, DDP gaps, first-mile — where 15–20% of your spend disappears",
        "content_outline": [
          "Acknowledge they are probably already using a shipping aggregator — most are.",
          "But here is what most platforms do not show you upfront: fuel surcharges (4–8%), peak season surcharges, remote area fees, and DDP shortfalls that hit your customers on delivery.",
          "Break down a typical ₹500 quoted shipment vs what it actually costs end-to-end — the gap is usually ₹80–150 per parcel.",
          "At 500 shipments/month that is ₹40,000–75,000 in untracked cost leakage.",
          "XtraMiles quotes are all-in: no surprise surcharges at billing. What you see is what you pay.",
          "CTA: download the hidden cost checklist — 8 questions to ask your current courier before your next rate negotiation."
        ],
        "cta": "Get the hidden cost checklist",
        "cta_url": "https://xtramiles.in/shipping-cost-guide",
        "personalization_vars": ["contact_name"]
      },
      {
        "step": 3,
        "timing_days": 7,
        "subject": "How a D2C brand saved ₹2,40,000 in 90 days",
        "preview_text": "Real numbers from a brand shipping 600 parcels/month to the US and UK",
        "content_outline": [
          "Story: a Mumbai-based skincare brand was spending ₹820/parcel to the US on their existing platform. They came to XtraMiles expecting marginal improvement.",
          "What actually happened: aggregated volume + zone optimisation + airline consolidation brought their effective rate down to ₹590/parcel for US and ₹540 for UK.",
          "At 600 shipments/month: ₹1,38,000 saved in month one. ₹2,40,000 across the first 90 days.",
          "They reinvested the savings into paid performance marketing and grew international revenue 34% in the same quarter.",
          "We are not the cheapest option for every lane — but for India→US, UK, UAE, and EU we are consistently 20–35% below retail rates.",
          "CTA: see if your routes are ones we can beat."
        ],
        "cta": "Check if we can beat your current rates",
        "cta_url": "https://xtramiles.in/rate-comparison",
        "personalization_vars": ["contact_name", "company_name"]
      },
      {
        "step": 4,
        "timing_days": 14,
        "subject": "Free 10-minute shipping rate audit",
        "preview_text": "We will tell you exactly where you are overpaying — no strings attached",
        "content_outline": [
          "Direct offer: send us your last 3 months of shipping invoices (or just your top 5 lanes and monthly volume) and we will run a full rate comparison in 24 hours.",
          "What the audit covers: per-lane rate vs XtraMiles equivalent, fuel/surcharge gap analysis, DDP vs DDU impact on your return rate, and zone optimisation opportunities.",
          "What you get: a one-page report showing your current effective cost per parcel vs what XtraMiles would charge — with no obligation to switch.",
          "Why we do this for free: because the numbers speak for themselves. If we cannot beat your current rates, we will say so.",
          "We have done this for 40+ D2C brands in the last 12 months. Average savings identified: ₹1.2L/month.",
          "CTA: book the free audit — takes 10 minutes of your time, we do the rest."
        ],
        "cta": "Book my free rate audit",
        "cta_url": "https://xtramiles.in/free-audit",
        "personalization_vars": ["contact_name", "company_name"]
      },
      {
        "step": 5,
        "timing_days": 21,
        "subject": "The shipping metric most D2C brands ignore (until it hurts)",
        "preview_text": "Your effective DDP rate is probably 18–22% above your quoted price",
        "content_outline": [
          "Educational email — no hard sell.",
          "The metric: Effective Landed Cost per Parcel. Most brands track quoted rate. Very few track the all-in cost that includes duties paid on their behalf, first-mile, returns handling, and re-delivery.",
          "Why it matters: when you scale from 200 to 2,000 shipments/month, a ₹120 effective cost gap compounds to ₹2,40,000/month in margin loss.",
          "Three things to add to your shipping dashboard today: (1) effective DDP rate by destination country, (2) return rate by courier vs lane, (3) billing-vs-quoted discrepancy rate.",
          "Most aggregators will not show you these numbers proactively — but you can calculate them from your invoices.",
          "XtraMiles dashboard gives you all three in real time, per shipment, with monthly trend charts.",
          "CTA: see a demo of the cost visibility dashboard."
        ],
        "cta": "See the cost visibility dashboard",
        "cta_url": "https://xtramiles.in/dashboard-demo",
        "personalization_vars": ["contact_name"]
      },
      {
        "step": 6,
        "timing_days": 30,
        "subject": "Should I stop reaching out?",
        "preview_text": "Totally fine if the timing is off — just let me know",
        "content_outline": [
          "Keep it short and human. No marketing language.",
          "Something like: I have sent a few notes over the past month about how XtraMiles could reduce your international shipping costs. I do not want to keep landing in your inbox if it is not relevant right now.",
          "If international shipping is not a priority this quarter, just reply with not now and I will check back in 6 months.",
          "If you are curious but have not had time to dig in, reply with a good time and I will send one question — the one that tells us immediately if we can help.",
          "If you are already locked in with another partner, reply with locked in and I will stop. No hard feelings.",
          "Either way — thanks for your time. XtraMiles is here when the timing is right.",
          "CTA: reply to this email — any response works."
        ],
        "cta": "Reply to this email",
        "cta_url": "mailto:team@xtramiles.com?subject=XtraMiles%20inquiry",
        "personalization_vars": ["contact_name"]
      }
    ],
    "branches": [
      {
        "trigger": "email_clicked",
        "action": "flag_contact_as_qualified_and_notify_sales"
      },
      {
        "trigger": "email_opened_3x",
        "action": "increase_lead_score_and_accelerate_to_step_4"
      }
    ]
  }',

  'draft'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- After running: note the new campaign UUID printed by Supabase, then:
-- 1. Open the dashboard → Campaigns
-- 2. Find "Campaign 5 – Cold-to-Warm Outreach" (status: draft)
-- 3. Deploy it via the deploy button (this provisions 6 Brevo SMTP templates)
-- 4. Run enroll_campaign5.sql with the campaign UUID to mass-enroll contacts
-- ─────────────────────────────────────────────────────────────────────────────
