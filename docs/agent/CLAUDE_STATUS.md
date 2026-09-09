# Claude status log

> **Codex handback — 2026-09-10, next unit Tasks 2.2–2.5:** Migration 0033 is
> approved and applied after a 13/13 live rollback matrix. A disposable
> authenticated BHW then passed the old-client harness 9/9 with `GATE: CLOSED`
> and was fully removed. The web/mobile/SMS appointment client contract is
> implemented. Full regression is 402/402, build and typechecks pass. Proceed
> with the user-facing case registry; keep Priority B frozen for the seven-day
> recovery sequence in the master plan.

> **Codex handback — 2026-09-09, migration 0031:** APPROVED AND APPLIED. The corrected live rollback preflight passed **140/140**; the installed schema has all expected tables, eleven coded TB-DOTS facilities, and the active purge cron job. A service-role PostgREST probe preserved `facility_id`, `referral_id`, and a non-NULL `tb_case_id`, but correctly left the gate open because it bypasses RLS. Add `TBSCREEN_TEST_PASSWORD` to the gitignored `.env`, rerun `node scripts/old-client-upsert-check.mjs`, and start the client contract unit only after it prints `GATE: CLOSED` under the authenticated BHW identity.

> **Codex handback — 2026-09-09, migration 0031:** CHANGES REQUIRED; do not apply. Three added live isolation probes failed (3/123): appointment referral/case links omit patient identity, and the TB-DOTS insert policy accepts an unlinked patient outside the caller's referral scope. Also close the parent-outcome/follow-up date gap, define the actually supported `record_visit` status transitions, and make the case-linked old-client upsert test non-vacuous. The hard-coded test credential fallback was removed and the unpushed 0031 commit must be amended before any push. Full details are at the top of `CODEX_REVIEW.md`.

> **Codex handback — 2026-09-09, next unit 0031:** Migration 0030 is approved and applied after a corrected live preflight passed 16/16; BASE-04 is closed. BASE-05 is approved after 215/215 mobile tests, clean typecheck, and successful live PostgREST page-size/timestamp round-trip checks. Use the accepted six-value NTP outcome vocabulary and eleven project facility codes, omit `weight_kg`, and proceed with migration 0031. Run the mandatory old-client upsert compatibility test as part of that implementation.

> **Codex handback — 2026-09-09, migration 0029:** APPROVED AND APPLIED. Codex corrected two matrix issues (`t_brgy.n` ambiguity and missing positive write controls); the strengthened live preflight passed 47/47. Migrations 0028 and 0029 are now live, and the post-check reports all 28 target policies active-aware. BASE-01 and BASE-06 are closed. Proceed to migration 0030 when its product inputs are ready.

> **Codex handback — 2026-09-09:** Final re-review passed. The live 0028 preflight returned 73/73 PASS and rolled back; migration 0028 is approved for application. Revision 4 architecture is approved. Take BASE-06 next as migration 0029; case/follow-up work has been renumbered to 0030. The live eleven-row TB-DOTS facility set matches the proposal.

## 2026-09-09 — Tasks 1.2 and 1.3 (design)

**Task completed:** Task 1.2 (TB Case domain model) and Task 1.3 (Follow-up model). Design deliverables only — the master plan gates implementation behind Codex's Task 1.4 review.

**Baseline read before starting:** `MASTER_PLAN.md`, `TB-Screen_7-Day_Claude-Codex_Master_Plan.md`, `CODEX_BASELINE_AUDIT.md`, `CODEX_REVIEW.md`, `ISSUES.md`, `DECISIONS.md`; migrations 0001, 0002, 0005, 0007, 0011, 0020, 0024, 0025; `mobile/src/sync/syncEngine.ts`, `mobile/src/db/appointmentsRepo.ts`, `mobile/src/db/database.ts`, `supabase/functions/sms-reminders/index.ts`, `web/src/lib/types.ts`.

**Files created:**

- `docs/agent/CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md`
- `docs/agent/CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md`
- `docs/agent/CLAUDE_STATUS.md` (this file)

**Files changed:** `docs/agent/DECISIONS.md` (appended), `docs/agent/MASTER_PLAN.md` (progress line).

**Migrations created:** none.
**Functions added:** none.
**RLS changes:** none.
**Application code changed:** none.

**Tests run:** none. No source file was touched, so the 373-test baseline Codex recorded is unchanged and re-running it would prove nothing about this deliverable.

---

### What the design decides

Summarised for review; the reasoning is in the two documents.

1. **Case ownership is a column, not an inference.** `tb_cases.facility_id` is NOT NULL and is the RLS key directly. No `referred_patient_ids()` indirection.
2. **One lifecycle column**, not `case_status` + `treatment_status`. Values `registered → on_treatment ⇄ interrupted → closed`, plus terminal `cancelled`. Transitions enforced by trigger.
3. **Duplicate is defined**: a second *non-terminal* case for the same patient, any facility. Enforced by a partial unique index, so it holds under concurrency.
4. **Cross-table agreement is declarative.** Composite FKs make case↔referral, appointment↔case and follow-up↔appointment agree on patient and facility; `MATCH SIMPLE` gives nullable links a clean pass.
5. **Cases are created by an idempotent `SECURITY DEFINER` RPC**, not by client inserts, so BASE-03's partial-write shape is not reproduced.
6. **BHW access is an RPC, not a policy** — a real server-side column boundary, unlike the client-side `REFERRAL_COLUMNS` pattern.
7. **`appointments` gains `facility_id` and `tb_case_id`**, both nullable. This is the BASE-02 fix. Backfill runs only for patients whose referrals name exactly one facility; the ambiguous remainder stays NULL under an explicitly stated legacy policy with a defined exit criterion.
8. **No second scheduler.** `treatment_followups` has no date that can drive a reminder.
9. **`cancelled` is added to `appointments.status`** so closing a case can stop its future reminders. Contract change, listed surface by surface.
10. **The Patient Care Timeline is a query, not an event table.**

### What Codex should inspect first

