# Session handoff — 2026-09-09

For whoever picks this up next: a new Claude session, Codex, or Niel.
Branch `feature/capstone-upgrade`, pushed to origin. Baseline was `4659d65` on `main`.

Read this first, then [MASTER_PLAN.md](MASTER_PLAN.md) for task ownership and [ISSUES.md](ISSUES.md) for the live issue register. [CLAUDE_STATUS.md](CLAUDE_STATUS.md) is the chronological log — detail lives there, not here.

---

## 1. Where things stand in one table

| Item | State | What is left |
| --- | --- | --- |
| **BASE-01** fail-open reporting gates | **Fixed, applied live** (migration 0028) | Nothing |
| **BASE-06** deactivated accounts keep row access | **Fixed, applied live** (migration 0029) | Nothing |
| **BASE-04** report reads session timezone | **Written and verified, NOT applied** (migration 0030) | Run its preflight, then apply |
| **BASE-05** sync cursor loses tied rows | **Fixed in the branch, client-side** | Ships with the next mobile build |
| **BASE-02** appointments patient-wide | Design approved | Lands with case work (0031) |
| **BASE-03** walk-in partial writes | Design approved | Lands with case work (0031) |
| **Case / follow-up model** (Tasks 1.2 / 1.3) | Design **APPROVED** at Revision 4 | Blocked on one clinical input — see §3 |

Server migration numbering: 0028 and 0029 are applied; **0030 is written but unapplied**; case work is **0031**.

Commits on the branch, oldest first:

```
398f480  Repair the fail-open reporting gates, and design the case registry
290572b  Revoke row access when an account is deactivated
2c3c1d3  Verify and approve active-aware RLS migration     (Codex)
d64037e  Bound the barangay report to Manila days, not the session timezone
028cca1  Stop the sync cursor losing rows tied at the boundary
```

The only untracked file is `docs/TB-Screen_Barangay_Report_Design_Canvas_Brief.md`, which predates this work and was deliberately left alone.

---

## 2. Do these two things first

**a. Apply migration 0030.** It is verified but unapplied, so the live barangay report still miscounts at day, month and year boundaries.

```bash
node scripts/build-preflight.mjs 0030
# paste supabase/tests/0030_preflight.generated.sql into the SQL editor
# every row must read PASS; it always rolls back
# then apply supabase/migrations/0030_... inside begin; … commit;
```

The preflight needs a barangay with no existing patients and will raise if none exists.

**b. Verify the one BASE-05 assumption.** `pullTable` drains a timestamp group with `eq('updated_at', <the value PostgREST just returned>)`, which assumes exact round-trip. It should hold — Postgres keeps microseconds, PostgREST emits full precision — but if it ever did not, the drain would match nothing, the group would look finished, and the tied rows would be skipped. That is BASE-05 in a new costume.

The check: pull a table holding more rows at a single `updated_at` than `PULL_PAGE_SIZE` (500) and assert the device ends with all of them.

---

## 3. The blocker on 0031, and it is not engineering

Case work cannot be written until the **treatment-outcome vocabulary** is confirmed with the TB-DOTS head nurse — the same route used for migrations 0024 and 0025 on 2026-09-06.

Proposed: `cured`, `treatment_completed`, `treatment_failed`, `died`, `lost_to_follow_up`, `not_evaluated` — the WHO 2013 reporting framework the DOH NTP MOP adopts. **This is a documented standard, not a verified local requirement**; nobody in this work has read the MOP edition the facility uses.

If it does not arrive, the agreed fallback is to ship 0031 **without** an `outcome` column, leaving `closed` unreachable until a later migration adds the confirmed values. A case registry that cannot yet close is honest; one that closes into invented categories is not.

Two soft inputs, neither blocking:

- **Facility short codes** — eleven proposed in [CLAUDE_FACILITY_SHORT_CODES_PROPOSAL.md](CLAUDE_FACILITY_SHORT_CODES_PROPOSAL.md). If the CHO already abbreviates these facilities, theirs win.
- **`weight_kg`** on follow-ups — omit from 0031 if unconfirmed; nothing structural depends on it.

---

## 4. The verification harness — use it, do not reinvent it

Three server migrations shipped with the same two-part discipline, and Codex expects it.

**Transcription verifiers.** Where a fix required restating existing SQL, a script proves only the intended thing changed. Each self-tests by mutating its own input.

```bash
node scripts/verify-0028-bodies.mjs        # six function bodies vs their sources
node scripts/verify-0029-policies.mjs      # 28 RLS policies, 2 declared exceptions
node scripts/verify-0030-report-body.mjs   # barangay_report vs 0028's version
```

**Transactional preflights.** A database test cannot verify a migration "before application" unless both run in one transaction. The generator assembles them and refuses to build if either file carries its own transaction control:

```bash
node scripts/build-preflight.mjs <NNNN>
```

The generated file is gitignored on purpose — regenerate it, never edit it, or it drifts from the migration it is meant to be verifying.

**This machine cannot run database tests.** No Docker, no `psql`, no `config.toml`; migrations are hand-applied through the SQL editor. Every SQL test written here was reasoned, not executed. Say so plainly rather than implying otherwise.

---

## 5. What is still unproven

Carry these forward; they are not closed.

- **Old-client PostgREST upsert.** 0031 assumes an old mobile build's whole-row upsert cannot erase `facility_id` / `tb_case_id`, because PostgREST builds `ON CONFLICT DO UPDATE SET` from payload keys. Read from the code, never executed. It is a required 0031 test.
- **The BASE-05 round-trip assumption** (§2b).
- **Device-level offline integration** — real mid-pull connectivity loss, account switch, cache purge. Unit tests do not establish device correctness.
- **0030's boundary test** until it is run.

---

## 6. Things that cost a review round, worth knowing up front

Four gates ran on the case design before it was approved. The findings that generalise:

- **A column `REVOKE` does not subtract from a table-level grant.** Migration 0017 has the working pattern: revoke on the whole table, then grant back column by column. I got this wrong twice, in two different files.
- **`NULL` in a CHECK is accepted.** `(type = 'tb_dots' and code ~ '…')` is NULL when the code is NULL, and Postgres accepts an unknown CHECK — so the constraint permitted exactly the row it forbade. Spell out `is not null`.
- **PUBLIC is grantee OID 0** and has no `pg_roles` row, so an inner join in an ACL check silently hides it.
- **Supabase default privileges grant EXECUTE to `anon` and `service_role` by name**, so `revoke … from public` leaves them standing. Name them.
- **Fix a construct by searching for it, not by editing the spot the reviewer pointed at.** Three separate findings were the same defect left standing a few sections away.
- **In a SQL test, a privilege error inside an `EXCEPTION` block looks exactly like a successful denial.** Resolve ids before switching roles, and give every denial check a positive control, or the matrix goes green for the wrong reason.
- **Don't let a plpgsql variable shadow a column name** (`where n = 2` resolved to the variable, not `t_brgy.n`).

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
