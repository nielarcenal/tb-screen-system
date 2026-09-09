# Session handoff — 2026-09-09 (updated: migration 0031 written)

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
| **BASE-02** appointments patient-wide | **Implemented in 0031, NOT applied** | Review, then apply |
| **BASE-03** walk-in partial writes | Design approved; `rpc_requests` ships in 0031 | The atomic registration RPC is its own unit |
| **Case / follow-up model** (Tasks 1.2 / 1.3) | **Written as migration 0031**; one review round done (M31-02…M31-07, all fixed); live preflight **139/139 PASS**, rolled back; **NOT applied** | Codex re-review, then apply — see §2 |
| **Client contract change** (`cancelled`, ownership columns, SMS destination) | Not started | Sequenced AFTER 0031 is applied — see §3 |

Server migration numbering: 0028, 0029 and 0030 are applied; **0031 is written and verified but unapplied**.

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
ce2aabe  Make the appointment links agree about the patient, not just the facility
```

The last three are NOT pushed. Same judgement as 0028 and 0029: the repository is public
and these documents describe an unapplied authorization fix precisely enough to reproduce
the gap. Push after 0031 is applied.

The only untracked file is `docs/TB-Screen_Barangay_Report_Design_Canvas_Brief.md`, which predates this work and was deliberately left alone.

---

## 2. Do these things first, in this order

**a. Review migration 0031.** `supabase/migrations/0031_case_registry_and_followups.sql`
plus `supabase/tests/0031_case_registry_matrix.sql`. Its header lists seven deliberate
deviations from the approved design (D1-D7), each with the reason it exists; those are the
parts most worth a second opinion. One review round is already done - M31-02 through M31-07,
all fixed - and `CLAUDE_STATUS.md` has the account of what was wrong and why.

**b. Re-run its preflight, then apply it.**

```bash
node scripts/build-preflight.mjs 0031
npx supabase db query --file supabase/tests/0031_preflight.generated.sql --linked --project-ref momiqgnhylqijyadldhg
```

Every row must read PASS. It returned **139/139** on 2026-09-09 after the first review
round and reached its explicit `rollback`; the rollback was then confirmed by querying for
the tables it would have created.

**This machine CAN run database tests after all.** The old note saying it could not is
wrong. `npx supabase db query --file` honours explicit `begin;` / `rollback;` - probed with
a throwaway `begin; create table ...; rollback;` that reported `rolled_back = true`. A
preflight is therefore safe to run against the live project, and 0031's matrix is the first
on this branch that was executed rather than reasoned about before review.

**c. Immediately after applying, close the old-client gate.**

```bash
TBSCREEN_TEST_PASSWORD='...' node scripts/old-client-upsert-check.mjs
```

The password has no default and never will: one was committed once as a fallback (M31-07)
and had to be scrubbed from an unpushed commit. Supply it from the environment or the
gitignored `.env`.

Stage 1 already passes: signed in as the real `bhw.arcenal@tbscreen.ph`, an upsert payload
that omitted a column left that column untouched - so PostgREST does build
`ON CONFLICT DO UPDATE SET` from payload keys. Stage 2 asks the same question about
`facility_id`, `referral_id` and `tb_case_id`, over TWO fixtures - one referral-linked, one
case-linked - and can only run once those columns exist. The script detects them and runs it
automatically.

**Read the last line of its output, not the check count.** It prints `GATE: CLOSED` only
when an old-client payload has preserved a NON-NULL `tb_case_id`; anything else prints
`GATE: NOT CLOSED` and exits non-zero. The first version of that assertion ran against a
referral-linked row where the column is null by construction, so it compared null to null
and could not have failed.

If stage 2 ever fails for real, the compatibility window of Task 1.3 3.4 stops being a
convenience and becomes mandatory *before* anything relies on ownership.

---

## 3. The client half, and why it is not in this commit

`cancelled` in the web and mobile status unions, `facility_id` / `referral_id` on the mobile
appointment row and the referral screen, the portal's schedule-check-up insert, the three
locale files, and the SMS destination moving from "latest referral" to
`appointment.facility_id` - none of it is done, and none of it may go first.

PostgREST rejects an unknown column with a 400, so a portal that sends `facility_id` breaks
the moment it deploys against a database that does not have the column. `web/` deploys on
push to `main`. The order is: apply 0031, then ship the client unit.

Nothing in it is blocked on a decision. The complete file-by-file surface is Task 1.3 3.3
and 5.

## 4. The verification harness — use it, do not reinvent it

Three server migrations shipped with the same two-part discipline, and Codex expects it.

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
that reading it would not have. DDL is still applied by the user in the SQL editor; a
preflight is not an application, because it always rolls back - verify afterwards that it
did.

---

## 5. What is still unproven

Carry these forward; they are not closed.

- **Old-client PostgREST upsert, second half.** The mechanism is now executed rather than assumed: an omitted column survives an upsert against the real stack, as a real signed-in account. The same question about the three ownership columns needs 0031 applied - `node scripts/old-client-upsert-check.mjs`, stage 2.
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