- **§4 of 1.2** — the composite FK against `referrals (referral_id, patient_id, facility_id)` blocks a BHW re-routing a `submitted` referral once a case cites it. I argue this is unreachable in practice and correct when reached. Please confirm or reject.
- **§3 of 1.3** — the legacy `facility_id is null` arm keeps part of BASE-02 open by design, with a stated exit criterion. This is the weakest point of the design and I want it challenged.
- **§3.1 of 1.3** — the claim that an old mobile build cannot erase `facility_id`/`tb_case_id`, because PostgREST derives `ON CONFLICT DO UPDATE SET` from payload keys and `toServerPayload()` sends only local columns. I have read the code path but **not executed it**; it is stated as a test requirement, not as a verified fact.
- **§8.2 of 1.2** — BASE-01 must be fixed before the case RPCs ship. Confirm the ordering.
- The five open questions at the end of each document.

### Known limitations, stated plainly

- The **outcome vocabulary is unconfirmed** (WHO/NTP standard set, proposed not verified). It needs the TB-DOTS head nurse, as 0024/0025 did. Same for `weight_kg` on follow-ups.
- **Facility transfer** is designed but deferred to Priority B; until then it is an admin support action.
- The **legacy appointment hole** (§3 of 1.3) narrows but does not close on Day 2.
- The remaining NULL `facility_id` count is **unknown** until the migration runs against the live database.
- No live database, RLS, migration-replay or device check was performed. This is a design document.

**Commit hash:** not yet committed at time of writing.

---

### Blocked on

Codex Task 1.4. Per architecture rule 18 and the Task 1.4 gate, Claude does not write migration 0028 until Critical/High design issues raised in that review are resolved.

**Recommended next work unit regardless of the gate:** BASE-01. It is a live fail-open authorization gate in `barangay_report` / `admin_overview`, it is independent of the case design, and no part of Task 1.4 needs to resolve before it can be fixed. Awaiting the user's go-ahead to take it as its own migration and work unit.

---

## 2026-09-09 — Tasks 1.2 and 1.3, revision 2 (post-gate)

**Task completed:** revision of both design documents in response to the Task 1.4 gate (NOT APPROVED; 7 HIGH, 2 MEDIUM, 0 CRITICAL).

**Files changed:** `CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md` (revision 2), `CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md` (revision 2), `DECISIONS.md` (withdrawal table + 12 new decisions), `MASTER_PLAN.md`, this file.

**Migrations created:** none. **Application code changed:** none. **Tests run:** none — still a design deliverable, so the 373-test baseline is untouched.

### Disposition of every finding

| Finding | Disposition |
| --- | --- |
| ARCH-01 | **Accepted.** The composite FK to `referrals` is withdrawn — it pinned case facility to referral facility for life, so no transfer could execute. Referral is now creation-time-validated immutable provenance; a trigger blocks re-routing a cited referral. Appointment ownership FKs take reviewed `ON UPDATE CASCADE`, so a transfer is one statement with no ordering problem. The transfer RPC now ships in 0028 alongside the global uniqueness index. |
| ARCH-02 | **Accepted.** Full admission predicate written out: active TB-DOTS profile, `facilities.type = 'tb_dots'`, referral must agree on patient and facility and be past `submitted`; referral-free creation restricted to `own_enrolled_patient_ids()`. All failures return one uniform 42501 so patient existence is not disclosed. |
| ARCH-03 | **Accepted.** Direct UPDATE policy and grant withdrawn entirely. `tb_cases` is SELECT-only for clients; three RPCs are the whole write surface; the RPC and the trigger share one transition table. |
| ARCH-04 | **Accepted.** `revoke update (facility_id, referral_id, tb_case_id) from authenticated, anon` — a column privilege, independent of RLS. Insert-time `with check` per role; later assignment via three audited RPCs. This removes the move-back-to-NULL revival as a class. |
| ARCH-05 | **Accepted.** The "only the status union" claim is withdrawn; it contradicted the same document. Full mobile surface listed file by file. Confirmed while checking: `mobile/app/referral/[screeningId].tsx:89-97` already holds both the facility id and the referral id at the moment it inserts the appointment, so this is plumbing, not new logic. |
| ARCH-06 | **Accepted.** The shared-visibility arm is withdrawn. `sole_referral_facility()` yields one facility or none, so no unowned row is ever visible to two facilities and the claim race cannot occur; ambiguous rows go to an admin-only queue. The window is bounded by a follow-up migration that rejects NULL inserts with 42501 (PERMANENT under `syncErrors.ts`). `facility_id NOT NULL` is no longer promised for Day 2. |
| ARCH-07 | **Accepted.** `rpc_requests` redesigned: primary key `(operation, request_id)`, actor and facility binding, payload fingerprint, typed result reference, authorized replay that returns 42501 rather than the stored result on any mismatch, 7-day purge, no client grant. |
| ARCH-08 | **Accepted.** Temporal bounds on `visit_date`; a linked follow-up requires `status = 'attended'` and `attended_date = visit_date`; `voided_at/by/reason` with an audit event replaces "amend the note"; `record_visit()` makes the visit workflow atomic. |
| ARCH-09 | **Accepted, including that my no-gap claim was false.** Sequence design withdrawn. `facilities.short_code` (seeded from 0009, immutable) plus a transactional `case_number_counters` row, which genuinely does roll back. Also recorded: `next_facility_patient_code()` has the same gap behaviour — harmless there, but not a pattern to copy. |

Gate decisions 1–7 are all incorporated; decision 6's boundary is now written explicitly as `scheduled_date >= manila_today()`.

### What is still unproven, stated plainly

- **The old-client upsert claim was not executed.** I reasoned it from the PostgREST payload-key behaviour and `toServerPayload()`; I have not run it. It is now written as a mandatory test against the real stack, and if it fails the compatibility window becomes mandatory rather than convenient. Please treat it as unverified.
- **Outcome vocabulary** is now sourced (WHO 2013 reporting framework, adopted by the DOH NTP MOP) rather than a bare guess, but I have not read the specific MOP edition and did not consult a primary source. Local confirmation is still a hard blocker; without it, 0028 ships with no `outcome` column and no reachable `closed` state.
- The **remaining NULL `facility_id` count** is unknown until the migration runs against the live database.
- **Facility short-code seed list** does not exist yet; I will propose one from 0009 for confirmation rather than invent codes.
- No live database, RLS, migration-replay or device check was performed.

### Items for the focused re-review

