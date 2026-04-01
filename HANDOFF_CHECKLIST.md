# XM Email Handoff Checklist

Date: 2026-03-29

## A) Fast Start For Incoming Engineer

1. Pull latest main branch and install dependencies.
2. Copy env values from team secret manager.
3. Confirm deploy-related env values are present:
   - BREVO_API_KEY
   - BREVO_SENDER_EMAIL
   - BREVO_SENDER_NAME (recommended)
   - BREVO_REPLY_TO_EMAIL (recommended)
4. Run local quality gates:
   - npm run lint
   - npm run test
5. Verify campaign deploy endpoint behavior in non-production first.

## B) Deploy Endpoint Acceptance Checks

For a valid draft campaign:
- Preflight passes.
- Deploy call succeeds.
- Campaign status becomes active.
- brevo_automation_id is set to template-pack:<campaign_id>.
- performance_data.brevo_deployment is present and includes stepTemplates.

For an invalid draft campaign:
- Deploy call fails with deploy-ready/preflight response.

For missing env:
- Missing BREVO_API_KEY returns config error.
- Missing BREVO_SENDER_EMAIL returns config error.

## C) Production Verification Checklist

After every production deployment:
1. Run npm run release:prod
2. Confirm smoke endpoints:
   - GET /api/webhooks/brevo/register -> 405
   - POST /api/webhooks/brevo/register -> 401
   - GET /api/campaigns -> 401
   - GET /api/integrations/brevo/observability -> 401
   - POST /api/campaigns/ai-builder -> 401
3. Validate one deploy flow end-to-end against a test campaign.

## D) Known Non-Blocking Items

Current lint warnings (pre-existing):
- src/app/admin/campaigns/import/page.tsx: useEffect dependency warning.
- src/app/layout.tsx: next custom font warning.

## E) Next Implementation Priorities

1. ~~Audit sink migration~~ **DONE (2026-03-30)**
   - Campaign actions now log to `admin_audit_log`. Fallback to `campaign_ai_sessions` preserved.
   - Verified: lint passes, no errors. Awaiting first production action to confirm live rows.

2. ~~AI builder export parity~~ **DONE (2026-03-30)**
   - AI builder now has Export .md, Export PDF, Export JSON, and Save as Draft.
   - PDF uses `window.print()` — no new deps. Markdown is a full structured spec file.
   - Verified: lint passes, no errors.

3. ~~Brevo deploy depth~~ **DONE (2026-03-30)**
   - `campaign-scheduler.ts` dispatches due steps via Brevo transactional API.
   - Vercel cron runs `/api/campaigns/execute` every hour.
   - Anti-double-send via `activities` table dedup check.
   - New env var: `CRON_SECRET` (required for Vercel cron auth).
   - Verified: lint passes, no errors.

4. ~~Safety guards + Campaign 5~~ **DONE (2026-03-30)**
   - Empty email guard: preflight now errors (not warns) on empty `content_outline`. Scheduler skips steps with no content.
   - Daily send cap: `MAX_SENDS_PER_DAY` env var (default 290). Raise after Brevo plan upgrade.
   - Campaign 5 — Cold-to-Warm: 6-email sequence for 20k+ cold contacts. Scripts in `scripts/`.
   - Verified: lint passes, no errors.

5. ~~Campaign 5 live launch~~ **DONE (2026-03-31)**
   - 18,981 contacts enrolled. 6 Brevo templates provisioned (IDs 20–25). Campaign status = active.
   - `MAX_SENDS_PER_DAY=290` set in Vercel (free tier). Pacing: step 1 in ~66 days.
   - All contacts tagged `custom_fields->>'segment' = 'new_cold'` for segment targeting.
   - ⚠️ `templateName` bug fix in `brevo.ts` is local-only — must commit + redeploy.

6. ~~Vendor lifecycle campaigns 2, 3, 4~~ **DONE (2026-03-31)**
   - **C2 — KYC Dropout** (UUID `b2c3d4e5-f6a7-8901-bcde-f12345678901`): 35 contacts inserted + enrolled. Brevo templates 30/32/34.
   - **C3 — First Shipment Activation** (UUID `a1b2c3d4-e5f6-7890-abcd-ef1234567890`): 163 contacts inserted + enrolled after multi-layer franchise filtering. Brevo templates 26/27/28/29.
   - **C4 — Re-engagement** (UUID `c3d4e5f6-a7b8-9012-cdef-123456789012`): 29 contacts inserted + enrolled. Brevo templates 31/33/35.
   - C5 transitions: vendors 547/951 moved to C4; vendors 516/556/571/696/840 tagged as C3 candidates.
   - Day-0 burst: 227 emails across C2/C3/C4 combined — within 290/day cap.
   - All Brevo templates provisioned directly via Brevo API (deploy endpoint still has `templateName` bug).

**Immediate pending actions (next engineer):**
- Commit `src/lib/brevo.ts` + Phase 3 files to GitHub and redeploy to Vercel
- Monitor bounce rate in Brevo dashboard daily (week 1) — pause ShipGlobal if > 3%
- Upgrade Brevo to Starter when budget allows → set `MAX_SENDS_PER_DAY=600`
- Refresh C3 audience quarterly: re-run Metabase query and enroll net-new KYC-verified vendors

## F) Updated Rollback Guidance

If the scheduler causes unintended sends:
1. Remove or disable the cron entry in `vercel.json` and redeploy.
2. The manual trigger (`POST /api/campaigns/execute`) still works for controlled testing.
3. Pause affected campaigns via the dashboard to stop new enrollments being processed.
4. Do NOT roll back `brevo.ts` or `campaign-scheduler.ts` without also pausing campaigns.

## F) Rollback Guidance

If deploy provisioning breaks in production:
1. Pause campaign deploy operations.
2. Revert only deploy-route and Brevo template helper changes.
3. Redeploy and rerun smoke checks.
4. Keep route protection and webhook validation changes intact.
