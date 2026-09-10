# Codex review — Day 7 release/security gate

2026-09-10. Result: **CONDITIONAL RELEASE CANDIDATE**.

The full automated gate remains **450/450**, production build and typechecks pass, all
public tables have live RLS, and every SECURITY DEFINER function has a fixed search path.
No Critical or High finding remains open. Migration history, roles, case/follow-up,
appointment ownership, audit, timeline, dashboard, SMS semantics, and known limitations
were reconciled in `docs/SYSTEM_DOCUMENTATION.md`.

Migration 0032 and the portal confirm walk-in registration is one idempotent transaction,
not three client writes. The new `seed_capstone_day7.sql` covers all seven synthetic demo
states, contains no contact/consent or credential, and passed a live-schema run ending in
ROLLBACK. It remains rollback-safe by default.

Two human checks remain: a physical Android airplane-mode/reconnect/cache-isolation smoke
test, and native-speaker review of Tagalog/Cebuano. Medium production gates are unencrypted
mobile data at rest and the health-office audit-retention decision; legacy broad Supabase
table grants are a Low defense-in-depth finding because RLS is enabled everywhere and
clients cannot issue SQL. Full evidence and the physical checklist are in
`DAY7_RELEASE_VERIFICATION.md`.

---

# Codex review — Day 6 audit/security and migration 0038

2026-09-10. Result: **APPROVED AND APPLIED**.

Migration 0038 makes the appointment trigger the single authoritative audit writer.
Codex independently confirmed that the five restated RPC bodies differ from migration
0031 only by deletion of the six appointment audit calls, and that the fail-closed
whitelist remains unchanged. The strengthened linked rollback matrix passed **36/36**
before atomic application. Live readback confirms the AFTER INSERT/UPDATE trigger, sole
writer, fixed search paths, SECURITY DEFINER trigger function, SECURITY INVOKER/STABLE
viewer, and authenticated-only viewer ACL with anon and service role denied.

Review closed three client/contract gaps before approval: BHW accounts can in fact land
on the facility portal, so the Audit navigation now checks `role === 'tb_dots'`; partial
pagination cursors fail closed instead of repeating or skipping rows; and stale responses
cannot overwrite a newer filter. The misleading cumulative multi-row expectation was
also corrected. SMS `sent` remains a display-only provider-acceptance label; delivery
callbacks and retry expansion remain deferred.

Full regression is **450/450** (portal 181, mobile 218, edge 51); production build and
all TypeScript checks pass. The existing large-chunk advisory remains non-blocking.
D6-01 has a conservative release-candidate decision: no automatic audit purge; real
production deployment requires a health-office-approved retention/archive policy.
Next: Day 7 whole-system security, release, and defense-flow verification.

---

# Codex review — Day 5 attention dashboard and migration 0037

2026-09-10. Result: **APPROVED AND APPLIED**.

Migration 0037 exposes one count-only `facility_dashboard_overview()` row to active
TB-DOTS staff and no row to other authenticated personas. Every source predicate derives
the caller's facility server-side. Its final linked rollback matrix passed **9/9**, covering
two populated facilities, an empty facility, Manila timestamp boundaries, +7/+8 date
edges, 30/31-day stale edges, resolved versus unresolved missed appointments, closed-case
exclusion, inactive/non-clinical denial, exact totals, and the function ACL/posture.

The portal makes one RPC rather than loading rows to count them. Six attention cards open
matching case/referral filters; eight supported program totals and the six existing today
counts share the response. Attention is factual: overdue is an open past appointment,
missed is a staff assertion with no later scheduled/attended visit, and stale uses the
documented age/live-visit window. No patient row, clinical text, ranking, inferred
diagnosis, or risk score reaches the dashboard. Existing appointment, case, and follow-up
indexes cover the filters; 0037 adds `(facility_id, status)` for the referral queue.

Full regression is **439/439** (portal 170, mobile 218, edge 51); production build and all
TypeScript checks pass. The remaining Vite large-chunk message is the pre-existing advisory.
Next: Day 6 audit viewer/access, appointment audit coverage, SMS and security review.

---

# Codex review — Day 4 timeline and migrations 0035/0036

2026-09-10. Result: **APPROVED AND APPLIED**.

Migration 0035 closes the referral-history gap forward-only. Its trigger captures stage,
presentation, result-date, owner and sample-ID changes while excluding result free text
and positive/negative findings. It also fixes the latent NULL-whitelist bypass before
adding referrals to the audit CHECK. The transcription/mutation verifier is clean; Codex
independently reran the linked rollback matrix at **20/20 PASS** before atomic application.

The Task 4.1 draft required one privacy correction: its proposed BHW timeline exposed
treatment dates and outcomes that `bhw_case_summary()` deliberately withholds. Migration
0036 therefore admits active TB-DOTS staff only and authorizes every source arm
independently. A receiving facility can see its transferred case events without gaining
the former facility's pre-case/referral history. The contract also adds
`appointment_overdue` as a derived fact distinct from staff-asserted `appointment_missed`.
Historical referral state without a 0035 audit record remains explicitly undated.

The 0036 live rollback matrix passed **16/16**: role and cross-facility denial, transferred
case isolation, event vocabulary, stable order/limit, Manila timezone agreement, detail
whitelist, clinical-text exclusion and voided-follow-up omission. Migration 0036 is
applied. The portal renders the bounded stream with a separate honest undated group and
never receives notes, contact data, symptoms or lab result values.

Full regression is **430/430** (portal 161, mobile 218, edge 51); production build and
all TypeScript checks pass. Next: attention dashboard and metrics.

---

# Codex review — Day 3 treatment visits and migration 0034

2026-09-10. Result: **APPROVED; MIGRATION 0034 APPLIED**.

The portal visit workflow calls `record_visit()` once for attendance, a retained
follow-up, an optional supported case transition, and an optional next appointment. Its
request ID remains stable across failed retries. Closing suppresses next scheduling and
requires an accepted national outcome. Terminal cases accept no new visits but retain
correction tools. Paired date correction and voiding use their owning-facility RPCs;
note correction uses only the granted `notes` column. The UI prevents attendance from
being undone while a live replacement follow-up still depends on that appointment.

Migration 0034 correctly keeps two claims separate: overdue is derived from
`scheduled_date < manila_today()`, while missed remains a staff assertion. A sweep would
both risk false no-shows and push every touched row into the live SMS function's
`updated_at` window, so non-mutating detection is the safe boundary. The function is
`STABLE SECURITY INVOKER`; existing appointment/patient/case RLS scopes every result.
Codex independently reran the linked rollback matrix at **26/26 PASS**, then applied the
migration atomically. Post-apply checks confirm authenticated-only execution, no
`SECURITY DEFINER`, the partial scheduled-date index, and three currently overdue rows.

Full regression is **425/425** (portal 156, mobile 218, edge 51); production build and
all TypeScript checks pass. Next: timeline contract review and UI.

---

# Codex review — Tasks 2.2–2.5 case registry

2026-09-10. Result: **APPROVED**.