- 1.2 §4 — referral provenance now rests on a creation-time check plus a re-route trigger rather than a constraint. Is the trigger narrow enough, and is "status past `submitted`" the right admission test?
- 1.2 §7.1 item 4 — referral-free creation is restricted to walk-ins this facility registered. A genuine external transfer-in has no path. Deliberate, and narrow; confirm that is the right first cut.
- 1.3 §2.1 — two `ON UPDATE CASCADE` FKs on one table. I believe they cannot fight (a cited referral cannot be re-routed), but that reasoning deserves a second pass.
- 1.3 §3.2 — ambiguous legacy appointments become invisible to facility staff until an admin resolves them. Stricter than before and it has a real cost; I judged it acceptable partly because the live database holds only test data today.

**Blocked on:** Codex re-review. Migration 0028 will not be written until it passes and the outcome vocabulary is confirmed.

**Commit hash:** not yet committed.

---

## 2026-09-09 - Migration 0028 (BASE-01), plus revision 3 of the designs

**Task completed:** BASE-01 implemented as its own migration and work unit, per the second gate's decision. Both design documents revised to revision 3 for R2-01..R2-08. Facility short codes proposed as separate reviewable data.

### Files created

| File | What it is |
| --- | --- |
| `supabase/migrations/0028_null_safe_role_gates.sql` | The repair |
| `supabase/tests/0028_role_gate_matrix.sql` | Denial matrix over real database roles. First file of an executable SQL suite; the baseline audit recorded that none existed |
| `scripts/verify-0028-bodies.mjs` | Proves the six restated function bodies are verbatim apart from their guards |
| `docs/agent/CLAUDE_FACILITY_SHORT_CODES_PROPOSAL.md` | The eleven TB-DOTS mappings, plus the corrected nullable/type-aware constraint |

**Files changed:** both design documents (revision 3), `DECISIONS.md`, `MASTER_PLAN.md`, this file.

### What 0028 does

- Adds `public.current_user_active_role()`, which returns NULL for all three denial cases at once: anonymous, authenticated with no `public.users` row, and deactivated.
- Re-gates six client-callable SECURITY DEFINER functions null-safely and active-aware: `barangay_report`, `admin_overview`, `bhw_activity`, `dashboard_counts`, `hotspot_counts`, `next_facility_patient_code`.
- Restates every function ACL explicitly, following 0019's finding that Supabase's default privileges grant EXECUTE to `anon` **by name**, so `revoke from public` alone leaves it standing. `admin_overview` carried exactly that grant.

Two of the six were genuinely failing open (`barangay_report`'s `not in (...)`, `admin_overview`'s `<> 'admin'`). The other four already used `is distinct from` or an `ELSE` branch and were null-safe; they are touched only to become active-aware and to get explicit ACLs. Every gate now raises `42501`, so PostgREST returns 403 and `syncErrors.ts` classifies it PERMANENT.

### Verification actually performed

| Check | Result |
| --- | --- |
| `node scripts/verify-0028-bodies.mjs` | **OK on all six.** The six bodies differ from their sources only in the guard |
| Mutation test of that script (scratch copy, one token flipped in a restated body) | **Correctly FAILed** and pinpointed the character. The check is not vacuous |
| web `npm.cmd test` | 14 files, 129 passed |
| mobile `npm.cmd test` | 11 files, 197 passed |
| edge `npm.cmd test` | 3 files, 47 passed |
| Total | 373 passed, 0 failed - unchanged, as expected: 0028 is SQL and no application code moved |

### Verification NOT performed, and why

**The denial matrix has not been run.** There is no local Postgres on this machine: no Docker, so no `supabase start`; no `psql`; no `supabase/config.toml`. The migrations here are hand-applied through the SQL editor. So `supabase/tests/0028_role_gate_matrix.sql` is written to be runnable and self-rolling-back, but **I have not executed it and cannot claim the gates behave as designed** - only that the SQL says what it should say. It needs to be run in the SQL editor before 0028 is applied. It is also the first executable SQL test in this repository, so the harness itself is unproven.

The script does not commit. One caveat is in its header: `next_facility_patient_code()` calls `nextval()`, and sequences are non-transactional, so running it burns a few `PAT-DOTS-####` values that rollback will not return. Harmless - the codes are cosmetic and the function loops past collisions.

### Deliberately out of scope for 0028

- **BASE-04** (barangay_report compares `timestamptz` to `date`, so it reads the session timezone instead of Manila). Its function body is restated here unchanged. Reporting arithmetic does not belong inside an authorization fix, and bundling it would have made the diff unreviewable. Own migration, own boundary tests.
- **RLS policies still call `current_user_role()`, which is not active-aware.** So a deactivated user holding an unexpired JWT can still read rows through the policies until the token expires. 0028 closes the RPC surface only. This is a real residual gap, it is written into the migration as POST-CHECK 5 with a query that demonstrates it, and it needs its own unit - roughly 20 policies and a full role regression pass, or a shorter JWT lifetime.

### Revision 3 disposition

| Finding | Disposition |
| --- | --- |
| R2-01 | **Accepted; my claim was simply wrong.** A column REVOKE does not subtract from a table-level grant. Replaced with 0017's pattern plus `enforce_appointment_ownership()`, which passes an unchanged re-send (the mobile retry) and rejects any reassignment. Authorized RPCs signal intent with a `SET LOCAL` GUC that PostgREST gives clients no way to set. I also state plainly that for this table the privilege layer is near-vacuous and the trigger is the real boundary. |
| R2-02 | **Accepted.** My "the cascades cannot fight" reasoning only considered a referral re-route. Link exclusivity (`num_nonnulls(referral_id, tb_case_id) <= 1`) means `facility_id` never has two live parents; `assign_appointment_to_case()` swaps rather than adds. |
| R2-03 | **Accepted.** `audit_logs`, its trigger, RLS and event contract move into 0029. No RPC is enabled before its audit dependency exists. |
| R2-04 | **Accepted.** `set_tb_case_status()` takes the treatment start date; `update_tb_case_details()` loses it. Invariants are now symmetric over every state, so no correction path can leave a wrong shape. |
| R2-05 | **Accepted, withdrawn entirely.** The admin queue would have handed a named patient's referral history to a role deliberately denied clinical rows. Ambiguous rows are visible to no client; support resolves them from a direct session before production, while the data is still synthetic. |
| R2-06 | **Accepted.** The uuid-returning helper is replaced by a boolean that only ever compares against the caller's own facility, and uses `current_user_active_role()`. The backfill is computed inline, so the helper exists only for policy evaluation. Direct-RPC denial is in the ACL matrix. |
| R2-07 | **Accepted.** Void now means "the clinical record is invalid", never a rewrite of attendance, which keeps its own existing undo. A partial unique index frees the slot so a replacement can be recorded. Linked date correction is an atomic RPC over both rows. |
| R2-08 | **Accepted.** Nullable, unique-where-present, required by a `type = 'tb_dots'` CHECK added only after population and verification. Eleven mappings proposed as data. |

