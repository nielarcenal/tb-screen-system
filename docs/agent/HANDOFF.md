# Session handoff — 2026-09-10 (updated: attention dashboard and analytics)

## 2026-09-10 continuation checkpoint

All BASE findings and the appointment compatibility gate are closed. Migration 0032's
atomic `register_walkin()` passed its 18/18 live rollback preflight and is live. The
authenticated old-client run then found a legacy whole-row UPDATE privilege mismatch;
migration 0033 fixed it while pinning `appointment_id`, `patient_id`, and `created_at`
as immutable. Its live rollback preflight passed 13/13 and it was applied atomically.
A disposable authenticated BHW subsequently passed the old-client harness 9/9 with
`GATE: CLOSED`; cleanup removed both its public profile and Auth user.

The client appointment contract is implemented across web, mobile, and SMS: explicit
facility/referral ownership, referral-scoped portal reads, a reversible `cancelled`
state, mobile SQLite v12/sync persistence, six locale updates, and legacy-only SMS
facility fallback. Tasks 2.2–2.5 are now complete: eligible referrals can be enrolled
manually through the idempotent case RPC, and the portal exposes a facility-scoped case
list/detail with lifecycle filters, factual attention markers, visit/appointment history,
and audited status/outcome actions. Full regression is **416/416** (web 147, mobile
218, edge 51), with production build and all TypeScript checks passing. The next
critical-path unit is treatment visit recording and follow-up correction/void behavior.
Vite still reports the existing large-chunk advisory.

Day 3 is also complete. The portal records a visit through `record_visit()` with a
stable request ID, including attendance, optional status change, and optional next
appointment in one transaction. Corrections use the approved date/void RPCs and retain
history; note-only corrections use the narrow column grant. Migration 0034 is approved
and applied after an independent **26/26** live rollback preflight. It derives overdue
appointments using the Manila calendar but does not assert a patient no-show or trigger
the SMS pipeline. Full regression is **425/425** (web 156, mobile 218, edge 51). Next:
review the timeline contract and implement the timeline UI.

Day 4 is now complete too. Migration 0035's referral audit trail passed its whitelist
self-tests and **20/20** live rollback matrix; migration 0036's source-isolated timeline
passed **16/16**. Both are applied. The portal timeline is active-TB-DOTS-only, keeps
source authorization independent after transfers, omits free text/contact/result values
and voided follow-ups, distinguishes overdue from missed, and shows historical states
without fabricating dates. Full regression is **430/430** (web 161, mobile 218, edge 51),
with production build and all typechecks passing. Next: attention dashboard and metrics.

Day 5 is complete. Migration 0037's final live rollback matrix passed **9/9** and the
migration is applied. `facility_dashboard_overview()` returns only aggregate counts to
active staff at the owning TB-DOTS facility: six factual attention categories, eight
program totals, and today's activity in one request. Attention cards open predicate-matched
case/referral filters. Overdue remains derived, missed remains staff-recorded, a later
scheduled/attended visit resolves the active missed queue, and stale is an explicit 31-day
case/30-day live-visit rule. No risk score or patient data is returned. Full regression is
**439/439** (web 170, mobile 218, edge 51), with production build and all typechecks
passing. Next: Day 6 audit viewer/access, appointment audit coverage, SMS/security review.

For whoever picks this up next: a new Claude session, Codex, or Niel.
Branch `feature/capstone-upgrade`, pushed to origin. Baseline was `4659d65` on `main`.

Read this first, then [MASTER_PLAN.md](MASTER_PLAN.md) for task ownership and [ISSUES.md](ISSUES.md) for the live issue register. [CLAUDE_STATUS.md](CLAUDE_STATUS.md) is the chronological log — detail lives there, not here.

---

## 1. Where things stand in one table

| Item | State | What is left |
| --- | --- | --- |
| **BASE-01** fail-open reporting gates | **Fixed, applied live** (migration 0028) | Nothing |
| **BASE-06** deactivated accounts keep row access | **Fixed, applied live** (migration 0029) | Nothing |
| **BASE-04** report reads session timezone | **Fixed, applied live** (migration 0030) | Nothing |
| **BASE-05** sync cursor loses tied rows | **Fixed and approved**, client-side | Ships with the next mobile build |
| **BASE-02** appointments patient-wide | **Fixed, approved, and applied live** (migration 0031) | Nothing |
| **BASE-03** walk-in partial writes | **Fixed, approved, and applied live** (migration 0032) | Ships with the portal client checkpoint |
| **Case / follow-up model** (Tasks 1.2 / 1.3) | **Approved and applied** as migration 0031; strengthened live preflight **140/140 PASS** | Nothing |
| **Case registry UI** (Tasks 2.2–2.5) | **Implemented and approved**; portal **147/147**, build/typecheck pass | Ship with the portal client checkpoint |
| **Treatment visit UI** (Tasks 3.1–3.3/3.5) | **Implemented and approved**; atomic visit/retry and retained-history corrections | Ship with the portal client checkpoint |
| **Overdue detection** (Task 3.4) | **Approved and applied** as migration 0034; live rollback matrix **26/26 PASS** | Consume in attention dashboard/timeline |
| **Referral audit trail** (Task 6.2 foundation) | **Approved and applied** as migration 0035; verifier clean, live matrix **20/20 PASS** | Appointment PATCH auditing remains C41-02 |
| **Patient timeline** (Tasks 4.1–4.4) | **Implemented and approved** as migration 0036 + portal UI; live matrix **16/16** | Ship with portal checkpoint |
| **Attention dashboard / metrics** (Tasks 5.1–5.5) | **Implemented and approved** as migration 0037 + portal UI; live matrix **9/9** | Ship with portal checkpoint |
| **Legacy appointment compatibility** | **Fixed and applied** (migration 0033); preflight **13/13**, authenticated harness **9/9** | Nothing |
| **Client contract change** (`cancelled`, ownership columns, SMS destination) | **Implemented and focused checks passing** | Ship with the next web/mobile/function deployment |