The portal now creates a case only from an explicit clinician action after referral
arrival, using `create_tb_case()` with a stable retry request ID. A failed existing-case
lookup suppresses creation, and an existing referral or active patient case is opened
instead of offering a duplicate. The registry reads only RLS-scoped rows, batches child
queries, supports lifecycle and factual follow-up filters, and keeps its detail pane
inside the selected filter.

All lifecycle changes use `set_tb_case_status()`; the client performs no direct case
UPDATE. Closed/cancelled cases are not labelled as needing attention, voided visits remain
visible but do not become the latest live visit, and the UI uses the accepted six-outcome
vocabulary. English, Tagalog, and Cebuano keys are aligned. Full regression is
**416/416** (portal 147, mobile 218, edge 51); production build and all TypeScript checks
pass. The only build output is the existing Vite chunk-size advisory. Next: implement
the treatment visit and correction/void workflow through the approved RPCs.

---

# Codex review — Migration 0033 and appointment client contract

2026-09-10. Result: **APPROVED, APPLIED, AND COMPATIBILITY GATE CLOSED**.

The required authenticated old-client run initially exposed a real compatibility defect:
legacy whole-row PostgREST upserts assign `appointment_id` and `created_at`, while migration
0031 had intentionally granted UPDATE only on business columns. PostgreSQL rejected the
request before RLS or the ownership trigger could preserve the new links. Migration 0033
grants those two legacy payload columns while extending the immutable trigger to reject
any real identifier or `created_at` change. Its live rollback matrix passed **13/13**, and
the migration was applied atomically.

The final harness used a disposable Auth user with a BHW profile, ran both referral-linked
and case-linked fixtures, passed **9/9**, printed `GATE: CLOSED`, and removed both profile
and Auth user afterward. No real account password was changed, committed, or retained.

The formerly blocked client contract is implemented: portal reads and creates appointments
by explicit referral/facility ownership and supports `cancelled`; mobile schema v12 and sync
preserve both owner IDs and the status; all English, Tagalog, and Cebuano copies cover the
state; SMS resolves location from `appointment.facility_id` and uses newest-referral lookup
only for legacy NULL owners. Focused typechecks and web/mobile/edge tests pass. Full-suite
regression is **402/402** (web 133, mobile 218, edge 51), and the production build plus
all TypeScript checks pass.

---

# Codex re-review — Migration 0031

2026-09-09; reviewed commit `09c36bd`. Result: **APPROVED AND APPLIED**.

M31-02 through M31-07 are resolved. The policy/body verifiers pass, and the strengthened live rollback preflight passed **140/140** after one final harness correction: the `correct_tb_case_dates()` denial now runs against a closed case, so it reaches that RPC's live-follow-up guard instead of failing early on the ordinary outcome-shape CHECK. The legal close and post-void correction are positive controls. Migration 0031 was then applied atomically to the linked project. Post-checks confirm the four new tables, all eleven TB-DOTS short codes, and the active `rpc-requests-purge` cron job.

The PostgREST harness also needed a final correction. It now selects viable fixtures deterministically, exits non-zero for every skipped fixture, and cannot print `GATE: CLOSED` under the service-role fallback. A service-role probe executed both referral-linked and case-linked fixtures and preserved all three ownership columns, but the mandatory authenticated run remains open because this checkout has no `TBSCREEN_TEST_PASSWORD`. Do not start the client contract unit until the same script reports `GATE: CLOSED` as `bhw.arcenal@tbscreen.ph`.

---

# Codex review — Migration 0031

2026-09-09; reviewed local commit `8c9d4ce`. Result: **CHANGES REQUIRED — DO NOT APPLY**.

The seven declared deviations D1–D7 are accepted, and M31-01's UUID aggregation correction is sound. The original verifier passes 13/13 and Claude's original live preflight passed 119/119 with rollback. The review added four focused appointment checks; the valid positive control passed, while the three isolation checks failed. The live rollback preflight therefore ended at **3/123 FAIL**, proving the defect without changing the database.

- **M31-02 — HIGH: appointment links do not preserve patient identity.** `appointments_referral_facility_agrees` and `appointments_case_facility_agrees` include only the link ID and facility ID. PostgreSQL therefore accepts an appointment for patient A linked to patient B's referral or case at the same facility. `assign_appointment_to_case()` repeats the gap because it checks facility and case status but never compares the appointment patient with the case patient. Make both parent keys and both appointment FKs patient-aware, preserving the reviewed cascades, and keep the new regression checks.
- **M31-03 — HIGH: the TB-DOTS insert policy widens admission to any patient UUID.** Before 0031, `appointments_tbdots_insert` required `patient_id in app_private.referred_patient_ids()`. The replacement accepts any row naming the caller's facility when `tb_case_id` is NULL. The live probe confirmed DOTS A can insert an unlinked appointment for a patient referred only to DOTS B. Preserve the existing patient-scope predicate for unlinked inserts; linked referral/case rows must prove patient and facility agreement.
- **M31-04 — HIGH: `set_tb_case_status()` can close a case before an existing live follow-up.** The follow-up trigger enforces `visit_date <= outcome_date` only when the follow-up changes; closing the parent never re-checks existing rows. Closing must reject an outcome date earlier than any non-voided follow-up, with a regression test.
- **M31-05 — MEDIUM: `record_visit(p_new_case_status)` promises more transitions than it can represent.** It passes NULL treatment/outcome fields to `set_tb_case_status()`, so initial `on_treatment` and every `closed` transition fail, while `cancelled` can leave a clinical follow-up attached to an episode declared opened in error. Restrict and document the parameter's legal transitions or add the required atomic inputs, then test each advertised path.
- **M31-06 — MEDIUM: the stage-2 `tb_case_id` upsert assertion is vacuous.** The fixture is referral-linked, so `tb_case_id` is NULL before and after. Add a case-linked fixture and require its non-NULL case ID to survive the old-client payload.
- **M31-07 — HIGH, locally remediated: a real account password was committed as the script's default fallback.** The fallback is removed; the script now requires `TBSCREEN_TEST_PASSWORD` from the environment or `.env`. Because `8c9d4ce` was never pushed, amend that commit so the credential is absent from reachable branch history before any push.

The new regression checks are in `supabase/tests/0031_case_registry_matrix.sql`. After correcting 0031, regenerate and run the full rollback preflight; every row must pass before application. Then apply 0031, run both real upsert fixtures, and only then start the client contract unit.

---

# Codex review — Migration 0030, BASE-05, and migration 0031 inputs

2026-09-09. Result: **APPROVED / CLOSED**.