### What needs a human

1. **Run `supabase/tests/0028_role_gate_matrix.sql`** in the SQL editor and confirm every row reads PASS, before applying 0028.
2. **Treatment-outcome vocabulary** - still the hard blocker on 0029.
3. **Short codes** - confirm whether the CHO or TB-DOTS staff already abbreviate these eleven facilities; if they do, theirs win. Soft blocker.
4. Confirm the live `facilities` table holds exactly the eleven `tb_dots` rows in the proposal before 0029 adds the CHECK.

**Blocked on:** Codex review of 0028 as its own work unit, then re-review of revision 3. Migration 0029 is not written.

**Commit hash:** not yet committed.

---

## 2026-09-09 - 0028 verification package corrected, designs at revision 4

**Task completed:** M28-01/02/03 corrected on migration 0028 and its artifacts; both design documents revised to revision 4 for R3-01..R3-06; BASE-06 accepted and recorded.

**Files created:** `scripts/build-0028-preflight.mjs`, `supabase/tests/0028_preflight.generated.sql` (generated).
**Files changed:** `supabase/migrations/0028_null_safe_role_gates.sql`, `supabase/tests/0028_role_gate_matrix.sql`, `scripts/verify-0028-bodies.mjs`, both design documents, the short-code proposal, `DECISIONS.md`, `MASTER_PLAN.md`, this file.

**Migrations created:** none new. **Application code changed:** none.

### The verification package

| Finding | What was wrong | What it is now |
| --- | --- | --- |
| M28-01 | The ACL post-check inner-joined `pg_roles`. PUBLIC is grantee OID 0 with no `pg_roles` row, so the query could never display a surviving PUBLIC grant - the single thing it existed to catch. It also expected service_role grants to have vanished without revoking them. | LEFT JOIN rendering grantee 0 as `PUBLIC`; service_role explicitly revoked from all seven, so the expectation is uniform: one `authenticated` row per function, nothing else but the owner. |
| M28-02 | The body verifier cut each body from its start through the last guard, silently excluding pre-existing DECLARE blocks - including `dashboard_counts()`'s `d_today`/`d_start`/`d_next`. It proved the query tail matched and printed OK regardless of what happened above it. | Balanced-scan removal of guard spans only, plus the one new `v_role` declaration. Every pre-existing declaration is now compared, and the self-test mutates a declaration token (`d_next`) as well as a query token, so the blind spot cannot silently reopen. |
| M28-03 | The matrix opened a transaction it never closed, called definitions that only exist after 0028, and 0028 committed itself - so it could not run "before application" as documented, and could leave test accounts behind if the editor session committed. | 0028 opens no transaction; the applier owns it. `scripts/build-0028-preflight.mjs` generates `begin; <0028> <matrix> rollback;` as one batch, and refuses to build if either input contains its own transaction control. The matrix now asserts `auth.uid()` took effect, asserts the EXACT return of `current_user_active_role()` per persona, and ends by raising on any FAIL - which also guarantees the rollback. |

### Verification actually performed

| Check | Result |
| --- | --- |
| `node scripts/verify-0028-bodies.mjs` | OK on all six, self-test passes |
| Verifier self-test: mutated query token, mutated declaration token | Both caught |
| `node scripts/build-0028-preflight.mjs` | Generated; one `begin;` at line 21, one `rollback;` at the end |
| Generator guard, negative test (appended `commit;` to a scratch copy of 0028) | Correctly refused to build |
| `git diff --check` | Clean |
| Test suites | Not re-run this round - no application code moved since the last full pass (373/373) |

### Still not performed

**The database matrix has not been run.** No Docker, no `psql`, no `config.toml` on this machine. Everything above verifies the *artifacts*; none of it verifies the *gates*. Migration 0028 must not be applied until either the generated preflight or a disposable branch reports every row PASS. That remains the one outstanding item on this work unit, and I cannot close it from here.

### Revision 4 disposition

| Finding | Disposition |
| --- | --- |
| R3-01 | **Accepted; the exemption was wrong and would have broken a live workflow.** A cascade from a BHW's referral re-route is an ordinary `authenticated` UPDATE with no GUC set, so my trigger would have rejected it. The trigger now authorizes by what the row ENDS UP saying - facility must equal the unchanged parent link's facility - so cascades authorize themselves and the GUC covers only link swaps, legacy claims and transfers. Each path is now a separate required test. |
| R3-02 | **Accepted.** I corrected this exact construct on `appointments` under R2-01 and left it standing on `treatment_followups` one section later. Table revoke, then grant only `notes`/`weight_kg`; visit date and void fields RPC-only, asserted with `has_column_privilege` rather than by reading the statement. |
| R3-03 | **Accepted.** `type = 'tb_dots' and short_code ~ ...` is NULL when the code is NULL, and PostgreSQL accepts an unknown CHECK - the constraint permitted exactly the row it forbade. `short_code is not null` added, with a six-case test table. |
| R3-04 | **Accepted.** Every new or replaced policy and helper uses `current_user_active_role()` from its first version. |
| R3-05 | **Accepted.** `own_facility_case_ids()` moves to `app_private` (not exposed by PostgREST) and becomes active-role-aware. I also recorded that four existing helpers in `public` share the defect - pre-existing surface, so they move with BASE-06's pass rather than expanding 0029. |
| R3-06 | **Accepted.** Stale "admin queue" wording removed from s3.4 and struck in the revision-2 changelog. |
| BASE-06 | **Accepted as release-blocking.** This revision proposed placing it before the then-numbered case migration; the final Codex gate made that order mandatory, assigned BASE-06 migration 0029, and moved case work to 0030. |

### A pattern worth naming

Three of this round's findings (R3-02, R3-05, and the M28-02 blind spot) are cases where I fixed something correctly in one place and left the identical defect standing a few sections away. The corrections are in, but the useful takeaway for 0029 is that a fix should be applied by searching for the construct, not by editing the spot the reviewer pointed at.

