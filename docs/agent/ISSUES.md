# Issue register

2026-09-10 update: **BASE-03 is resolved and applied** in migration 0032. The
atomic `register_walkin()` RPC and portal client passed an 18/18 live rollback matrix,
all 391 repository tests, production build, and TypeScript checks. The authenticated
old-client gate from migration 0031 remains open because the local test password is
not configured; this is the only blocker on the appointment ownership client-contract
unit.

Source baseline: `4659d65`, 2026-09-09. Details and recommended fixes are in CODEX_REVIEW.md. No implementation fixes were made during the baseline audit.

| ID | Severity | Issue | Status |
| --- | --- | --- | --- |
| BASE-01 | HIGH | NULL role bypasses reporting RPC authorization | Resolved and applied in migration 0028 |
| BASE-02 | HIGH | Patient-wide appointment access cannot isolate facilities/episodes | Resolved and applied in migration 0031; strengthened live preflight 140/140 |
| BASE-03 | HIGH | Walk-in registration partial writes and duplicate retry | Design resolved in Revision 4; implementation pending case migration |
| BASE-04 | HIGH | Barangay report date ranges depend on session timezone | Resolved and applied in migration 0030; live preflight 16/16 |
| BASE-05 | HIGH | Capped sync pull loses rows tied at cursor timestamp | Resolved; 215/215 tests, clean typecheck, and live REST assumptions verified |

## Task 1.4 architecture gate findings

| ID | Severity | Issue | Status |
| --- | --- | --- | --- |
| ARCH-01 | HIGH | Proposed case transfer is blocked by referral and immediate appointment foreign keys | Resolved in Revision 2 |
| ARCH-02 | HIGH | Case RPC lacks patient admission, active-user, and TB-DOTS facility checks | Resolved in Revision 2 |
| ARCH-03 | HIGH | Direct case UPDATE bypasses the intended lifecycle RPC transaction | Resolved in Revision 2 |
| ARCH-04 | HIGH | Existing appointment writes can mutate new ownership/link columns | Resolved in Revisions 3-4 |
| ARCH-05 | HIGH | Mobile scope omits the facility ownership contract it says it will send | Resolved in Revision 2 |
| ARCH-06 | HIGH | Legacy NULL-facility population can grow and is ambiguous across facilities | Resolved in Revisions 2-3 |
| ARCH-07 | HIGH | Idempotency records are not bound to operation, caller, or payload | Resolved in Revision 2 |
| ARCH-08 | MEDIUM | Follow-ups lack temporal consistency and a way to void erroneous records | Resolved in Revision 2 |
| ARCH-09 | MEDIUM | Case-number prefix/counter source is undefined and no-gap claim is invalid for sequences | Resolved in Revision 2 |

Task 1.4 result: **NOT APPROVED**. No migration should be created until ARCH-01 through ARCH-07 and the clinical vocabulary blocker are resolved.

## Revision 2 re-review

Revision 2 closes ARCH-02, ARCH-03, ARCH-05, and ARCH-07 at design level. ARCH-01, ARCH-04, and parts of ARCH-06/08/09 remain represented below.

| ID | Severity | Issue | Status |
| --- | --- | --- | --- |
| R2-01 | HIGH | Column REVOKE does not override table UPDATE grant and conflicts with upsert retry | Resolved in Revision 3 |
| R2-02 | HIGH | An appointment linked to both referral and case blocks case transfer | Resolved in Revision 3 |
| R2-03 | HIGH | Audit-writing RPCs precede the scheduled audit table | Resolved in Revision 3 |
| R2-04 | HIGH | Treatment start date and lifecycle transition are separate, incompletely constrained writes | Resolved in Revision 3 |
| R2-05 | HIGH | Ambiguous appointment queue exposes referral history to non-clinical admin | Resolved in Revision 3 |
| R2-06 | MEDIUM | Public SECURITY DEFINER sole-facility helper can disclose patient facility association | Resolved in Revision 3 |
| R2-07 | MEDIUM | Linked follow-up correction/void cannot consistently repair appointment state | Resolved in Revision 3 |
| R2-08 | MEDIUM | NOT NULL facility short code omits existing BHS rows | Resolved in Revision 3 |

