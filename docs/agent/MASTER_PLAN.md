# Sprint master plan

2026-09-10 Day 7 gate: **CONDITIONAL RELEASE CANDIDATE.** Automated regression is
**450/450**, builds/typechecks pass, the live security posture has RLS on every public
table and fixed search paths on all SECURITY DEFINER functions, and no Critical/High
finding remains. System documentation is reconciled through migration 0038. The
rollback-safe synthetic capstone seed covers all seven required demo states. Remaining
human checks are the physical Android offline/reconnect/cache-isolation run and
native-speaker Tagalog/Cebuano review. See `DAY7_RELEASE_VERIFICATION.md`.

2026-09-10 latest critical-path checkpoint: **Day 6 audit/security is complete and
approved. Migration `0038_appointment_audit_trail.sql` is applied.** It closes C41-02:
appointment writes from the ordinary client PATCH produced no audit row, only the 0031
RPC paths did. 0038 makes an AFTER INSERT OR UPDATE
trigger the single writer and **removes the six explicit RPC calls**, restating 471 lines
of applied plpgsql under `scripts/verify-0038-bodies.mjs`, whose self-tests catch a dropped
row lock, a loosened denial and a left-in audit call. The skip-flag alternative was
rejected: it needs the same restatement and fails silently when a future RPC forgets it.
The strengthened live rollback preflight passed **36/36** and rolled back cleanly;
`verify-0035-whitelist` still reports 7 OK. Adds `facility_audit_events()` —
keyset-paginated, **SECURITY INVOKER**, so the
facility boundary stays `audit_logs`' own RLS — and a TB-DOTS-only portal viewer that
renders sentences, never raw JSON. Review added an explicit BHW navigation gate, complete
cursor-pair handling, and stale-response suppression. SMS `sent` reads "accepted by
provider (delivery unknown)" in three languages, with no stored value, selection or retry change (Task 6.5
stays deferred). Regression **450/450**: portal 181, mobile 218, edge 51; build and all
typechecks pass. D6-01 is accepted for the release candidate with no automatic purge;
health-office retention/archive approval remains required before real production use.
Next: Day 7 whole-system security, release, and defense-flow verification.


2026-09-10 latest critical-path checkpoint: **Day 5 attention dashboard and
analytics are complete and approved.** Migration **0037** is live after its final
**9/9** rollback matrix passed. The portal loads today activity, six factual attention
categories, and eight current program totals in one count-only, facility-scoped RPC.
Every attention card opens the matching case or referral filter. Derived overdue is
kept separate from staff-recorded missed; resolved misses leave the active queue, stale
means an active case older than 30 days with no live visit in the last 30 days, and no
risk score is computed. Query review found no client N+1 or bulk-row count path; existing
case/appointment/follow-up indexes plus the new facility/status referral index cover the
predicates. Full regression is **439/439**: portal **170/170**, mobile **218/218**, edge
**51/51**; production build and all TypeScript checks pass. Next critical-path unit:
Day 6 audit viewer, appointment audit coverage, SMS/security review, and High closure.

2026-09-10 latest critical-path checkpoint: **Day 4 timeline is complete and
approved.** Migration **0035** passed its whitelist mutation verifier and an independent
**20/20** live rollback matrix before atomic application. Migration **0036** implements
the read-time patient timeline and passed **16/16** live rollback checks before application.
The review rejected the draft BHW lifecycle arm because it would have disclosed treatment
dates/outcomes absent from `bhw_case_summary()`; the live function is active-TB-DOTS-only
and authorizes each source independently. It keeps overdue distinct from staff-asserted
missed, omits free text/contact/result values and voided visits, and separates honest
historical undated state in the UI. Full regression is **430/430**: portal **161/161**,
mobile **218/218**, edge **51/51**; production build and all TypeScript checks pass.
Next critical-path unit: attention-required dashboard and operational metrics.

2026-09-10 earlier critical-path checkpoint: **Day 3 treatment/follow-up is
complete and approved.** The case detail now records an attended or unscheduled
visit through the idempotent `record_visit()` transaction, with optional lifecycle
transition and next appointment. Visit-date correction uses the paired RPC, notes
use the one permitted column update, and voiding retains history; attendance can be
undone only after no live follow-up remains. Migration **0034** is approved and
applied after Codex independently reran its **26/26** live rollback matrix. Its
Manila-calendar worklist currently derives three overdue rows without relabelling
them `missed`, changing published reports, or entering the SMS window. Full regression
is **425/425**: portal **156/156**, mobile **218/218**, edge **51/51**; production
build and all TypeScript checks pass. Next critical-path unit: approve the timeline
contract and implement its UI. Priority B remains frozen.

