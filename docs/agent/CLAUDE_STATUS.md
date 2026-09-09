# Claude status log

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