- Migration 0030's body verifier passed. Its first live preflight exposed invalid test syntax (`SET LOCAL TIMEZONE`); the test now uses PostgreSQL's `SET LOCAL TIME ZONE`. The regenerated preflight passed **16/16** against the live database, rolled back, and migration 0030 was then applied successfully. BASE-04 is closed.
- BASE-05 passed the mobile suite (**215/215**) and `tsc --noEmit`. A live Supabase REST check returned the requested **500/500** rows and successfully matched a PostgREST-emitted `updated_at` value through `.eq`; the timestamp round-trip assumption is verified. BASE-05 is closed.
- Migration 0031 uses the six NTP/WHO patient-level outcomes: `cured`, `treatment_completed`, `treatment_failed`, `died`, `lost_to_follow_up`, and `not_evaluated`. `treatment_success` remains a derived aggregate.
- The eleven codes in `CLAUDE_FACILITY_SHORT_CODES_PROPOSAL.md` are accepted as the TB-Screen project convention. This does not claim they are the CHO's paper-register abbreviations.
- Unconfirmed `weight_kg` is omitted from 0031. The only remaining implementation gate is the mandatory real PostgREST old-client upsert compatibility test.

Claude may proceed directly with case/follow-up migration **0031**.

---

# Codex review — Migration 0029 / BASE-06

2026-09-09; reviewed commit `290572b`, corrected two matrix defects, ran the strengthened preflight against the live database, and applied migrations 0028 then 0029. No migration defect remains open.

## Result: APPROVED AND APPLIED

The migration 0029's self-read carve-out is correct. A deactivated account must still read its own `users` row so both clients can discover and persist the deactivation state. The same account cannot read colleagues, update its own row, read clinical rows, or write clinical data. All 28 affected policies use `current_user_active_role()`; the four enumerating helpers are active-gated in `app_private`, their public wrappers are not client-callable, and `current_user_role()` safely delegates to the active-aware helper.

The first live preflight exposed **M29-01**: two test blocks declared a local variable named `n` and used unqualified `where n = ...` against `t_brgy`, causing PostgreSQL error 42702 before the matrix ran. The test now uses `t_brgy.n`.

The denial tests also lacked positive controls, creating **M29-02**: missing privileges or an always-false policy could have looked like successful inactive-user denial. The matrix now proves an active BHW can update the actually granted `users.assigned_barangay_code` column and insert a patient. These are test-only corrections; migration SQL is unchanged.

After correction, `supabase/tests/0029_preflight.generated.sql` passed **47/47** checks and rolled back. Migration 0029 was then applied in a transaction. The live post-check reports `current_user_active_role()` present, `app_private` present, and exactly **28 active-aware policies**. Migration 0028 was applied first as required.

Verification also passed:

- `verify-0029-policies.mjs`: 26 verbatim policy transcriptions, two declared predicate additions, and both mutation self-tests.
- `verify-0028-bodies.mjs`: all six function bodies and both mutation self-tests.
- `build-preflight.mjs 0028` and `0029`: both generated successfully. The comment-only 0028 change is accepted.

BASE-06 is closed. Case/follow-up work may proceed as migration 0030 after its remaining product inputs are settled. Support must retain the documented rule that deactivation strands queued offline writes until reactivation; the existing sign-out flow preserves the local queue.

---

# Codex final re-review — Migration 0028 and design Revision 4

2026-09-09; reviewed the ten corrections M28-01 through M28-03 and R3-01 through R3-06, plus the continuing BASE-06 finding. No new finding was opened.

## Migration 0028 result: APPROVED FOR APPLICATION

The corrected artifacts close all three migration findings:

- **M28-01 resolved.** The ACL inspection uses a LEFT JOIN so PostgreSQL's grantee OID 0 is rendered as `PUBLIC`. Migration 0028 explicitly revokes `PUBLIC`, `anon`, and `service_role` from the helper and all six repaired functions, then grants only `authenticated`.
- **M28-02 resolved.** `node scripts/verify-0028-bodies.mjs` reports all six bodies equal to their source bodies outside the intended guard changes. Its self-test catches mutations in both a query token and the pre-existing `dashboard_counts()` declaration block.
- **M28-03 resolved.** Migration 0028 and the matrix contain no transaction control. `node scripts/build-0028-preflight.mjs` generated one `BEGIN; <migration> <matrix> ROLLBACK;` batch. The matrix asserts the JWT-derived UID, exact active-role helper result, the seven-by-seven allow/deny grid, ACL-origin anonymous denials, and the named BASE-01 cases; it raises on any failure.

I ran `supabase/tests/0028_preflight.generated.sql` against the configured live Supabase PostgreSQL database using the database URL already present in the repository environment. Result: **73/73 PASS**. The batch reached its explicit `ROLLBACK`; migration 0028 was not applied by this review.

## Revision 4 architecture result: APPROVED

- **R3-01 resolved:** unchanged parent links plus final facility agreement authorize referral/case cascades; the GUC is limited to link swaps, legacy claims, and transfers.
- **R3-02 resolved:** `treatment_followups` uses table-level UPDATE revocation followed by grants for ordinary correction columns only, with effective privilege and direct PATCH tests required.
- **R3-03 resolved:** the TB-DOTS arm explicitly requires `short_code IS NOT NULL`; the proposal contains the six three-valued-logic cases.
- **R3-04 resolved:** every new or replaced policy uses `current_user_active_role()`.
- **R3-05 resolved:** the enumerating case-ID helper is active-role-aware and placed in the non-exposed `app_private` schema.
- **R3-06 resolved:** the withdrawn admin-queue workflow no longer appears as current behavior.

The live `facilities` check also passed: exactly eleven `tb_dots` rows exist, and their IDs and names match the proposed mapping. The proposed short codes remain provisional until the CHO/TB-DOTS staff confirm whether their paper workflow already uses abbreviations.

## Next unit

Take **BASE-06 next**, before case implementation. It is a release-blocking authorization gap across the existing RLS policies and four exposed enumerating helpers. With 0028 reserved for BASE-01, BASE-06 becomes migration **0029** and the approved case/follow-up design moves to migration **0030**. The BASE-06 unit needs a construct-wide policy/helper inventory, a real-role active/inactive RLS matrix, and mobile/web regression coverage.

Before 0030 is written, update the design's migration references from 0029 to 0030. The remaining external product inputs are the facility's outcome vocabulary and local short-code convention. The old-client upsert case remains a mandatory implementation test; `weight_kg` remains optional and must be omitted if unconfirmed.

---

# Codex review — Task 1.1 baseline

2026-09-09; repository HEAD `4659d65`. No Claude sprint checkpoint or design handoff was available. Review-only: implementation and migrations unchanged. Findings below are confirmed from repository source; deployed ACLs and exploit behavior were not tested. Baseline audit is complete. Security/release approval is **NOT PASS**; Task 1.4 awaits Claude's design.

## BASE-01 — Report authorization fails open for NULL roles

Severity: HIGH
File: supabase/migrations/0027_barangay_report.sql; supabase/migrations/0026_rename_captain_to_midwife.sql
Location: barangay_report line 67; admin_overview lines 122 and 164
Problem: current_user_role() returns NULL for anonymous callers and authenticated callers without a public.users row. Both `NULL NOT IN (...)` and `NULL <> 'admin'` evaluate to NULL, so the PL/pgSQL IF does not raise. The SECURITY DEFINER query then runs. admin_overview explicitly grants anon EXECUTE; barangay_report contains no revoke of default PUBLIC execution.
Impact: The repository permits unauthorized access to restricted aggregate health/program counts and staffing data. This is not a demonstrated patient-row leak, but bypasses the intended reporting-role boundary.
Recommended fix: Claude should add a new migration with null-safe role checks (IS DISTINCT FROM for a single role; explicit NULL rejection for an allowlist) and explicit least-privilege function ACLs. Test anonymous, missing-profile, BHW, midwife and allowed callers with real database roles. Inspect deployed default privileges as well.

