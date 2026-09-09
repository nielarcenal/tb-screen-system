# Issue register

Source baseline: `4659d65`, 2026-09-09. Details and recommended fixes are in CODEX_REVIEW.md. No implementation fixes were made during the baseline audit.

| ID | Severity | Issue | Status |
| --- | --- | --- | --- |
| BASE-01 | HIGH | NULL role bypasses reporting RPC authorization | Resolved and applied in migration 0028 |
| BASE-02 | HIGH | Patient-wide appointment access cannot isolate facilities/episodes | Design resolved in Revision 4; implementation pending case migration |
| BASE-03 | HIGH | Walk-in registration partial writes and duplicate retry | Design resolved in Revision 4; implementation pending case migration |
| BASE-04 | HIGH | Barangay report date ranges depend on session timezone | Open; Manila boundaries required |
| BASE-05 | HIGH | Capped sync pull loses rows tied at cursor timestamp | Open; scoped sync correction and boundary test required |

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

Migrations 0028 and 0029 are **APPLIED**. Revision 4 architecture is **APPROVED**, BASE-01 and BASE-06 are closed, and case/follow-up work remains migration 0030.

Migration 0028 passed 73/73 preflight checks before application. Migration 0029 passed 47/47 strengthened preflight checks before application; its live post-check shows 28 active-aware policies.

2026-09-09 update: BASE-01 and BASE-06 are closed in the live database by migrations 0028 and 0029.

2026-09-09 update: BASE-04 has an implementation awaiting verification — migration 0030. BASE-06 is resolved and applied (0029). Remaining open: BASE-02 and BASE-03 (both land with case work, now 0031) and BASE-05 (sync cursor ties, its own unit, explicitly not to be bundled with case work).

2026-09-09 update: BASE-05 has an implementation awaiting review — client-side only. Remaining open after it: BASE-02 and BASE-03, both landing with case work (migration 0031).