**Blocked on:** the 0028 database matrix, then Codex's re-review. BASE-06 is the recommended next implementation unit, ahead of 0029.

**Commit hash:** not yet committed.

---

## 2026-09-09 - Gate passed; checkpoint committed; disclosure hold before push

**Codex's final gate:** 0028 preflight 73/73 PASS against the live database, then rolled back. Revision 4 architecture approved. M28-01..03 and R3-01..06 closed. BASE-06 becomes migration 0029; case/follow-up work becomes 0030.

**What I did this round:** no design or migration changes - the gate closed everything. Housekeeping and a checkpoint commit:

- `supabase/tests/*.generated.sql` added to `.gitignore`. The preflight is derived from the migration and the matrix; tracking it would let a stale copy drift from what it verifies, which is the one failure mode the generator exists to prevent. Rebuild with `node scripts/build-0028-preflight.mjs`.
- Corrected the two forward-looking "Still blocking 0029" lines in DECISIONS.md to 0030. Historical entries keep their original numbering - they were accurate when written, and rewriting them would falsify the record Codex reviewed.
- Re-ran the verifier and the generator; `git diff --check` clean; secret scan over everything staged found no credential, only prose about password gates.

### Disclosure hold - PUSH IS DELIBERATELY NOT DONE

`git remote -v` is `github.com/nielarcenal/tb-screen-system`, and `gh repo view` reports **PUBLIC**. The commit is local, on a branch, and has NOT been pushed.

The reason is specific. Migration 0028 is approved but **not applied** - Codex's preflight reached its ROLLBACK by design. So the live deployment still has BASE-01's fail-open gate, and BASE-06 is unpatched with no migration written. What is now staged includes:

- `CODEX_REVIEW.md`, which describes both defects precisely enough to reproduce them, including the `NULL not in (...)` mechanism and the named `grant execute ... to anon` on `admin_overview`;
- `0028_null_safe_role_gates.sql`, whose header is a clear write-up of the same;
- `docs/agent/ISSUES.md`, which lists BASE-01..06 by severity.

Pushing that to a public repository publishes a working description of two unpatched authorization defects on a live Supabase project, with the project URL discoverable from the repo. The system holds only test data today, which lowers the harm but does not change what is being published.

This is a sequencing problem, not a reason to withhold the work. The order that resolves it:

1. Apply 0028 to the live project (its preflight has passed; the file is approved).
2. Ship BASE-06 as 0029 and apply it.
3. Then push. At that point the documents describe defects that are fixed, which is ordinary and useful engineering history.

If the push is needed sooner, the alternative is to push code and hold `docs/agent/` back until step 2 - but the migration header alone still describes BASE-01, so the honest version of that option is "apply 0028 first, then push".

**Next unit:** BASE-06 as migration 0029, following 0028's pattern - active-aware policies across the ~20 that call `current_user_role()`, a real-role RLS matrix, and a mobile/web regression pass. The four enumerating helpers in `public` (`referred_patient_ids`, `referred_screening_ids`, `bhw_visible_patient_ids`, `own_enrolled_patient_ids`) should move to `app_private` in the same unit, per R3-05.

**Remaining human inputs:** local facility abbreviations, and the treatment-outcome vocabulary. Old-client PostgREST upsert behaviour remains a required 0030 test - still unexecuted.

---

## 2026-09-09 - BASE-06 implemented as migration 0029

**Task:** the next unit after the final gate. Deactivated accounts kept RLS row access until JWT expiry; 0028 hardened only the RPC gates.

**Files created:** `supabase/migrations/0029_active_aware_rls.sql`, `supabase/tests/0029_rls_row_matrix.sql`, `scripts/verify-0029-policies.mjs`, `scripts/build-preflight.mjs`.
**Files changed:** `scripts/verify-0028-bodies.mjs` (CRLF), `supabase/migrations/0028_null_safe_role_gates.sql` and `supabase/tests/0028_role_gate_matrix.sql` (one comment line each, for the renamed generator), `DECISIONS.md`, `ISSUES.md`, `MASTER_PLAN.md`.
**Removed:** `scripts/build-0028-preflight.mjs`, superseded by the parameterised generator.

### What 0029 does

- 28 clinical policies rewritten onto `current_user_active_role()`.
- The four enumerating helpers move to `app_private`, a schema PostgREST does not expose, each with its own active-role check. In `public` they were RPCs that handed any authenticated caller a facility's whole patient id list without passing a single policy — R3-05 applied to the pre-existing helpers, not just the new one.
- `current_user_facility()` / `current_user_barangay()` made active-aware; every use is an equality comparison, so NULL fails closed.
- `current_user_role()` kept but delegating, so a future policy written with the old name is still safe.

### The finding that shaped the design

I nearly closed the `users` self-read along with everything else. Both clients detect deactivation by reading their own row (`web/src/App.tsx:143`, `mobile/src/lib/accountGate.ts`), and RLS filters rather than raising — so a hidden row returns `data: null, error: null`, which `mobile/src/domain/accountAccess.ts` maps to `{ kind: 'unknown' }`, described in its own comment as blocking nothing and revoking nothing. Hiding the row would have made the mobile ban **weaker**, and would have stopped the persistent refusal (the A54 force-stop bypass) from ever being recorded.

So the self-read stays ungated and everything else about a deactivated account is closed. The carve-out is pinned by a test, with the reasoning in the migration header, so a future "tighten this" commit fails loudly instead of quietly regressing the ban.

### Verification performed

| Check | Result |
| --- | --- |
| `node scripts/verify-0029-policies.mjs` | 26 policies match their source apart from the helper rename; 2 declared exceptions (`users_read_same_facility`, `users_update_self`) that gain a predicate rather than swapping one |
| Its self-test: swapped role literal, dropped predicate | Both caught |
| `node scripts/verify-0028-bodies.mjs` | Still all six OK after the generator rename |
| CRLF independence | Proven against an all-CRLF copy of the migration set |
| Preflight generation, both 0028 and 0029 | Generated; one `begin;`, one `rollback;` each |
| web / mobile / edge suites | 129 + 197 + 47 = 373 passed, unchanged (SQL-only change) |

### Not performed