## BASE-02 — Appointments have no facility boundary of their own

Severity: HIGH
File: supabase/migrations/0005_fix_rls_recursion.sql; supabase/migrations/0011_appointments_tbdots_insert.sql; web/src/components/ReferralDetail.tsx
Location: appointments_tbdots_read/update; appointments_tbdots_insert; appointment load at lines 86–89
Problem: Read/update/insert authorization depends solely on patient_id appearing in referred_patient_ids(). Appointments contain neither facility nor referral ownership. When a patient has referrals at facilities A and B, staff at both facilities can see and change every appointment for that patient. The UI also loads by patient alone.
Impact: One facility can alter another facility's intended attendance/schedule, and case episodes cannot be separated safely. SMS currently selects the latest referral's facility, so it can also identify the wrong destination.
Recommended fix: Resolve explicit appointment ownership in Tasks 1.2/1.3, including legacy rows and BHW-created initial visits. Update policies, UI queries and SMS lookup together in Claude's implementation. Test a patient with two facilities and two episodes; do not infer ownership through an ambiguous backfill.

## BASE-03 — Failed walk-in registration leaves partial records

Severity: HIGH
File: web/src/components/RegisterPatient.tsx
Location: save(), lines 224–299 (patient/screening/referral inserts)
Problem: Three independent PostgREST writes create the chain. Failure after the patient or screening succeeds leaves those rows committed. Retrying allocates new UUIDs and another display code rather than resuming the original chain.
Impact: Partial enrollment and duplicate patient records; the normal referral inbox cannot show the unfinished chain. Widened read policy alone does not provide a repair workflow.
Recommended fix: Claude should implement an authorized atomic registration RPC with patient/screening/referral consistency checks and an idempotent retry identifier. Test failure at each step and a lost success response. This confirms the concern explicitly assigned to Task 7.4; address before building case creation on this flow.

## BASE-04 — New report bypasses the Manila calendar helpers

Severity: HIGH
File: supabase/migrations/0027_barangay_report.sql
Location: scr/ref CTE date predicates, lines 90–105
Problem: created_at timestamptz values are compared directly to date parameters. Conversion uses the database session timezone rather than manila_day_start(), despite migration 0018 introducing that helper to fix this same problem. With a UTC session, midnight-to-08:00 Manila events fall in the preceding reporting day.
Impact: Incorrect screened/referral/outcome period counts at day/month/year boundaries.
Recommended fix: In a new migration, use half-open ranges bounded by manila_day_start(from_date) and manila_day_start(to_date + 1). Test both boundaries under a UTC database session. Separately reconcile the header's claim about event dates with the implemented referral-created-date basis; result_date is not used here.

## BASE-05 — Sync cursor can permanently skip timestamp ties

Severity: HIGH
File: mobile/src/sync/syncEngine.ts
Location: pullTable(), query and maxSeen cursor update
Problem: Pull uses one server-capped request ordered only by updated_at, then advances the cursor to the largest returned timestamp and uses strict greater-than next time. If more rows share that timestamp than fit in the response limit, omitted tied rows can never satisfy a later pull. A bulk transaction can give many rows the same now() timestamp.
Impact: A device can permanently miss server rows even after repeated successful syncs. This is a source-derived boundary scenario, not a device reproduction.
Recommended fix: Schedule an explicitly scoped sync correction with Claude, preserving the existing architecture. Use stable pagination with a timestamp/primary-key cursor or an equivalent complete-boundary strategy. Test more than the response cap with identical timestamps and interrupted/resumed pulls. Do not bundle a sync rewrite into case work.

## Validation and remaining gate evidence

- Web: 129 tests passed; npm.cmd run typecheck passed.
- Mobile: 197 tests passed; npx.cmd --no-install tsc --noEmit passed.
- Edge: 47 tests passed; npm.cmd run typecheck passed for its configured shared-module scope. This excludes the Deno entrypoints and gateway from that typecheck.
- Total: 373 passed, 0 failed, 0 skipped. Initial npm.ps1 wrapper invocation was blocked by local PowerShell policy; the normal npm.cmd wrapper succeeded.
- No live database/RLS, migration replay, device offline integration, browser manual accessibility, deployed SMS delivery or production deployment checks were performed. Passing mocked/unit tests does not clear these findings.
- Documentation discrepancy: SYSTEM_DOCUMENTATION.md line 3 reports migrations through 0025; repository has 27. Reconcile during Task 7.5.

Next handoff: Claude reads this review and the baseline audit, resolves high-severity issues in the appropriate authorized work units, and supplies Tasks 1.2/1.3 designs for the Task 1.4 review. Codex has not approved a new schema or taken ownership of implementation.

---

# Codex review — Task 1.4 architecture gate

2026-09-09; reviewed `CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md`, `CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md`, and the cited implementation at repository HEAD `4659d65`. The deliverables are design documents only, so the 373-test baseline was not rerun.

**Gate result: NOT APPROVED.** The entity split, explicit case ownership, one-active-case constraint, appointment reuse, no-delete posture, aggregate timeline direction, and server-side BHW summary are sound. No CRITICAL issue was found, but the HIGH findings below must be resolved in the design before migration 0028 is written.

## ARCH-01 — The proposed facility transfer cannot satisfy its foreign keys

Severity: HIGH
File: docs/agent/CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md; docs/agent/CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md
Location: Task 1.2 sections 4–5; Task 1.3 section 2
Problem: `tb_cases_referral_agrees` requires the case facility to keep matching the originating referral facility. Moving the case therefore fails unless the historical referral is also rerouted, which would destroy its meaning. Separately, the case/appointment composite FK is immediate by default: updating the case first conflicts with old child facilities, while updating appointments first conflicts with the old case facility. "Same transaction" does not defer those checks.
Impact: `transfer_tb_case()` cannot perform the documented transfer for a case with an originating referral or linked appointments.
Recommended fix: Keep the referral as immutable provenance and validate its agreement at case creation rather than for the case's entire lifetime, or model original and current ownership separately. Make the case/appointment ownership change executable with an explicitly reviewed `ON UPDATE CASCADE` or deferred constraint. Add a transactional transfer test with both a referral and appointments. If global active-case uniqueness ships, the admin transfer RPC must ship even if its UI is deferred, or a receiving facility can be blocked without an operational remedy.

## ARCH-02 — Case creation does not define patient-scope authorization

