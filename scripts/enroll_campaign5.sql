-- ─────────────────────────────────────────────────────────────────────────────
-- Campaign 5 enrollment — full rollout on Brevo Starter 20k/month
--
-- QUOTA MATH (20,000 emails/month, MAX_SENDS_PER_DAY=600):
--   20,256 active contacts × 6 steps = 121,536 total emails
--   Step 1 reaches everyone in: ~34 days
--   Full 6-step sequence completes in: ~6 months
--   First ROI data (replies, clicks): within 5–6 weeks
--
-- ⚠️  BOUNCE RATE WATCH: ShipGlobal data (11k contacts) is mass export quality.
--   Check your Brevo dashboard after week 1. If bounce rate > 3%, run the
--   "pause ShipGlobal contacts" query at the bottom of this file immediately.
--   A hard bounce rate above 5% will get your Brevo account flagged.
--
-- Run AFTER:
--   1. Running scripts/seed_campaign5.sql in Supabase SQL editor
--   2. Deploying Campaign 5 from the dashboard (provisions 6 Brevo SMTP templates)
--   3. Noting the campaign UUID from the dashboard URL or Supabase
--   4. Setting MAX_SENDS_PER_DAY=600 in Vercel env vars
--   5. Redeploying xm-email to Vercel
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_campaign_id UUID := '231bc865-5e4e-45df-b1ab-7c8dc8e8e7fc'; -- Campaign 5 – Cold-to-Warm Outreach
  v_now TIMESTAMPTZ := NOW();
  v_enrolled INT;
BEGIN
  -- Sanity check: campaign must exist and be active (deployed)
  IF NOT EXISTS (
    SELECT 1 FROM drip_campaigns
    WHERE id = v_campaign_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Campaign % not found or not deployed (status must be active)', v_campaign_id;
  END IF;

  -- Enroll ALL deliverable contacts not already in this campaign.
  -- Ordered by import_batch quality (hand-curated first, mass imports last)
  -- so the best leads get step 1 earliest.
  INSERT INTO drip_enrollments (campaign_id, contact_id, current_step, status, enrolled_at)
  SELECT
    v_campaign_id,
    c.id,
    1,
    'active',
    -- Stagger enrolled_at slightly by batch priority so the scheduler
    -- naturally processes curated leads before mass imports.
    v_now + (
      CASE c.import_batch
        WHEN 'Sales_Leads_Outbound_SG_18_Nov.xlsx'       THEN INTERVAL '0 minutes'
        WHEN 'Sales Call Sheet/Aug Call Sheet.xlsx'       THEN INTERVAL '1 minutes'
        WHEN 'Aashish_XM.xlsx'                            THEN INTERVAL '2 minutes'
        WHEN 'Nikhil_Xind.xlsx'                           THEN INTERVAL '3 minutes'
        WHEN 'Chennai Leads.xlsx'                         THEN INTERVAL '4 minutes'
        WHEN 'Chennai Leads_v1.xlsx'                      THEN INTERVAL '4 minutes'
        WHEN 'ICL/customer_data.csv'                      THEN INTERVAL '5 minutes'
        WHEN 'bigship.xlsx'                               THEN INTERVAL '6 minutes'
        WHEN 'skart.csv.xls'                              THEN INTERVAL '7 minutes'
        WHEN 'quickship2.csv.xls'                         THEN INTERVAL '8 minutes'
        WHEN 'shipglobal/customer (1).csv'                THEN INTERVAL '9 minutes'
        WHEN 'shipglobal/v(1) (1).csv'                   THEN INTERVAL '10 minutes'
        ELSE                                               INTERVAL '11 minutes'
      END
    )
  FROM contacts c
  WHERE
    c.email_opted_out = false
    AND c.email_status = 'active'
    AND c.email IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM drip_enrollments de
      WHERE de.campaign_id = v_campaign_id AND de.contact_id = c.id
    );

  GET DIAGNOSTICS v_enrolled = ROW_COUNT;
  RAISE NOTICE 'Enrolled % contacts into Campaign 5 (UUID: %)', v_enrolled, v_campaign_id;
  RAISE NOTICE 'At 600 sends/day: step 1 reaches everyone in ~% days', CEIL(v_enrolled::numeric / 600);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify enrollment:
-- SELECT count(*) FROM drip_enrollments WHERE campaign_id = 'REPLACE_WITH_CAMPAIGN_5_UUID';
--
-- Check by batch (confirm ordering worked):
-- SELECT c.import_batch, count(*), min(de.enrolled_at) as first_enrolled
-- FROM drip_enrollments de JOIN contacts c ON c.id = de.contact_id
-- WHERE de.campaign_id = 'REPLACE_WITH_CAMPAIGN_5_UUID'
-- GROUP BY c.import_batch ORDER BY first_enrolled;
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️  EMERGENCY: If bounce rate > 3% after week 1, pause ShipGlobal contacts.
-- Run this to exit all ShipGlobal enrollments immediately:
-- ─────────────────────────────────────────────────────────────────────────────

-- UPDATE drip_enrollments de
-- SET status = 'exited_by_rule', exit_reason = 'bounce_rate_safeguard'
-- FROM contacts c
-- WHERE de.contact_id = c.id
--   AND de.campaign_id = 'REPLACE_WITH_CAMPAIGN_5_UUID'
--   AND de.status = 'active'
--   AND c.import_batch IN (
--     'shipglobal/v(1) (1).csv',
--     'shipglobal/customer (1).csv'
--   );