**The 0029 row matrix has not been run** — still no local Postgres here. It needs the same treatment 0028 got: run `supabase/tests/0029_preflight.generated.sql` in the SQL editor, confirm every row PASS, then apply. **0029 requires 0028 to be applied first**; its own guard raises otherwise.

One reasoning-only correction worth flagging for review: the matrix originally read temp tables while the role was switched to `authenticated`, which would have failed on privileges rather than policy — and a privilege error inside an EXCEPTION block reads exactly like a successful denial, so the matrix would have gone green for the wrong reason. Every block now resolves its ids before switching. I could not execute this, so it is reasoned, not proven.

### Behaviour change support should know

A BHW deactivated mid-shift can no longer push queued offline writes; before 0029 they still synced. Nothing is lost — `signOutFlow` counts pending rows after its final sync and refuses to wipe the cache while any remain, telling them how many could not be uploaded. Reactivating releases the queue.

**Next:** run both preflights, apply 0028 then 0029, then 0030 (case/follow-up). The outcome vocabulary and local facility abbreviations are still the outstanding human inputs.

---

## 2026-09-09 - BASE-04 implemented as migration 0030

**Pushed first**, as agreed: the disclosure hold is lifted now that 0028 and 0029 are applied live, so the documents describe fixed defects. `feature/capstone-upgrade` is on origin with three commits.

**Files created:** `supabase/migrations/0030_barangay_report_manila_boundaries.sql`, `supabase/tests/0030_report_boundary.sql`, `scripts/verify-0030-report-body.mjs`.

### What 0030 does

`barangay_report()` compared `timestamptz` columns to bare `date` parameters, so PostgreSQL cast the date using the session timezone. On a UTC session the reporting day began at 08:00 Manila and every screening or referral created between midnight and 08:00 was filed under the previous day — and at a year boundary, the previous year. The four predicates now use `manila_day_start()` half-open ranges.

The `mis` CTE is deliberately untouched: `scheduled_date` is a plain `date`, a date-to-date comparison has no timezone, and wrapping it would introduce a bug rather than fix one. The verifier asserts it stayed put.

### The second half of BASE-04

0027's header claimed "a patient screened in December and tested in January lands in DIFFERENT periods for screened_count and tested_count". That is not what the SQL does — `tested_count` filters on `referrals.created_at`, so that referral counts in **December**, the same period as its screening. The comment described the opposite of the behaviour.

Corrected in the function comment: screened/referred are **event** counts; presented/tested/positive are a **cohort** — referrals created in the period, counted by the status they have reached by report time, not tests performed in the period.

The basis is documented, **not changed**. Recounting by `result_date` would be different numbers on a report the health office reads, which is their decision and its own unit.

### Verification performed

| Check | Result |
| --- | --- |
| `node scripts/verify-0030-report-body.mjs` | OK — body matches 0028's apart from the date bounds; all four bounds go through `manila_day_start()`; the `mis` comparison is unchanged |
| Its self-test: reporting-query edit, removed Manila bound | Both caught |
| 0028 and 0029 verifiers | Still pass |
| Preflight generation | `0030_preflight.generated.sql`, one `begin;`, one `rollback;` |

### Two fixture defects I caught in my own test before shipping it

Both are the classes Codex found in the 0029 matrix, so I went looking for them deliberately:

1. **Isolation.** The fixture first picked the alphabetically-first barangay, which may already hold live patients. `barangay_report` aggregates by barangay and cannot be filtered to fixture rows the way 0029's matrix filters by id, so live rows would have been counted into every expected number. It now selects a barangay with no existing patients, and raises if none exists.
2. **Shadowing.** The loop variable `tz` shadowed `t_result.tz`. Safe as written — `INSERT ... VALUES` puts no target columns in scope — but that is the exact shape that produced the `where n = 2` defect, so it is renamed `v_tz` rather than left for a reader to reason about.

### Not performed

**The boundary test has not been run** — no local Postgres here. Run `supabase/tests/0030_preflight.generated.sql`, confirm every row PASS, then apply. It needs 0018 and 0028 applied, and guards on both.

**Next:** case/follow-up work is now **0031**, still gated on the treatment-outcome vocabulary. BASE-05 (sync cursor ties) is the other open HIGH and is explicitly its own unit.

---

## 2026-09-09 - BASE-05 implemented (client-side)

**Files created:** `mobile/src/domain/pullCursor.ts`, `mobile/src/domain/pullCursor.test.ts`.
**Files changed:** `mobile/src/sync/syncEngine.ts` (`pullTable` and its five call sites), `mobile/src/db/database.ts` (local migration v11).

**No server migration.** BASE-05 is entirely a client bug, so 0031 stays free for case work.

### The defect, precisely

Two facts combined into permanent loss. `pullTable` set no limit of its own, so a server-capped reply was indistinguishable from a complete one; and `updated_at` is not unique, so one bulk write stamps many rows alike. When more rows shared the boundary timestamp than fit in a response, the device took what it got, moved the cursor to that timestamp, and asked for `> timestamp` forever after. The remainder were not delayed — they were unreachable, while the device reported a clean sync.

### The fix

A keyset cursor over `(updated_at, id)`, stored in the existing TEXT column as `<iso>` or `<iso>|<id>` — no schema change, and an old build's value still parses. The request now carries our own `limit`, which is what makes truncation observable at all: a full page means "there may be more", so the cursor keeps the last row's id and the next request drains the rest of that timestamp group by key.

The rule lives in `domain/pullCursor.ts`, which imports nothing — the same split as `domain/accountAccess.ts` / `lib/accountGate.ts`. That is not tidiness: the failure requires "more tied rows than fit in one response", which no device test can reliably manufacture, and a pure module can reproduce exactly.

**Local migration v11** appends a `|*` sentinel to every non-epoch cursor so the first pull after upgrading re-reads its boundary group and recovers what the old build skipped. Without it the new rule would still start strictly after that timestamp and the already-lost rows would stay lost. It is idempotent and leaves the epoch alone.

### Verification performed

| Check | Result |
| --- | --- |
| `mobile` suite | 12 files, **215 passed** (was 197; 18 new) |
| `npx tsc --noEmit` | clean |
| Regression test: 12 rows sharing one timestamp, page size 5 | all 12 delivered |
| The same fixture under the OLD rule | 5 delivered, then nothing — the defect, pinned so it cannot silently return |
| Group split across a page edge | all rows delivered |
| Interrupted mid-group, resumed from the persisted cursor | all rows delivered, none duplicated in the set |
| Second pull from a finished cursor | fetches nothing |
| Healing a stranded cursor | recovers all 12 where the unhealed cursor recovers 0 |
| Small delta | exactly one request, as before |