Severity: HIGH
File: docs/agent/CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md
Location: section 7, `create_tb_case`
Problem: The RPC derives the caller's facility, but the design does not require that the patient is referred to that facility or was validly registered there. With nullable `p_referral_id`, a SECURITY DEFINER function bypasses RLS and could attach any supplied patient UUID to the caller's facility. It also does not require the resolved facility to be type `tb_dots` or explicitly account for `users.active`.
Impact: A facility user could create a cross-facility case, disclose that a patient identifier exists through errors/results, and use the global partial unique index to block the correct facility from opening a case.
Recommended fix: Specify and test a null-safe admission predicate inside the RPC. Referral-backed creation must require the referral's patient and receiving facility to match. Referral-free creation needs an explicit authorized intake/transfer-in rule rather than mere patient existence. Validate an active TB-DOTS profile and facility type inside every SECURITY DEFINER write RPC.

## ARCH-03 — Direct case UPDATE contradicts the RPC-only lifecycle

Severity: HIGH
File: docs/agent/CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md
Location: sections 3, 7, and role table in section 8
Problem: The design says all transitions go through `set_tb_case_status()`, but grants TB-DOTS staff direct table UPDATE. The proposed immutable trigger protects identity fields only. A direct PostgREST update can still alter status and dates outside the RPC transaction, and can bypass RPC-specific audit/cancellation behavior even if a transition trigger rejects some state edges.
Impact: Status, outcome, appointment cancellation, and audit records can diverge depending on which write path the client uses.
Recommended fix: Make mutation RPC-only by removing direct UPDATE policy/grant, or restrict grants to a precisely justified set of non-lifecycle columns and prove every invariant in table triggers. The RPC and trigger must share one transition authority, and changing to `closed` must atomically write the audit event and cancel the defined appointments.

## ARCH-04 — Appointment ownership fields remain writable through existing policies

Severity: HIGH
File: docs/agent/CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md; supabase/migrations/0007_bhw_barangay_scope.sql; supabase/migrations/0011_appointments_tbdots_insert.sql; supabase/migrations/0020_immutable_identity_columns.sql
Location: Task 1.3 sections 2–3; existing appointment UPDATE policies and immutable trigger
Problem: Adding `facility_id` and `tb_case_id` changes the authorization keys, but the design does not revoke or constrain direct updates to those columns. Existing BHW and TB-DOTS UPDATE paths would be able to reassign ownership/linkage. The current immutable trigger pins only appointment_id and patient_id. The legacy policy can also accept a move back to NULL when the patient is referred to the caller's facility.
Impact: A client can detach or reassign appointments, revive patient-wide visibility, and corrupt case/facility ownership.
Recommended fix: Define column grants and/or controlled assignment RPCs before adding the columns. BHWs may supply facility ownership only on initial insert from their referral flow; later facility/case assignment and transfer must be authorized operations. Test malicious direct updates by BHW and both involved facilities.

## ARCH-05 — The stated mobile scope is internally inconsistent

Severity: HIGH
File: docs/agent/CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md; mobile/src/db/types.ts; mobile/src/db/database.ts; mobile/src/db/appointmentsRepo.ts; mobile/app/referral/[screeningId].tsx
Location: Task 1.3 sections 3.1 and 5/open question 5
Problem: The design says the next mobile release sends `facility_id` on the initial appointment, but also says its only mobile change is the `AppointmentStatus` union. The current SQLite schema, AppointmentRow, repository mapping, push payload, and `insertLocalAppointment()` call contain no appointment facility field.
Impact: New mobile appointments will continue arriving unowned, so BASE-02 remains open and the promised NULL-row exit criterion cannot be reached.
Recommended fix: Treat facility ownership as one cross-layer contract change: add a local SQLite migration, row types, repository read/write/pull mapping, sync payload, referral-screen insert, cache tests, and old-database upgrade test. Case UI can remain web-only. Verify the old-client upsert behavior against the real PostgREST stack before relying on omitted keys to preserve server columns.

## ARCH-06 — The legacy appointment policy does not have a reliable shrinking path

Severity: HIGH
File: docs/agent/CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md
Location: section 3
Problem: Old mobile builds can continue inserting NULL-facility appointments, contradicting “the set never grows.” For a patient referred to multiple facilities, the proposed legacy predicate makes the same unowned row visible to each facility. An “Unassigned appointments” screen cannot determine which one may claim it without referral/appointment provenance.
Impact: The temporary cross-facility hole can persist indefinitely, and assignment itself can become a race between facilities.
Recommended fix: Define a bounded compatibility window and a deterministic assignment authority. Prefer adding explicit referral ownership for pre-case appointments where the mobile workflow knows the referral, or use a server RPC that atomically creates the referral and its initial appointment. Do not promise `facility_id NOT NULL` until unsupported clients are retired and all legacy rows have an unambiguous resolution path.

## ARCH-07 — The shared idempotency key is under-specified

Severity: HIGH
File: docs/agent/CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md
Location: section 7, `rpc_requests`
Problem: A global caller-supplied `request_id` with only `created_at` and generic `result_id` does not bind a request to its operation, actor/facility, or input. Reuse or collision across case creation and walk-in registration can return the wrong result or suppress a legitimate operation. The design does not state how an existing request is authorized before replaying its result.
Impact: Idempotent retry can become a cross-operation integrity or data-disclosure defect.
Recommended fix: Store operation, caller/facility scope, request fingerprint, typed result reference, and timestamps; enforce uniqueness on the intended namespace. On replay, require the same authorized caller scope and identical payload or reject it. Keep the table inaccessible to clients. It may be created in the case migration once this contract is defined, then reused by the atomic walk-in RPC.

## ARCH-08 — Follow-up records lack temporal and invalidation rules

Severity: MEDIUM
File: docs/agent/CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md
Location: section 4
Problem: Nothing constrains `visit_date` to the case interval or, when linked, to an attended appointment. “Recorded in error is an amended note” leaves a false visit structurally valid and eligible for latest-follow-up/timeline logic. Notes are deliberately excluded from audit changes, so editing the note cannot reliably mark the record invalid.
Impact: Timelines and “no recent follow-up” calculations can treat erroneous or impossible visits as real.
Recommended fix: Define whether a linked follow-up requires `appointments.status = 'attended'` and how `visit_date` relates to `attended_date`; enforce case-date bounds. Add a non-scheduling void/correction state or `voided_at/by/reason` metadata, with an audit event, while retaining the row. Recording attendance, follow-up, case transition, and optional next appointment should use an atomic RPC where the UI performs them as one visit workflow.

## ARCH-09 — Case-number generation depends on undefined schema

Severity: MEDIUM
File: docs/agent/CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md
Location: section 6
Problem: Facilities currently have no stable unique short-code column, and PostgreSQL sequences are non-transactional, so a rolled-back insert still consumes a sequence value. The promise that a failed insert consumes no number is false if this follows `next_facility_patient_code()`.
Impact: Migration implementation has no defined source for a stable case prefix and may make guarantees it cannot keep.
Recommended fix: Either accept harmless gaps explicitly or design a transactional counter row keyed by facility/year. Define, constrain, and make immutable the facility code used in case numbers; the global unique constraint remains the final collision guard.

## Gate decisions on Claude's open questions

