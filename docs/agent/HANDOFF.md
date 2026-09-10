# Session handoff — 2026-09-10, end of Day 6 / start of Day 7

Read this first, then [MASTER_PLAN.md](MASTER_PLAN.md) for task ownership,
[DAY7_RELEASE_VERIFICATION.md](DAY7_RELEASE_VERIFICATION.md) for the release gate, and
[ISSUES.md](ISSUES.md) for the live issue register. [CLAUDE_STATUS.md](CLAUDE_STATUS.md)
and [CODEX_REVIEW.md](CODEX_REVIEW.md) are the chronological logs — detail lives there.

For whoever picks this up: a new Claude session, Codex, or Niel.
Branch `feature/capstone-upgrade`. The Day 7 release candidate and the follow-up Expo
SDK 57 dependency alignment described below are separate, verified units.

---

## 1. Is it safe to move or rename the project folder?

**Yes for the work itself. Nothing is at risk of being lost.** Every commit is pushed to
origin, and uncommitted files move with the folder. Four things will need attention after
a move, none of them data loss:

| What | Why | Fix |
| --- | --- | --- |
| `node_modules` in `web/`, `mobile/`, `supabase/functions/` | Metro and some native/CLI packages record absolute paths | `npm ci` in each, or at minimum `npx expo start -c` for mobile |
| Claude Code's memory for this project | The memory directory is keyed by the **path** (`C--Documents-VSCodeProjects-TB-Screen-System`). A new path is a new, empty project memory | Copy the old `memory/` directory across, or expect to re-establish it |
| `.env` files | Untracked by design, so they are not in git — they travel with the folder but not with a fresh clone | Verify `web/.env`, `mobile/.env` after the move |
| `supabase/.temp/linked-project.json` | Moves fine; the linked-project ref is not path-dependent | Re-verify with a read-only query if in doubt |

The Supabase project, the applied migrations, and the Vercel deployment are all remote and
completely unaffected by anything you do to this folder.

### What is uncommitted right now, and whether it matters

```
?? docs/TB-Screen_Barangay_Report_Design_Canvas_Brief.md
```

- **The Expo SDK 57 alignment is now committed as its own maintenance unit.** It contains
  patch bumps across the Expo/React Native dependency set plus the `expo-font` config
  plugin. It was reverified on 2026-09-10: `expo-doctor` **21/21**, mobile tests
  **218/218**, and `tsc --noEmit` clean.
- **The design brief is the user's own file** and is deliberately untracked. Do not stage,
  edit, delete, or fold it into any unit. Every handoff in this branch has said so.

---

## 2. Where things stand

**Days 1–6 are complete and approved. Migrations 0028 through 0038 are applied live.**
Day 7 has passed the capstone/demo release gate. On 2026-09-10, the user confirmed that
the physical Android offline/reconnect/cache-isolation run passed and that native-speaker
review approved the Tagalog/Cebuano copy.

| Day | Unit | State |
| --- | --- | --- |
| 1 | Architecture, case/follow-up design | Approved |
| 2 | TB case registry | Approved |
| 3 | Treatment visits, missed follow-up detection (0034) | Approved and applied |
| 4 | Patient timeline (0036) | Approved and applied |
| 5 | Attention dashboard (0037) | Approved and applied |
| 6 | Audit trail (0035, 0038), audit viewer, SMS wording, security review | **Approved and applied** |
| 7 | Regression, docs, demo dataset | Conditional release candidate |

Regression at `afd6f6c`: **450/450** — portal 181, mobile 218, edge 51. Production build
and all three typechecks pass, with the pre-existing large-chunk advisory.

Recent commits, newest first:

```
afd6f6c  Prepare Day 7 release candidate                  (Codex)
c614417  Approve and apply Day 6 audit trail              (Codex)
eb0cddb  Audit the appointment writes that nothing was watching
a62fa03  Hand off the Day 6 audit and security unit       (Codex)
becaede  Add the facility attention dashboard             (Codex)
```

---

## 3. What Day 6 changed, and what Codex changed in review

0038 closed **C41-02**: appointment writes from the ordinary client PATCH produced no
audit row at all — only the five 0031 RPC paths did, and neither client uses those. An
`AFTER INSERT OR UPDATE` trigger is now the single writer, and the six explicit RPC calls
were **removed**, which meant restating 471 lines of applied plpgsql under
`scripts/verify-0038-bodies.mjs`.

The skip-flag alternative was rejected: it needs the same restatement in order to set the
flag, and fails **silently** when a future RPC forgets it.

Codex's review then strengthened the matrix from 35 to **36/36**, closed a BHW navigation
gap, a cursor gap and a stale-response gap in the viewer, approved the migration and
applied it atomically. The stale-response fix is visible in `AuditLog.tsx` as a
`requestId` ref — a slow response for a previous filter could otherwise land under the
newly selected chip.

**Do not re-litigate these two:**