Per `mobile/AGENTS.md` I checked the Expo SDK 57 docs before writing: `execAsync` / `runAsync` / `getFirstAsync` and the `PRAGMA user_version` migration pattern are unchanged, and this change adds no new Expo API surface.

### The one thing I could not verify

A drain filters `eq('updated_at', <the timestamp PostgREST just returned>)`, which assumes the value round-trips exactly. PostgreSQL keeps microseconds and PostgREST emits full precision, so it should — but if it ever did not, the drain would match nothing, the group would be treated as finished, and the tied rows would be skipped: **BASE-05 in a new costume**. It is named in the `pullTable` header with the way to check it: pull a table holding more rows at one `updated_at` than `PULL_PAGE_SIZE` and assert the device ends with all of them.

Device-level offline integration (real connectivity loss mid-pull, account switch, cache purge) is also still unexercised — unit tests do not establish device correctness, as the baseline audit says.

**Next:** case/follow-up work is migration 0031, still gated on the treatment-outcome vocabulary. With BASE-05 done, BASE-02 and BASE-03 are the only open HIGHs and both land with that work.

---

## 2026-09-09 - Migration 0031 written and verified (NOT applied)

**Files created:** `supabase/migrations/0031_case_registry_and_followups.sql`,
`supabase/tests/0031_case_registry_matrix.sql`,
`scripts/verify-0031-policies.mjs`, `scripts/old-client-upsert-check.mjs`.
**Files changed:** none outside `supabase/` and `scripts/` - no application code was touched.

Tasks 1.2 and 1.3 at Revision 4, in one migration, as the designs require: the case
registry, the follow-up record, appointment ownership (BASE-02), `audit_logs`,
`rpc_requests`, the facility short codes, ten write RPCs and the transactional case-number
counter.

### The headline result

`supabase/tests/0031_preflight.generated.sql` ran against the live database and returned
**119/119 PASS**, then reached its explicit `rollback`. Nothing was applied: `tb_cases`,
`treatment_followups`, `audit_logs` and `rpc_requests` do not exist, `facilities` has no
`short_code`, and no `rpc-requests-purge` cron job is scheduled. Confirmed by query after
the run.

This machine has no local Postgres, but `npx supabase db query --file` does honour explicit
transaction control - probed first with a throwaway `begin; create table ...; rollback;`
that reported `rolled_back = true`. That is what made a real pre-apply run possible instead
of a reasoned one.

### Verification performed

| Check | Result |
| --- | --- |
| `supabase/tests/0031_preflight.generated.sql`, live | **119/119 PASS**, rolled back |
| `node scripts/verify-0031-policies.mjs` | 13 OK; all 4 self-tests caught their mutation |
| `node scripts/verify-0028-bodies.mjs` / `0029-policies` / `0030-report-body` | still pass |
| `node scripts/old-client-upsert-check.mjs` | stage 1 PASS as a real BHW; **stage 2 blocked on 0031 being applied** |

The matrix covers the short-code CHECK's six three-valued-logic cases, the create_tb_case
ACL grid and its admission predicate, the global one-active-case index and the transfer
that is its only remedy, idempotency bound to actor/facility/payload, the lifecycle through
both the RPC and the trigger, every path of the appointment ownership trigger separately,
the referral cascade, effective column privileges, the temporal invariants, void and
replacement, the closing sweep's `manila_today()` boundary, the audit whitelist, and the
helper surface.

### Three defects my own test found before Codex could

1. **The design's backfill does not run.** Task 1.3 §3.1 uses `min(facility_id)`;
   PostgreSQL has no `min()` for `uuid`. Replaced with `(array_agg(distinct facility_id))[1]`,
   which is not a choice - the `HAVING` clause already guarantees one distinct value.
2. **A vacuous denial check.** "A BHW cannot re-route a referral a case cites" passed as a
   BHW *for the wrong reason*: once a case cites a referral the referral is `received`, and
   `referrals_bhw_update` limits a BHW to `submitted` rows, so the statement matched zero
   rows and raised nothing. It now runs from a direct session - the strongest writer, which
   no policy filters - with an uncited referral as the positive control.
3. **A fixture with no room in it.** The follow-up date correction failed against a case
   registered on the day the test runs, because `visit_date >= registration_date` left
   exactly one legal date. That read like a broken RPC and was a broken fixture; the
   fixture case is now registered 30 days back.

The first is a real design defect and is worth carrying into the review. The other two are
the same class as the ones Codex found in the 0029 matrix.

### Seven deviations from the approved design, each stated in the migration header

`D1` `correct_tb_case_dates()` drops `p_registration_date`, because §4 pins
`registration_date` immutable and the 0020 trigger reads the *caller's* `auth.role()` even
inside a SECURITY DEFINER RPC - so the parameter could only ever raise. `D2` the ownership
trigger exempts a direct session and `service_role`, as 0020 does, because §3.2 makes a
direct session the remedy for ambiguous legacy rows. `D3` cancelling a case sweeps its
future appointments the way closing one does. `D4` `rpc_requests` gains `record_visit` /
`treatment_followup`, which §7.3's vocabulary predates. `D5` no `weight_kg`. `D6`
`record_visit()` refuses to both book a next visit and end the episode. `D7` the
referral-free admission arm is facility-scoped rather than caller-scoped, matching the
sentence §7.1 rule 4 actually writes, and narrowed to TB-DOTS enrolment so a BHW's barangay
patient does not become admissible by sharing a `facility_id`.

### The mandatory gate: what is closed and what is not

`scripts/old-client-upsert-check.mjs` exists and runs. Signed in as the real
`bhw.arcenal@tbscreen.ph` account, against the real PostgREST stack, it upserted a row while
omitting a column from the payload and **the omitted column survived** - PostgREST does
build `ON CONFLICT DO UPDATE SET` from payload keys.

That is the mechanism, and it is now executed rather than read. It is **not yet the gate**:
the gate asks the question about `facility_id`, `referral_id` and `tb_case_id`, which do not
exist until 0031 is applied. The script detects them and runs stage 2 automatically. Run it
again immediately after applying.