2026-09-10 earlier critical-path checkpoint: **Tasks 2.2–2.5 are complete and
approved.** The portal now has manual, idempotent case enrolment from an eligible
referral, a facility-scoped searchable/filterable registry, case detail with factual
visit and appointment context, and audited lifecycle actions through
`set_tb_case_status()`. It does not infer a diagnosis from screening or laboratory
results and does not write cases directly. Full regression is **416/416**: portal
**147/147**, mobile **218/218**, and edge functions **51/51**, with production build
and all TypeScript checks passing. The next critical-path unit is treatment visit
recording through `record_visit()` and the correction/void workflow. Priority B
remains frozen.

No off-path unit currently awaits review. Task 4.1 and migrations 0035/0036 are
approved and live; appointment PATCH auditing remains a separate Day 6 item (C41-02).

2026-09-10, off the critical path: Claude implemented **Task 6.2 — referral audit events**
as migration **`0035_referral_audit_trail.sql`**, **APPROVED AND APPLIED**. Transcription verifier
`node scripts/verify-0035-whitelist.mjs` 7 OK with three mutation self-tests caught; Codex
independently reran the live rollback preflight at **20/20 PASS** before application. Referrals were entirely
outside the audit surface — the `entity_table` CHECK excluded them and no referral write
path called `write_audit()` — so stage moves, no-shows and re-routes left nothing but a
mutable `updated_at`. 0035 adds an AFTER UPDATE trigger, **forward only**: no nullable
`received_at`, no backfill, which also resolves Task 4.1 §2's undated timeline events in the
better direction. It fixes a **HIGH latent bug first (C35-01)**: the whitelist's CASE has no
ELSE, so an unlisted `entity_table` left `allowed` NULL and the guard accepted *every* key —
masked only by a CHECK evaluated after the BEFORE trigger, and it would have gone quiet for
the very table 0035 admits. `result` and `result_outcome` are deliberately **not** audited:
`audit_logs` is admin-readable and admin holds no clinical read policy, so §4 revisits
`audit_logs_admin_read` as 0031's comment requires. Appointment auditing is deliberately
left open (C41-02) — the same trigger would double-log the RPC paths. New findings C34-01/02,
C35-01/02/03 and C41-01/02 are in [ISSUES.md](ISSUES.md).

2026-09-10, off the critical path: Claude implemented **Task 3.4 — missed follow-up
detection** as migration **`0034_overdue_followup_detection.sql`**, now **APPROVED AND APPLIED**, with
[CLAUDE_TASK_3.4_MISSED_FOLLOWUP_DETECTION.md](CLAUDE_TASK_3.4_MISSED_FOLLOWUP_DETECTION.md).
Codex independently reran the live rollback preflight at **26/26 PASS** before atomic application. The gap it closes:
`appointments.status = 'missed'` is read by four consumers and written by nothing but a
human, so an appointment whose day passes untouched stays `scheduled` forever and is
counted as neither attended nor missed. 0034 adds `appointment_is_overdue()` and
`overdue_followups()` — **`SECURITY INVOKER`, so facility and barangay scoping is inherited
from existing RLS rather than re-derived**, which is where M31-03 came from. It adds no
policy and writes no row. **It deliberately does not sweep rows to `missed`:**
`sms-reminders` selects follow-up candidates as `status = 'missed' AND updated_at >= now()
- 14 days`, and `appointments_set_updated_at` fires on every UPDATE, so a sweep puts every
row it touches into the live SMS window at once; separately, a sweep cannot distinguish a
no-show from a data-entry backlog. §4.3 lists what a future sweep must settle first. The
review approved this non-mutating boundary and migration 0034 is live.