1. Outcome vocabulary and follow-up weight are not approved until the named clinical confirmation is recorded. Weight can be omitted from the first migration if confirmation is delayed; the outcome vocabulary cannot remain an undocumented guess.
2. BASE-01 must be repaired before or in the first migration that exposes new SECURITY DEFINER RPCs. All new and repaired functions require explicit ACL tests for anon, missing-profile, inactive, wrong-role, wrong-facility, and allowed callers.
3. A corrected idempotency table may live in the case migration and later serve walk-in registration; ARCH-07 must be resolved first.
4. Admin-wide audit reads are acceptable only for the documented metadata whitelist, with no clinical free text/contact data and a tested null-safe active-role gate.
5. Transfer UI may be deferred. The transfer RPC cannot be deferred if one-active-case-across-facilities is enforced, and ARCH-01 must make that RPC executable.
6. Adding appointment status `cancelled` is compatible with the existing referral rules. Auto-cancellation on case closure is approved for scheduled appointments on or after Manila “today”; define this boundary explicitly and audit the changes. Past scheduled rows remain part of missed-visit handling.
7. Case and follow-up UI may remain web-only. Appointment facility ownership still requires the mobile data-contract work in ARCH-05.

Claude should revise the two design documents, update DECISIONS.md/CLAUDE_STATUS.md, and hand them back for a focused re-review. No migration should be created until ARCH-01 through ARCH-07 and the clinical vocabulary blocker are resolved.

---

# Codex re-review — Tasks 1.2/1.3 Revision 2

2026-09-09; reviewed Revision 2 against ARCH-01 through ARCH-09 and the cited repository contracts. No migration or application source changed, so tests were not rerun.

**Gate result: NOT APPROVED (second review).** Revision 2 materially improves the model and fully resolves ARCH-02, ARCH-03, ARCH-05, and ARCH-07. ARCH-01, ARCH-04, and parts of ARCH-08/09 still need correction. Five new or residual HIGH issues are listed first.

## R2-01 — Column-specific REVOKE does not remove the existing table UPDATE privilege

Severity: HIGH
File: docs/agent/CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md; supabase/migrations/0017_rls_hardening_users_referrals.sql
Location: Task 1.3 section 2.2; migration 0017 lines 45–46
Problem: `revoke update (facility_id, referral_id, tb_case_id)` removes column-level grants, but it does not subtract those columns from a table-level UPDATE grant. The repository already documents the required pattern in 0017: revoke UPDATE on the whole table, then grant UPDATE only on allowed columns. There is a second contract conflict: the revised mobile full-row upsert will include facility/referral IDs on its lost-response retry, so denying UPDATE on those columns can also make that legitimate conflict path fail.
Impact: As written, ownership reassignment may remain possible; if privileges are corrected naively, interrupted mobile referral sync can become permanently stuck.
Recommended fix: Replace the privilege claim with a design that handles both authorization and idempotent whole-row retries. Options include a validation trigger that permits unchanged ownership and reviewed FK cascades while rejecting client reassignment, or an atomic/idempotent referral-plus-appointment sync RPC. Test the real grants and all three paths: malicious PATCH, identical upsert retry after a lost response, and referral/case ownership cascade. ARCH-04 remains open.

## R2-02 — An appointment linked to both referral and case still blocks transfer

Severity: HIGH
File: docs/agent/CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md
Location: sections 2.1–2.2, `assign_appointment_to_case`
Problem: Both composite FKs contain the same appointment `facility_id`. If an appointment retains `referral_id` when it is assigned `tb_case_id`, transferring the case cascades its facility to the destination while the unchanged referral FK requires the original facility. The statement fails. The claim that the cascades cannot fight only considers rerouting the referral, not transferring the case.
Impact: ARCH-01 remains reproducible for an appointment with both links.
Recommended fix: Define and enforce link exclusivity, for example `num_nonnulls(referral_id, tb_case_id) <= 1`. `assign_appointment_to_case()` can atomically replace the referral link with the case link; the case itself retains referral provenance. Alternatively model separate ownership without sharing one facility column across two live parents. Test transfer of a case whose original appointment began referral-linked and was later assigned to the case.

## R2-03 — RPCs require audit events before the audit table is scheduled to exist

Severity: HIGH
File: docs/agent/CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md; docs/agent/CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md
Location: Task 1.2 sections 5, 7.2, and 9; Task 1.3 sections 2.2 and 4.4
Problem: Transfer and case RPCs ship in the case migration and are specified to write audit events; appointment-assignment and visit RPCs also depend on audit events. Section 9 still says `audit_logs` is implemented in the Day-6 Audit Trail task.
Impact: Early RPC migrations either fail because `audit_logs` does not exist or ship unaudited behavior that cannot reconstruct earlier changes later.
Recommended fix: Move the minimal audit table, whitelist trigger/function, RLS, and event-writing contract into the first migration that creates mutable case data. Day 6 can add the viewer and broader event coverage. Do not enable an RPC before its audit dependency exists.

## R2-04 — Treatment start is not an atomic lifecycle transition

Severity: HIGH
File: docs/agent/CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md
Location: sections 3–4 and 7.2
Problem: `set_tb_case_status()` has no treatment-start-date input, while `update_tb_case_details()` changes that date separately. The CHECK only says `on_treatment` requires a date; it permits `registered` with a treatment date. It also relies on transition history to guarantee `interrupted` has a date, but the details RPC could later clear it because there is no row CHECK covering interrupted/closed cases.
Impact: Starting treatment requires two commits and can stop halfway; corrections can create registered cases that appear started or interrupted cases with no start date.
Recommended fix: Make treatment start one atomic RPC/transition, or include the date in `set_tb_case_status()`. Add a row invariant requiring a non-null start date for every state that semantically follows treatment start, and define whether registered/cancelled states must have it NULL. Restrict corrections so they cannot violate those invariants.

## R2-05 — The ambiguous-row admin queue grants clinical detail to a non-clinical role

Severity: HIGH
File: docs/agent/CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md; docs/agent/CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md
Location: Task 1.3 section 3.2; Task 1.2 role table section 8
Problem: Revision 2 says the admin queue shows a patient's referral history so an assignment is informed. The accepted role model says admins have no patient-level clinical rows, only aggregates and whitelisted audit metadata. Test data today does not make this safe for future production data.
Impact: Resolving legacy ownership would introduce a new patient-level disclosure to administrative accounts.
Recommended fix: Do not expose referral history to admin. Since current data is synthetic, resolve ambiguous rows during controlled migration/support cleanup before production, or design a minimal opaque assignment workflow whose inputs do not disclose clinical history. A clinical supervisor role would be a separate authorization decision and is outside this gate.

## R2-06 — `sole_referral_facility(patient_id)` is a callable disclosure surface

Severity: MEDIUM
File: docs/agent/CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md
Location: section 3.1
Problem: The SECURITY DEFINER helper accepts an arbitrary patient ID and returns that patient's sole referral facility. If it is executable in the exposed public schema so authenticated policy evaluation can call it, it is also reachable as an RPC unless separately contained.
Impact: A caller with a patient UUID can query a facility association outside normal row reads.
Recommended fix: Use a private/non-exposed helper or a boolean authorization helper that validates the active caller and compares only against the caller's own facility. Compute the one-off backfill directly in the migration. Include direct-RPC denial in the ACL tests.