The first version of that script passed stage 1 while proving nothing - it picked its
fixture patient as `service_role`, the BHW's write was refused by RLS, and "the column
survived" was true because no write had happened. It now picks the patient as the caller.

### Not done, and why it is sequenced rather than skipped

The client half of the contract change - `cancelled` in the web and mobile status unions,
`facility_id`/`referral_id` on the mobile appointment row and the referral screen, the
portal's schedule-check-up insert, the three locale files, and the SMS destination moving to
`appointment.facility_id` - is **not in this commit**. It cannot ship first: PostgREST
rejects an unknown column with a 400, so a portal that sends `facility_id` breaks the moment
it deploys against a database without it. `web/` deploys on push to `main`.

So the order is: review 0031 -> apply 0031 -> run the upsert check's stage 2 -> then the
client unit. Nothing about it is blocked on a decision; it is blocked on the migration
being live.

**Next:** Codex reviews migration 0031 and its matrix. If it is approved, apply it, re-run
`node scripts/old-client-upsert-check.mjs`, and take the client contract change as the
following unit.

---

## 2026-09-09 - Migration 0031, review round 1 (M31-02 … M31-07)

**Codex result on `8c9d4ce`: CHANGES REQUIRED.** Five defects plus one credential slip.
All six are fixed; the live rollback preflight now returns **139/139 PASS**.

**Files changed:** `supabase/migrations/0031_case_registry_and_followups.sql`,
`supabase/tests/0031_case_registry_matrix.sql`, `scripts/verify-0031-policies.mjs`,
`scripts/old-client-upsert-check.mjs`. Still no application code.

### What was wrong, and it is worth naming the pattern

Three of the five are the same mistake in different clothes: **a rule enforced on one side
of a pair.**

- **M31-02 (HIGH)** — `appointments_referral_facility_agrees` and
  `appointments_case_facility_agrees` named the link and the facility but not the patient.
  A constraint called "agrees" enforced half of what it claimed: PostgreSQL accepted an
  appointment for patient A citing patient B's referral or case, as long as the facility
  matched. Both parent keys and both FKs now carry `patient_id`, and
  `assign_appointment_to_case()` compares patients before the constraint would.
  Cascades are unaffected — `patient_id` is immutable on both parents, so a cascade still
  only ever moves `facility_id`.
- **M31-04 (HIGH)** — §8.1's trigger enforced `visit_date <= outcome_date` when the
  FOLLOW-UP moved, and nothing re-checked when the CASE moved. A case could therefore be
  closed with an outcome dated before a visit it had already recorded. `set_tb_case_status()`
  now refuses that, scoped to non-voided rows; `correct_tb_case_dates()` already did.
- **M31-06 (MEDIUM)** — the upsert gate's `tb_case_id survives` assertion ran against a
  referral-linked fixture, so it compared null to null. It could not have failed. There are
  now two fixtures, one of each shape, and a column that was already null is reported as
  VACUOUS rather than as a pass.

The other two are about promising more than the code delivers:

- **M31-03 (HIGH)** — I replaced `patient_id in referred_patient_ids()` with
  `facility_id = current_user_facility()` in `appointments_tbdots_insert`. That is a
  *widening*, inside the migration whose entire purpose is to narrow appointment access: a
  facility could schedule any patient uuid it could name by writing its own id into the
  row. Codex's live probe demonstrated it. The three legal shapes now each prove the patient
  belongs: referral-linked, case-linked, or 0011's original boundary for unlinked rows.
- **M31-05 (MEDIUM)** — `record_visit(p_new_case_status)` advertised five transitions and
  could perform two. It passed NULL treatment/outcome fields through, so an initial
  `on_treatment` and every `closed` failed on a missing date, while `cancelled` succeeded
  and left a clinical follow-up attached to an episode declared opened in error. It now
  carries `p_treatment_start_date`, `p_outcome` and `p_outcome_date` — because starting and
  completing treatment at a visit are exactly the moments §4.4 calls one act — and refuses
  `cancelled` outright.

**M31-07** — I committed the BHW test account's password as the script's default fallback.
Codex removed it and amended the unpushed commit. The script now requires
`TBSCREEN_TEST_PASSWORD` from the environment or `.env`. Nothing reachable ever held it.

### A fixture trap the fix exposed

Pass 7's positive control re-routed `ref_bo` to facility A and left it there. `ref_bo`
belongs to pat_b, and the review's new Pass 12 asserts DOTS A *cannot* schedule pat_b
because pat_b is referred only to DOTS B. Once M31-03 restored the admission predicate, that
leftover would have made the check pass for the wrong reason. Pass 7 now puts the referral
back, with a comment saying why. A fixture mutation that outlives the check it serves is a
trap for whoever writes the next pass.

### Verification performed

| Check | Result |
| --- | --- |
| `supabase/tests/0031_preflight.generated.sql`, live | **139/139 PASS**, rolled back |
| Rollback confirmed by query | no `tb_cases`, no ownership columns, 1100 appointments, 0 fixture rows |
| `node scripts/verify-0031-policies.mjs` | 20 OK; **6** self-tests caught their mutation |
| `verify-0028-bodies` / `0029-policies` / `0030-report-body` | still pass |
| `node scripts/old-client-upsert-check.mjs` | stage 1 PASS; **gate still NOT CLOSED** |

The verifier gained the two rules that were lost: the TB-DOTS insert policy must keep
`referred_patient_ids()`, and all four ownership keys must name `patient_id`. Both have
mutation self-tests, so losing them again fails loudly.

Pass 13 adds 16 checks: patient agreement through the RPC, every transition `record_visit()`
now advertises and three it refuses, proof that a refused call writes nothing at all, and
closing against a live follow-up — denied, denied again through the date-correction RPC,
then allowed once the follow-up is voided, which is what makes the rule scoped rather than
blanket.

### Still not closed

Stage 2 of the upsert gate has **never executed**, including its new case-linked fixture:
the columns it asks about do not exist until 0031 is applied. The script now records a
skipped fixture as a FAILURE and prints `GATE: NOT CLOSED`, so a run that could not ask the
question cannot exit 0 and read as if it had.

**Next:** Codex re-reviews. Then apply 0031, run
`TBSCREEN_TEST_PASSWORD=... node scripts/old-client-upsert-check.mjs` and confirm
`GATE: CLOSED`, and only then start the client contract unit.