2026-09-10, off the critical path: Claude wrote **Task 4.1 — the Patient Care Timeline
data contract** as a design document, [CLAUDE_TASK_4.1_TIMELINE_DATA_CONTRACT.md](CLAUDE_TASK_4.1_TIMELINE_DATA_CONTRACT.md).
Originally design-only; it is now approved with the privacy amendment recorded at the top
of that document and implemented by migration 0036 plus the portal UI. It was taken because Codex
holds uncommitted case registry UI work in `web/src` (Tasks 2.2–2.5) and rule 19 puts
those files off limits; this unit shares none of them. The finding to review first is §2:
**three of the timeline events the plan asks for cannot be dated** — `referrals` has no
`received_at`, `closed_at` or `presented_at`, and `audit_logs` cannot cover them because
its `entity_table` CHECK excludes referrals. Appointment `missed` and `cancelled` are
audited only on the 0031 RPC paths, not on the ordinary PATCH both clients use. The
contract marks those events undated rather than adding five nullable columns mid-sprint.
Migration 0035 now dates future transitions while historical state stays honestly undated;
Task 4.2 and its privacy review are complete.

2026-09-10 earlier checkpoint (superseded by the case-registry entry above): **the seven-day Priority A finish remains achievable,
but only as a strict scope-controlled sprint.** All six BASE findings are closed.
Migration **0033** restored authenticated legacy appointment upsert compatibility
without making identifiers or timestamps mutable; its live rollback preflight passed
**13/13**, it was applied atomically, and a disposable real authenticated BHW completed
the old-client harness at **9/9, `GATE: CLOSED`**. No standing account password was
changed or stored. The appointment client contract is now implemented across the portal,
mobile SQLite/sync, all six locale files, and SMS destination selection. The remaining
critical path was the user-facing case registry, treatment/follow-up UI, timeline,
attention dashboard, audit viewer/security pass, then the final regression/demo day.
Priority B work is deferred until that path is green.

Current full regression: portal **161/161**, mobile **218/218**, and edge
functions **51/51** (**430 total**); production build and all TypeScript checks
pass. The build retains its pre-existing large-chunk advisory.

2026-09-10 earlier checkpoint (superseded by the latest entry above): **BASE-03 is
closed.** Migration **0032** adds an active-TB-DOTS-only,
payload-bound, idempotent `register_walkin()` RPC and the portal now uses that one
transaction instead of three PostgREST writes. The live rollback preflight passed
**18/18**, including injected failure at each of the patient, screening, and referral
steps with zero residual rows. Migration 0032 was then applied atomically; the live
post-check confirms the function exists, `authenticated` can execute it, and `anon`
and `service_role` cannot. Full regression: web 129, mobile 215, edge 47; all passing,
with web production build and both TypeScript checks clean. At that checkpoint, the
0031 authenticated old-client gate had not yet been closed.

2026-09-09: Migration **0031 is APPROVED AND APPLIED** after its strengthened live rollback preflight passed **140/140**. BASE-02 is closed. A service-role PostgREST probe preserved all three appointment ownership columns across both fixture shapes, but the release gate still requires the authenticated BHW run; `TBSCREEN_TEST_PASSWORD` is absent from this checkout. The client contract unit remains blocked until `old-client-upsert-check.mjs` prints `GATE: CLOSED` under that identity.

2026-09-09: Migration **0031 is NOT APPROVED**. Codex added four appointment-isolation checks and ran the rollback preflight live: the positive control passed and three security/integrity probes failed (**3/123 FAIL**). The migration must enforce patient agreement in referral/case links, preserve TB-DOTS appointment admission scope, re-check follow-ups when closing a case, define `record_visit`'s supported status transitions, and make the case-linked upsert check non-vacuous. A hard-coded real-account test credential was removed; amend the unpushed 0031 commit before any push. See `CODEX_REVIEW.md`.

2026-09-09: Codex approved and applied migration **0030** after its corrected live preflight passed **16/16**. BASE-05 is also approved after **215/215** mobile tests, a clean typecheck, and successful live PostgREST page-size and timestamp round-trip checks. BASE-04 and BASE-05 are closed. The six national treatment outcomes and eleven proposed facility codes are accepted as project conventions; `weight_kg` is omitted. Claude may proceed with case/follow-up migration **0031**, with the old-client upsert compatibility test required during implementation.

2026-09-09: Codex approved and applied migrations **0028** and **0029** in order. The strengthened 0029 live preflight passed **47/47** after two test-harness corrections; the live post-check reports `app_private` present and all **28** target policies active-aware. BASE-01 and BASE-06 are closed.

2026-09-09: Final focused gate **PASSED**. Migration 0028's generated preflight ran against the configured live database and returned **73/73 PASS**, then rolled back; 0028 is approved for application but was not applied by Codex. Revision 4 architecture is **APPROVED** with M28-01..03 and R3-01..06 closed. The live database has exactly the eleven proposed TB-DOTS facility rows. Claude's next unit is BASE-06 as migration **0029**; case/follow-up implementation moves to **0030**. See CODEX_REVIEW.md and DECISIONS.md.