Server migrations 0028 through 0037 are applied.

Commits on the branch, oldest first:

```
398f480  Repair the fail-open reporting gates, and design the case registry
290572b  Revoke row access when an account is deactivated
2c3c1d3  Verify and approve active-aware RLS migration     (Codex)
d64037e  Bound the barangay report to Manila days, not the session timezone
028cca1  Stop the sync cursor losing rows tied at the boundary
acb3b17  Add a session handoff
2b07ee3  Approve BASE-05 and unblock case migration          (Codex)
288602c  Give TB cases, follow-ups and appointments an owner  (0031, amended by Codex to scrub a credential)
09c36bd  Make the appointment links agree about the patient, not just the facility
d430657  Make walk-in registration atomic and retry-safe
```

The feature branch contains migrations 0028 through 0037, their verification artifacts,
the atomic walk-in path, the appointment/case/follow-up clients, and the patient timeline.

The only untracked file is `docs/TB-Screen_Barangay_Report_Design_Canvas_Brief.md`, which predates this work and was deliberately left alone.

---

## 2. Gate result and next unit

Implement Day 6 next: the audit viewer and access checks, close C41-02 appointment PATCH
coverage without double-logging RPC paths, review the SMS boundary, and run the security
pass. Keep Priority B deferred; Day 7 regression/device/demo remains protected.

Migration 0031 is reviewed and applied. Its final live rollback preflight passed
**140/140**. The post-apply check confirms `tb_cases`, `treatment_followups`, `audit_logs`,
`rpc_requests`, all eleven short codes, and the active purge cron job.

**The authenticated old-client gate is closed.**

The first disposable authenticated run exposed missing UPDATE privileges for the two
legacy whole-row payload columns `appointment_id` and `created_at`. Migration 0033 grants
that compatibility while an immutable trigger rejects actual identifier, patient, or
creation-time changes. Its live rollback matrix passed 13/13, the migration is live, and
the rerun passed 9/9 with `GATE: CLOSED`. The temporary public/Auth BHW was deleted and no
standing account password was changed or stored.

---

## 3. Completed client contract

- Web appointments are loaded by `referral_id`; scheduling persists `facility_id` and
  `referral_id`; `cancelled` is inactive and reversible without recording attendance.
- Mobile SQLite v12, repository insert/pull, shared types, referral scheduling, chips, and
  English/Tagalog/Cebuano strings preserve the same ownership and status contract.
- SMS uses `appointment.facility_id`. Only a legacy NULL owner falls back to the newest
  referral, so a later referral cannot redirect an owned appointment.
- Focused web, mobile, and edge tests pin those behaviors.

## 4. The verification harness — use it, do not reinvent it

Server migrations 0028 through 0033 shipped with the same two-part discipline.

**Transcription verifiers.** Where a fix required restating existing SQL, a script proves only the intended thing changed. Each self-tests by mutating its own input.

```bash
node scripts/verify-0028-bodies.mjs        # six function bodies vs their sources
node scripts/verify-0029-policies.mjs      # 28 RLS policies, 2 declared exceptions
node scripts/verify-0030-report-body.mjs   # barangay_report vs 0028's version
node scripts/verify-0031-policies.mjs      # 2 transcribed policies + R3-04/R3-05 + M31-02/M31-03
```

**Transactional preflights.** A database test cannot verify a migration "before application" unless both run in one transaction. The generator assembles them and refuses to build if either file carries its own transaction control:

```bash
node scripts/build-preflight.mjs <NNNN>
```

The generated file is gitignored on purpose — regenerate it, never edit it, or it drifts from the migration it is meant to be verifying.

**Superseded 2026-09-09 - this machine CAN run database tests.** There is still no Docker,
`psql` or `config.toml`, but `npx supabase db query --file <preflight> --linked
--project-ref momiqgnhylqijyadldhg` runs a whole file through the Management API and honours
its own `begin;` / `rollback;`. 0031's matrix was executed, and doing so found three defects
that reading it would not have. A preflight is not an application because it always rolls
back. Use `scripts/build-migration-apply.mjs` for an explicit transactional apply batch,
then run a read-only post-check.

---

## 5. What is still unproven

Carry these forward; they are not closed.