Revision 2 gate result: **NOT APPROVED**. Independent BASE-01 repair is approved as the next sequential migration and work unit; it requires separate Codex review.

## Migration 0028 / Revision 3 review

| ID | Severity | Issue | Status |
| --- | --- | --- | --- |
| BASE-06 | HIGH | Deactivated users retain RLS row access until their JWT expires | Resolved and applied in migration 0029; 47/47 strengthened preflight checks passed |
| M28-01 | MEDIUM | ACL post-check hides PUBLIC and mismatches retained service-role grants | Resolved; ACL inspection corrected and all seven service-role grants revoked |
| M28-02 | MEDIUM | Body verifier excludes pre-existing declaration logic | Resolved; balanced guard removal and two mutation self-tests passed |
| M28-03 | MEDIUM | SQL matrix is not packaged for pre-apply rollback and lacks exact helper/setup assertions | Resolved; generated rollback preflight passed 73/73 live checks |
| R3-01 | HIGH | Appointment ownership trigger rejects authenticated referral FK cascades | Resolved in Revision 4 |
| R3-02 | HIGH | Follow-up void fields repeat ineffective column-only REVOKE | Resolved in Revision 4 |
| R3-03 | HIGH | TB-DOTS short-code CHECK accepts NULL as unknown | Resolved in Revision 4 |
| R3-04 | HIGH | Revised appointment policy still uses non-active-aware role helper | Resolved in Revision 4 |
| R3-05 | MEDIUM | Public case-ID helper lacks active clinical-role containment | Resolved in Revision 4 |
| R3-06 | LOW | Revision 3 retains withdrawn admin-queue wording | Resolved in Revision 4 |

Migrations 0028 through 0031 are **APPLIED**. Revision 4 architecture is **APPROVED**. BASE-01, BASE-02, BASE-04, BASE-05, and BASE-06 are closed; BASE-03 remains for its atomic walk-in registration unit.

Migration 0028 passed 73/73 preflight checks before application. Migration 0029 passed 47/47 strengthened preflight checks before application; its live post-check shows 28 active-aware policies.

2026-09-09 update: BASE-01 and BASE-06 are closed in the live database by migrations 0028 and 0029.

2026-09-09 update: BASE-04 has an implementation awaiting verification — migration 0030. BASE-06 is resolved and applied (0029). Remaining open: BASE-02 and BASE-03 (both land with case work, now 0031) and BASE-05 (sync cursor ties, its own unit, explicitly not to be bundled with case work).

2026-09-09 update: BASE-05 has an implementation awaiting review — client-side only. Remaining open after it: BASE-02 and BASE-03, both landing with case work (migration 0031).

2026-09-09 final update: BASE-04 and BASE-05 passed review and are closed. Migration 0030 is live. The national outcome vocabulary and eleven facility codes are accepted as project conventions, so migration 0031 is unblocked apart from its mandatory old-client upsert compatibility test.

2026-09-09 update: migration **0031** is written and verified but **NOT applied**. Its live
preflight returned 119/119 PASS and rolled back. BASE-02 (appointment facility ownership) is
implemented in it; BASE-03 (walk-in partial writes) is **not** — 0031 creates the
`rpc_requests` ledger that the atomic registration RPC needs, but the RPC itself is a
separate unit and BASE-03 stays open.

The old-client PostgREST upsert gate is **half closed**. `scripts/old-client-upsert-check.mjs`
ran against the live stack as a real BHW account and confirmed that a column omitted from an
upsert payload survives — PostgREST builds `ON CONFLICT DO UPDATE SET` from payload keys.
The question has not yet been asked about `facility_id`/`referral_id`/`tb_case_id`, which do
not exist until 0031 is applied; the script runs that stage automatically once they do.