## R2-07 — Follow-up correction and voiding are not internally complete

Severity: MEDIUM
File: docs/agent/CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md
Location: sections 4.1–4.4
Problem: Changing a linked follow-up's visit date by direct UPDATE conflicts with the unchanged appointment attendance date. Voiding retains the non-null appointment ID under a global UNIQUE constraint, so a corrected replacement cannot be recorded, and it leaves the appointment attended even when the visit itself was recorded in error.
Impact: Staff can enter a state they cannot correctly repair without direct database work.
Recommended fix: Put linked date correction in an atomic RPC that updates both rows. Decide whether void means “clinical note invalid but attendance remains” or “visit did not happen.” Use a partial unique index for active, non-voided follow-ups if replacement is allowed, and update/revert appointment attendance when the latter meaning applies.

## R2-08 — Facility short-code migration does not cover all facility rows

Severity: MEDIUM
File: docs/agent/CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md; supabase/seed.sql
Location: Task 1.2 section 6; seed facility `...b1`
Problem: The design adds `facilities.short_code NOT NULL` but proposes seeding only the TB-DOTS facilities from migration 0009. The schema also contains barangay health stations, including the seeded Casisang BHS, and admin facility creation supports facility types generally.
Impact: The migration can fail on existing non-DOTS rows, or future facility creation can be blocked by a case-number field that BHS facilities do not use.
Recommended fix: Prefer a nullable unique `short_code` required by a CHECK only when `type = 'tb_dots'`, unless short codes are intentionally defined for every facility type. Populate and validate existing rows before adding the CHECK. Claude should propose the eleven DOTS mappings from 0009 as a separate reviewable table; do not derive mutable codes from names at runtime.

## Revision-2 disposition and remaining inputs

- ARCH-02, ARCH-03, ARCH-05, and ARCH-07: resolved at design level.
- ARCH-01: remains open through R2-02; the case/referral lifetime pin itself is resolved.
- ARCH-04: remains open through R2-01.
- ARCH-06: the shared facility visibility is resolved, but the admin resolution path is rejected under R2-05.
- ARCH-08: temporal bounds and atomic visit recording are accepted; correction/void semantics remain under R2-07.
- ARCH-09: transactional counter is accepted; facility-code rollout remains under R2-08.
- The old-client PostgREST upsert remains a mandatory real-stack test. It does not by itself block architecture approval once R2-01 defines a safe compatibility path.
- The conditional outcome design is accepted: if the locally used MOP vocabulary is not confirmed, omit `outcome` and keep `closed` unreachable in the first case migration. `weight_kg` may likewise be omitted.

**BASE-01 decision:** Claude should take it now as its own migration and work unit. It is an independent live authorization defect. Because no new migration exists yet, that repair becomes `0028`; all case-design references must then move to `0029` or the next actual sequential number. The BASE-01 migration must contain the null-safe active-role checks, explicit function ACLs, and real-role denial matrix already specified. It must receive its own Codex review before case implementation begins.

**Facility code decision:** Claude should prepare the explicit eleven-row DOTS mapping from migration 0009 for review. Resolve R2-08's nullable/type constraint first. The codes are persisted identifiers and must be reviewed as data, not generated silently from facility names.

No case migration should be written while R2-01 through R2-05 remain open. The independent BASE-01 repair is approved to proceed now.

---

# Superseded review — Migration 0028 and design Revision 3

This section records the third-gate findings for audit history. The final Revision 4 review at the top of this file closes them and controls current status.

2026-09-09; reviewed `0028_null_safe_role_gates.sql`, its verifier and SQL matrix, both Revision-3 design documents, and the facility-code proposal. Ran `node scripts/verify-0028-bodies.mjs` successfully (six reported OK) and `git diff --check` successfully. The database matrix could not be run in this environment.

## Migration 0028 result: CHANGES REQUIRED before application

The migration's core authorization change is correct on source inspection: `current_user_active_role()` collapses anonymous, missing-profile, and inactive callers to NULL; the two genuinely fail-open guards now reject NULL; the other four functions become active-aware; and anon/PUBLIC execution is explicitly revoked. BASE-04 is appropriately left for its own migration.

The work unit is not yet PASS because the mandatory database verification has not run and its verification artifacts contain the issues below.

### M28-01 — ACL post-check hides PUBLIC and expects service-role grants to disappear without revoking them

Severity: MEDIUM
File: supabase/migrations/0028_null_safe_role_gates.sql
Location: POST-CHECK 1 and function ACL blocks
Problem: The ACL query inner-joins `pg_roles`; PostgreSQL represents PUBLIC as grantee OID 0, which has no `pg_roles` row, so the query can never display a surviving PUBLIC grant. It also expects `service_role` only on `admin_overview`, but the migration does not revoke the explicit service-role grants created by Supabase default privileges or preserved by CREATE OR REPLACE.
Impact: The documented ACL expectation either fails for service-role rows or falsely reports no PUBLIC row even if one exists.
Recommended fix: Use a LEFT JOIN and render grantee 0 as `PUBLIC`. Either explicitly revoke service_role on functions that should not expose it or document and expect it consistently; service_role already bypasses RLS, so this is least-privilege clarity rather than a new patient-data boundary.

### M28-02 — Body verifier excludes existing declaration logic

Severity: MEDIUM
File: scripts/verify-0028-bodies.mjs
Location: `normalize()`
Problem: The verifier discards everything before the last guard. That includes unchanged business logic in existing DECLARE blocks, notably `dashboard_counts()`'s Manila date variables. It therefore proves the query tail matches, not that every non-guard part of all six bodies matches.
Impact: A transcription error in excluded declarations can change reporting behavior while all six checks print OK.
Recommended fix: Remove only the exact old/new guard spans and newly introduced `v_role` declaration, retaining every pre-existing declaration. Mutation-test a declaration token such as `d_next` as well as a query-body token.

### M28-03 — The role matrix does not yet support the claimed pre-apply workflow

Severity: MEDIUM
File: supabase/tests/0028_role_gate_matrix.sql
Location: setup, `current_user_active_role` expectations, and transaction ending
Problem: The matrix calls definitions that exist only after 0028, while 0028 commits itself, so it cannot be run “before 0028 is applied” as currently packaged. The test begins a transaction but does not roll it back itself despite being described as self-rolling-back. It checks only whether `current_user_active_role()` is callable, not that it returns NULL for missing/inactive profiles and the exact role for active profiles. It also assumes `request.jwt.claims` drives `auth.uid()` without asserting the simulated UID.
Impact: The required safety check can be run in the wrong order, leave test accounts if the SQL-editor session commits, or miss a broken helper result/setup.
Recommended fix: Provide a transactional preflight script that installs the migration definitions without committing, runs assertions, and always rolls back; then apply the unchanged migration after PASS. Make the matrix fail on any FAIL row, assert `auth.uid()` after setting claims, and assert exact helper return values. If a disposable Supabase branch is available, running migration then matrix there is equally acceptable.