- **Device-level offline integration** — real mid-pull connectivity loss, account switch, cache purge. Unit tests do not establish device correctness.
- **Everything 0031 asserts, against a POPULATED table.** Its matrix builds its own world of known size and rolls it back. The backfill moved the live rows during the preflight and reported none left unowned, but that is only true of the data as it stood; re-read the NOTICE when it is applied for real.
- **`facility_id NOT NULL` on appointments.** Deliberately not set (Task 1.3 3.4). Its acceptance test is `select count(*) from appointments where facility_id is null` returning 0, once unsupported clients are retired.

---

## 6. Things that cost a review round, worth knowing up front

Four gates ran on the case design before it was approved. The findings that generalise:

- **A column `REVOKE` does not subtract from a table-level grant.** Migration 0017 has the working pattern: revoke on the whole table, then grant back column by column. I got this wrong twice, in two different files.
- **`NULL` in a CHECK is accepted.** `(type = 'tb_dots' and code ~ '…')` is NULL when the code is NULL, and Postgres accepts an unknown CHECK — so the constraint permitted exactly the row it forbade. Spell out `is not null`.
- **PUBLIC is grantee OID 0** and has no `pg_roles` row, so an inner join in an ACL check silently hides it.
- **Supabase default privileges grant EXECUTE to `anon` and `service_role` by name**, so `revoke … from public` leaves them standing. Name them.
- **Fix a construct by searching for it, not by editing the spot the reviewer pointed at.** Three separate findings were the same defect left standing a few sections away.
- **In a SQL test, a privilege error inside an `EXCEPTION` block looks exactly like a successful denial.** Resolve ids before switching roles, and give every denial check a positive control, or the matrix goes green for the wrong reason.
- **Don't let a plpgsql variable shadow a column name** (`where n = 2` resolved to the variable, not `t_brgy.n`). It happened again in 0031's matrix, in a block copied from the fix.
- **A denial check can pass because the statement matched zero rows.** "A BHW cannot re-route a cited referral" went green while proving nothing: the referral was `received`, `referrals_bhw_update` only reaches `submitted` rows, so the UPDATE touched nothing and raised nothing. Ask the question from a writer that *could* have succeeded, and pair it with a case that does.
- **A fixture with no legal alternative value is not a passing test, it is an unfalsifiable one.** A case registered on the day the test runs leaves exactly one valid `visit_date`, so the date-correction RPC could only fail. That reads like a broken function.
- **PostgreSQL has no `min()` for `uuid`.** The approved design's backfill used one. Reading SQL is not running it — which is the whole argument for §2's preflight.
- **A composite FK enforces only the columns it names.** `(referral_id, facility_id)` reads as "this appointment agrees with its referral" and actually means "same facility", which two different patients both satisfy. Name every column whose agreement the constraint's name is claiming.
- **A migration that narrows access can widen it in passing.** Replacing a policy means diffing it against what it replaced, not just reading the new text and finding it reasonable — 0031's appointment insert policy dropped the patient-scope predicate that had been there since 0011.
- **Don't advertise a parameter you cannot honour.** `record_visit(p_new_case_status)` accepted five statuses and could perform two; the other three either failed on a missing date or succeeded into an incoherent state.
- **An assertion that compares null to null is not a passing test.** Say VACUOUS, and make a fixture that could not be built fail the run.
- **Never commit a credential as a default value.** It was in an unpushed commit and still cost a finding and an amend.

---

## 7. Decisions that constrain future work

Full register in [DECISIONS.md](DECISIONS.md). The ones most likely to be re-litigated:

- **An account may always read its own `users` row, even deactivated.** Both clients detect deactivation by reading it, and RLS filters rather than raising — so hiding it reads as "no account" and, on mobile, stops the denial being recorded at all. Tightening this makes the ban *weaker*. Pinned by a test.
- **Enumerating helpers belong in `app_private`**, which PostgREST does not expose. In `public` they are RPCs that hand out other people's row ids with no policy in the way.
- **Mutation is RPC-only for case data**, and appointment ownership is authorized by the row agreeing with its parent, not by the caller's apparent privilege — a cascade is an ordinary `authenticated` UPDATE and carries no special role.
- **The barangay report's referral columns are a cohort, not events**: referrals *created* in the period, counted by the status they have since reached. Recounting by `result_date` would move published numbers and is the health office's decision.
- **No AI diagnosis, no scoring, no automatic case creation.** A positive result prompts the UI; it never creates a case.

---

## 8. Repo facts worth not rediscovering

- The GitHub repo is **public**. Two commits were held back until 0028 and 0029 were applied, because the docs describe the defects precisely enough to reproduce them. Same judgement applies to any future unapplied security fix.
- `docs/agent/` is the shared coordination directory; Codex reads and writes it.
- `mobile/AGENTS.md` requires checking the versioned Expo docs (SDK 57) before writing mobile code.
- `.gitignore` is deliberately curated — it keeps credentials, the CHO source documents and session notes out of a public repo. Do not `git add -A` from the repo root without reading it.
- Test suites: web 129, mobile 215, edge 47 — 391 total, all passing at `028cca1`.