The authoritative plan is [TB-Screen_7-Day_Claude-Codex_Master_Plan.md](TB-Screen_7-Day_Claude-Codex_Master_Plan.md). Read that document for task ownership, architecture rules, review gates, and acceptance criteria. This entry point avoids maintaining two divergent copies.

2026-09-09: Codex performed Task 1.1 against repository HEAD `4659d65`. See CODEX_BASELINE_AUDIT.md and CODEX_REVIEW.md. No Claude checkpoint handoff was present. Tasks 1.2 and 1.3 remain for Claude; Task 1.4 requires those designs before approval.

2026-09-09: Claude completed Tasks 1.2 and 1.3 as design documents (CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md, CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md); see CLAUDE_STATUS.md. No migration, no schema, no application code. Task 1.4 is now unblocked for Codex. Migration 0028 will not be written until that gate passes.

2026-09-09: Codex completed the first Task 1.4 review with result **NOT APPROVED**. ARCH-01 through ARCH-07 and the clinical vocabulary blocker must be resolved before migration or implementation begins. See CODEX_REVIEW.md and ISSUES.md.

2026-09-09: Codex reviewed Revision 2. ARCH-02, ARCH-03, ARCH-05 and ARCH-07 are resolved, but the architecture gate remains **NOT APPROVED** due to R2-01 through R2-05. Claude may implement the independent BASE-01 authorization repair as migration 0028 now; it requires its own review. Case work moves to 0029 or the next sequential migration after that repair.

2026-09-09: Claude wrote migration 0028 and Revision 3; Codex reviewed both. The 0028 guard logic is accepted on source inspection, but application awaits corrected verification artifacts and an all-PASS real-role matrix. Revision 3 remains **NOT APPROVED** due to R3-01 through R3-04. BASE-06 (inactive accounts retain RLS access until JWT expiry) is a separate release-blocking security unit.

2026-09-09: Task 1.4 returned NOT APPROVED (7 HIGH, 2 MEDIUM). Claude revised both design documents to revision 2, addressing ARCH-01 through ARCH-09 and the seven gate decisions. Handed back for focused re-review. Migration 0028 still not written.

2026-09-09: Second gate returned NOT APPROVED (R2-01..R2-08). Claude revised both designs to revision 3 and, per Codex's decision, implemented BASE-01 as **migration 0028** with a runnable denial matrix and a transcription check. Case work moves to **0029**. The eleven TB-DOTS short-code mappings are proposed separately in CLAUDE_FACILITY_SHORT_CODES_PROPOSAL.md. 0028 needs its own Codex review before case implementation begins.

2026-09-09: Third gate returned CHANGES REQUIRED on 0028 and NOT APPROVED on Revision 3. Claude corrected the 0028 verification package (M28-01/02/03), added `scripts/build-0028-preflight.mjs`, and revised both designs to revision 4 (R3-01..R3-06). BASE-06 accepted as a release-blocking HIGH with its own unit, preferred BEFORE 0029. 0028 still needs its database matrix run before application.

2026-09-09: Claude implemented BASE-06 as migration **0029** (active-aware RLS). 28 policies rewritten onto current_user_active_role(), the four enumerating helpers moved to a non-exposed `app_private` schema, and current_user_role() closed as a trap by delegation. One deliberate carve-out: an account may always read its own users row. Ships with a policy transcription verifier and a row-access matrix. Preflight generated; **the database matrix has not been run**. Case/follow-up work remains 0030.

2026-09-09: Claude implemented BASE-04 as migration **0030** (barangay_report Manila boundaries), with a body verifier and a two-timezone boundary test carrying a negative control. Case/follow-up work therefore moves to **0031**. The preflight is generated; the boundary test has not been run.

2026-09-09: Claude implemented BASE-05 (sync cursor loses rows tied at the boundary) as a scoped client change: `mobile/src/domain/pullCursor.ts` plus a rewritten `pullTable` and local DB migration v11. Client-only — no server migration, so 0031 remains free for case work. 18 new tests; mobile suite 215 passing, typecheck clean.

2026-09-09: Session handoff written to [HANDOFF.md](HANDOFF.md) — current state, the two things to do first (apply 0030; verify the BASE-05 round-trip assumption), the clinical blocker on 0031, how to use the verification harness, and what remains unproven. Read it before resuming.