- The action vocabulary for appointments stays 0031's (`created` / `cancelled` /
  `updated`). `status_changed` is used for referrals but deliberately **not** for
  appointments, because 0031 already wrote `updated` for an appointment reaching
  `attended` and those rows are live.
- `facility_audit_events()` is `SECURITY INVOKER` on purpose. The facility boundary is
  `audit_logs`' own RLS, so the function cannot widen it even if its predicates were
  wrong. A definer reader restating `facility_id = current_user_facility()` is one
  careless edit from M31-03.

---

## 4. Final human release checks — closed

Both checks were completed outside this workstation and confirmed by the user on
2026-09-10:

1. **Physical Android offline/reconnect/cache-isolation smoke test — PASSED.** The full
   seven-step checklist in `DAY7_RELEASE_VERIFICATION.md` was exercised successfully.
2. **Native-speaker review of the Tagalog and Cebuano copy — PASSED.** The reviewer found
   the localized user-facing copy acceptable.

---

## 5. Open findings carried into production planning

None are Critical or High. Full text in `DAY7_RELEASE_VERIFICATION.md` and `ISSUES.md`.

| ID | Severity | Short form |
| --- | --- | --- |
| S7-01 | MEDIUM | Device SQLite and the persisted session are sandboxed but not app-encrypted. Needs managed-device controls or an encrypted cache design |
| D6-01 | MEDIUM | `audit_logs` now takes a row per appointment write and nothing prunes it. **Retention is a health-office decision**, not an engineering default — do not add a purge cron on the `rpc_requests` reflex |
| C50-01 | MEDIUM | Some destination lists are unpaginated. Fine at capstone volume, not for rollout |
| S7-02 | LOW | Legacy broad table grants to `anon`/`authenticated`. RLS covers it; narrowing needs its own migration and a full role matrix |
| D6-02 | LOW | `facility_audit_events()` returns `patient_id`, which the viewer does not render |

---

## 6. The harness — use it, do not reinvent it

**This machine can run database tests**, despite having no Docker, `psql` or `config.toml`:

```bash
npx supabase db query --file <file> --linked --project-ref momiqgnhylqijyadldhg
```

It honours the file's own `begin;` / `rollback;`, so a generated preflight really rolls
back. **A preflight is not an application** — it always rolls back, and applying is still
a separate, reviewed step.

```bash
node scripts/build-preflight.mjs <NNNN>     # migration + matrix in one rolled-back txn
node scripts/verify-0028-bodies.mjs         # six function bodies vs their sources
node scripts/verify-0029-policies.mjs       # 28 RLS policies, 2 declared exceptions
node scripts/verify-0030-report-body.mjs    # barangay_report vs 0028's version
node scripts/verify-0031-policies.mjs       # transcribed policies + review findings
node scripts/verify-0035-whitelist.mjs      # the audit whitelist, fail-closed
node scripts/verify-0038-bodies.mjs         # the five restated RPCs, six deletions only
```

Generated preflights are gitignored on purpose — regenerate, never edit, or they drift
from the migration they are meant to be verifying. **Always re-query after a preflight**
to confirm the objects it would have created are absent.

---

## 7. Lessons this branch paid for

The ones most likely to bite the next person:

- **A CHECK or a CASE that evaluates to NULL is accepted.** The audit whitelist's CASE had
  no ELSE, so an unlisted `entity_table` left `allowed` NULL and the guard accepted *every*
  key — masked only by a constraint evaluated *after* the BEFORE trigger (C35-01).
- **`occurred_at` is transaction-stable.** `now()` does not advance inside a transaction, so
  every audit row one RPC writes shares a timestamp. Nothing may sequence audit rows by
  that column alone (C35-03).
- **`reset role` does not clear `request.jwt.claims`.** It is a transaction-local GUC that
  outlives the role change, so a block meant to model an unauthenticated session silently
  tests an authenticated one (C35-02). **Other matrices in `supabase/tests/` have not been
  audited for this pattern.**
- **A column REVOKE does not subtract from a table-level grant.** Revoke on the table, then
  grant back column by column (0017's pattern).
- **Supabase's default privileges grant EXECUTE to `anon` and `service_role` by name**, so
  `revoke … from public` leaves both standing. Name all three.
- **A denial check can pass because the statement matched zero rows.** Give every denial a
  positive control, or the matrix goes green for the wrong reason.
- **Reading SQL is not running it.** Every migration in this branch that was only read had
  a defect that only running it found — including `min()` on a `uuid`, which does not exist.

---

## 8. Repo facts worth not rediscovering

- The GitHub repo is **public**. Commits describing an unapplied security fix have been
  held back before; apply the same judgement to any future one.
- `docs/agent/` is the shared coordination directory; Codex reads and writes it.
- `mobile/AGENTS.md` requires checking the versioned Expo docs (SDK 57) before writing
  mobile code.
- `.gitignore` is deliberately curated — it keeps credentials, the CHO source documents and
  session notes out of a public repo. **Never `git add -A` from the repo root.**
- Every live patient row is test data. No real patients exist in this system yet.