| ID | Severity | Issue | Status |
| --- | --- | --- | --- |
| M31-01 | MEDIUM | Task 1.3 §3.1's backfill uses `min(facility_id)`; PostgreSQL has no `min()` for uuid, so the migration as designed would not run | Corrected in 0031 to `(array_agg(distinct facility_id))[1]`; the HAVING clause already guarantees one distinct value |
| M31-02 | HIGH | Appointment referral/case FKs and assignment RPC enforce facility agreement but not patient agreement | Open; three added live isolation probes fail in the rollback preflight |
| M31-03 | HIGH | Replacement TB-DOTS appointment insert policy allows an unlinked arbitrary patient UUID | Open; preserve the pre-0031 referred-patient admission boundary |
| M31-04 | HIGH | Closing a case does not reject an outcome date earlier than an existing live follow-up | Open; parent transition must re-check non-voided children |
| M31-05 | MEDIUM | `record_visit` status parameter cannot represent initial treatment/closure and permits visit-plus-cancel | Open; narrow or complete the RPC contract and test advertised transitions |
| M31-06 | MEDIUM | Old-client stage-2 `tb_case_id` check compares NULL to NULL | Open; add a case-linked fixture with a non-NULL ID |
| M31-07 | HIGH | Real account password committed as a script fallback | Fixed in worktree; amend the unpushed 0031 commit before push |

Codex result: **CHANGES REQUIRED; migration 0031 must not be applied.** The original 119 checks remain useful, but four added appointment checks produce one valid PASS and three expected FAILs against the current migration. The resulting live preflight reports 3/123 failed and rolls back.

## Migration 0031 review — round 1

| ID | Severity | Issue | Status |
| --- | --- | --- | --- |
| M31-02 | HIGH | Appointment ownership FKs name the link and facility but not the patient, so an appointment can cite another patient's referral or case at the same facility | Resolved; both parent keys and both FKs carry `patient_id`, `assign_appointment_to_case()` compares patients, and the review's Pass 12 plus a new RPC check cover it |
| M31-03 | HIGH | `appointments_tbdots_insert` replaced 0011's `referred_patient_ids()` admission predicate with a facility-only check, letting a facility schedule any patient uuid | Resolved; the unlinked arm restores the original boundary and the linked arms prove patient and facility agreement. Pinned by the verifier with a mutation self-test |
| M31-04 | HIGH | `set_tb_case_status()` could close a case with an outcome dated before an existing live follow-up | Resolved; closing rejects it, scoped to non-voided rows, with denial/void/allow tests |
| M31-05 | MEDIUM | `record_visit(p_new_case_status)` advertised transitions it had no inputs to perform, and permitted `cancelled` alongside a clinical record | Resolved; it carries the treatment/outcome inputs, refuses `cancelled`, and each advertised path is tested |
| M31-06 | MEDIUM | The stage-2 `tb_case_id` upsert assertion ran against a referral-linked fixture, comparing null to null | Resolved; two fixtures, a VACUOUS verdict for an already-null column, and a skipped fixture now fails the run |
| M31-07 | HIGH | A real test-account password was committed as the upsert script's default fallback | Resolved by Codex in the unpushed commit; the script now requires `TBSCREEN_TEST_PASSWORD` from the environment or `.env` |

Live rollback preflight after the corrections: **139/139 PASS**. Migration 0031 remains
**NOT applied**. The old-client upsert gate is still open — stage 2 cannot run until the
ownership columns exist, and the script now prints `GATE: NOT CLOSED` and fails rather than
exiting 0 when it cannot ask.

## Migration 0031 final re-review

| ID | Severity | Issue | Status |
| --- | --- | --- | --- |
| M31-08 | MEDIUM | The `correct_tb_case_dates()` denial probe ran while the case was open, so the ordinary outcome-shape CHECK could satisfy it before the intended follow-up bound | Resolved by Codex; the probe now closes legally first, reaches the RPC's follow-up guard, and has a post-void success control |
| M31-09 | MEDIUM | The PostgREST harness could skip Stage 2 with exit 0 or print `GATE: CLOSED` under service-role fallback | Resolved by Codex; viable fixtures are selected deterministically, skips fail, and only a complete authenticated run can close the gate |

Final result: migration **0031 is approved and applied**. The strengthened rollback preflight passed **140/140**. A service-role PostgREST probe executed both fixture shapes and preserved `facility_id`, `referral_id`, and a non-NULL `tb_case_id`; because service role bypasses RLS and column privileges, the authenticated BHW gate remains open until `TBSCREEN_TEST_PASSWORD` is supplied locally. BASE-02 is closed. BASE-03 remains open.