### BASE-06 — Deactivated users retain RLS row access until JWT expiry

Severity: HIGH
File: supabase/migrations/0002_rls_policies.sql and later replacement policies
Location: policies still calling `current_user_role()`
Problem: Migration 0028 deliberately hardens RPC gates only. Existing row policies still use the non-active-aware helper, so a deactivated user with a valid access token retains scoped patient/referral/screening/appointment access.
Impact: Account deactivation is not an immediate authorization revocation for patient-level data.
Recommended fix: Take this as the next dedicated security unit, with a full real-role RLS matrix and mobile/web regression pass. New policies in case migration 0029 must use active-aware gates from their first version. This residual issue does not negate 0028's RPC fix, but it is a release-blocking HIGH finding.

## Revision 3 architecture result: NOT APPROVED

Revision 3 resolves R2-02, R2-03, R2-04, R2-05, R2-06 and most of R2-07/R2-08. The remaining HIGH findings follow.

### R3-01 — Ownership trigger rejects authenticated FK cascades

Severity: HIGH
File: docs/agent/CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md
Location: section 2.2, `enforce_appointment_ownership()`
Problem: A BHW rerouting a submitted referral performs a normal authenticated UPDATE. The FK's `ON UPDATE CASCADE` does not change the JWT claim, so `auth.role()` remains `authenticated` when the appointment trigger runs. The RPC-only GUC is not set on this path. The trigger therefore rejects the legitimate cascade, contrary to the document's claim that the auth-role exemption keeps cascades working.
Impact: Existing referral rerouting breaks as soon as a referral owns an appointment.
Recommended fix: Validate cascaded final ownership against the unchanged parent link instead of assuming cascades have a privileged auth role. For example, allow a facility-only change when `referral_id` is unchanged, `tb_case_id` is NULL, and the new facility equals the linked referral's current facility; similarly validate a case-linked cascade against the current case. Keep GUC authorization only for link swaps/legacy claims. Test direct malicious PATCH separately from referral cascade, case cascade, and identical retry.

### R3-02 — Follow-up void columns repeat the ineffective column-REVOKE design

Severity: HIGH
File: docs/agent/CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md
Location: section 4.6
Problem: The document still proposes `revoke update (voided_at, voided_by, void_reason)` while granting clients UPDATE on `treatment_followups`. As established in R2-01, a column revoke does not subtract from a table-level UPDATE grant.
Impact: Facility clients can directly void/unvoid records, forge `voided_by`, or bypass the void RPC's reason and audit behavior.
Recommended fix: Revoke table UPDATE first and grant only ordinary correction columns (`notes` and confirmed `weight_kg`, if retained). Keep visit date and all void fields RPC-only. Verify effective `information_schema.column_privileges`/`has_column_privilege` results and direct PATCH denials.

### R3-03 — TB-DOTS short-code CHECK accepts NULL

Severity: HIGH
File: docs/agent/CLAUDE_FACILITY_SHORT_CODES_PROPOSAL.md; docs/agent/CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md
Location: `facilities_short_code_scope`
Problem: For a `tb_dots` row with `short_code IS NULL`, `short_code ~ pattern` evaluates to NULL; the entire CHECK evaluates to NULL, and PostgreSQL accepts CHECK results that are true or unknown. The constraint therefore does not make a code required for TB-DOTS facilities.
Impact: A direct or future facility insert can create a TB-DOTS facility with no usable case-number prefix, causing later case creation to fail.
Recommended fix: State `type = 'tb_dots' AND short_code IS NOT NULL AND short_code ~ '^[A-Z0-9]{2,8}$'`, with the non-DOTS NULL arm unchanged. Test NULL, lowercase, duplicate, valid DOTS, and valid BHS inputs. The eleven proposed mappings are reasonable defaults derived from 0009, pending confirmation of local abbreviations and the live row set.

### R3-04 — New appointment policy still uses the inactive-aware gap

Severity: HIGH
File: docs/agent/CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md
Location: section 3.1 policy sketch
Problem: The owned-row branch still starts with `current_user_role() = 'tb_dots'`; only the legacy helper is active-aware. A deactivated account can therefore continue reading/updating owned appointments through the new policy.
Impact: Migration 0029 would reproduce BASE-06 in newly rewritten authorization policy.
Recommended fix: Use `current_user_active_role()` in every new/replaced RLS policy and active-aware helpers from inception. Prefer resolving BASE-06 before 0029 so the policy family has one consistent rule.

### R3-05 — Case-ID helper needs the same callable-surface treatment

Severity: MEDIUM
File: docs/agent/CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md
Location: section 4.6, `own_facility_case_ids()`
Problem: The public SECURITY DEFINER helper returns case IDs based only on `current_user_facility()` and does not check active TB-DOTS role. An admin or other account attached to a DOTS facility could call it directly if it has the EXECUTE privilege needed by policy evaluation.
Impact: Non-clinical accounts can receive case identifiers outside the intended table policy.
Recommended fix: Put the helper in a non-exposed schema or make it active-role-aware and non-enumerating. Add direct-RPC ACL/return tests, following the correction already made for `sole_referral_facility()`.

### R3-06 — Revision 3 retains withdrawn admin-queue wording

Severity: LOW
File: docs/agent/CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md
Location: revision history and section 3.4
Problem: The current document still says NULL rows are “parked in the admin queue” and that tightening waits for the “admin queue” to empty, although section 3.2 withdraws that queue.
Impact: Implementers may accidentally restore a rejected admin workflow.
Recommended fix: Replace those references with the direct-session support backlog and mark old revision-history wording clearly superseded.

## Gate and next action

- Migration 0028: correct the verifier/matrix/ACL post-check, then run the transactional matrix in the SQL editor or a disposable database. It is not approved for application until that output is all PASS.
- Architecture: revise R3-01 through R3-04 before writing migration 0029. R3-05/06 should be corrected in the same revision.
- Facility codes: provisional data approval only. Local CHO abbreviations override the proposal; confirm the live database has exactly the eleven DOTS rows before populating.
- Outcome vocabulary remains a human clinical decision. The documented fallback—omit outcome and keep `closed` unreachable—is acceptable.
# Codex continuation — BASE-03 closed (2026-09-10)

Migration 0032 and its portal contract are **APPROVED AND APPLIED**. The live
rollback preflight passed **18/18**: only an active TB-DOTS caller is admitted;
server-owned identity, facility, status, display-code, age and referral-decision
fields are derived rather than trusted; exact retry returns the original result;
actor or payload reuse is denied; and injected failures at all three insert stages
leave zero rows. The portal retains all four IDs after a failed/lost response.

Live ACL post-check: function present; `authenticated` execute true; `anon` and
`service_role` execute false. Regression: web 129/129 plus production build, mobile
215/215 plus typecheck, edge 47/47 plus typecheck, all prior SQL verifiers passing.

Remaining gate: `TBSCREEN_TEST_PASSWORD` is absent, so the authenticated migration
0031 old-client check is still open. Do not begin the appointment ownership client
contract until `scripts/old-client-upsert-check.mjs` prints `GATE: CLOSED`.

---
