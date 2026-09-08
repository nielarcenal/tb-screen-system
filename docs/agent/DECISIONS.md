# Architecture decision register

## 2026-09-09 — Final Revision 4 gate

| # | Decision |
| --- | --- |
| D-GATE-R4 | Revision 4 architecture is approved. R3-01 through R3-06 are resolved; no further redesign loop is required before implementation. |
| D-0028-h | Migration 0028 is approved for application. The generated live-database preflight passed 73/73 checks and reached its explicit rollback; the body verifier and both mutation self-tests also passed. |
| D-BASE-06-order | BASE-06 is the next implementation unit and becomes migration 0029. It precedes case/follow-up work so existing and new policies share one active-account rule. |
| D-CASE-number | The approved case/follow-up migration moves from 0029 to 0030. Revision 4's migration-number references must be updated before that migration is written. |
| D-FAC-live | The live database contains exactly eleven TB-DOTS facilities, with IDs and names matching the proposed seed map. Only confirmation of any existing local abbreviations remains. |

Remaining inputs for migration 0030 are the facility outcome vocabulary and local short-code convention. The old-client upsert behavior is a mandatory implementation test. `weight_kg` is omitted if clinical confirmation is unavailable.

---

2026-09-09: No new domain design has been approved. Follow the supplied master plan; Claude owns migrations and implementation, Codex owns review.

Existing constraints to preserve: reuse patient/screening/referral/appointment/SMS entities; retain offline architecture and role scopes; derive referral only from the existing checklist; no AI diagnosis; neutral consent-based SMS. These are inherited constraints, not new decisions made by this audit.

Pending Claude Tasks 1.2/1.3 and Codex Task 1.4: case lifecycle and duplicate definition; case/referral/patient consistency; appointment facility/episode ownership and legacy handling; follow-up cardinality; role visibility of treatment/notes; audit permissions; deletion/transfer rules; old mobile payload compatibility. See CODEX_BASELINE_AUDIT.md and CODEX_REVIEW.md for evidence.

## 2026-09-09 — Tasks 1.2 / 1.3 design decisions (proposed, pending Codex Task 1.4)

Full reasoning: CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md and CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md. These are Claude's design proposals; none is approved until the Task 1.4 gate passes, and no migration exists yet.

| # | Decision |
| --- | --- |
| D-1.2-a | A case records a clinical decision already made. It is never created automatically from `result_outcome = 'positive'`; a positive result only prompts the UI. |
| D-1.2-b | `tb_cases.facility_id` (NOT NULL) is the owning facility and the direct RLS key. |
| D-1.2-c | One lifecycle column: `registered`, `on_treatment`, `interrupted`, `closed`, `cancelled`. No separate `treatment_status`; no `treatment_end_date`; no `diagnosis_or_confirmation_date`. |
| D-1.2-d | Closed cases never reopen. A relapse or retreatment is a new case. |
| D-1.2-e | Duplicate = a second non-terminal case for the same patient, any facility. Enforced by a partial unique index. |
| D-1.2-f | Case/referral/patient/facility agreement is enforced by composite foreign keys, not triggers. |
| D-1.2-g | Cases are created and transitioned only through idempotent SECURITY DEFINER RPCs. No client INSERT policy; no client DELETE policy on any new table. |
| D-1.2-h | BHW visibility of cases is an RPC returning four columns, not a table policy — a real server-side column boundary. Midwives and admins get no patient-level case rows. |
| D-1.2-i | Facility transfer moves the case (never closes it), is admin-only via RPC, and its UI is deferred to Priority B. |
| D-1.2-j | Every new function uses null-safe role gates and explicit least-privilege ACLs. BASE-01's existing fail-open gates must be fixed before the case RPCs ship. |
| D-1.2-k | `audit_logs` is written only by server triggers, stores a whitelisted `{column: {from, to}}` diff, and never stores clinical free text or contact numbers. |
| D-1.3-a | `appointments` stays the only scheduler. `treatment_followups` holds no date that can drive a reminder. |
| D-1.3-b | `appointments` gains nullable `facility_id` (ownership, all appointments) and nullable `tb_case_id` (episode, the subset inside a case). |
| D-1.3-c | Backfill assigns `facility_id` only for patients whose referrals name exactly one facility. Ambiguous rows stay NULL under an explicit legacy policy with a stated exit criterion. No guess from "latest referral". |
| D-1.3-d | Both new columns stay nullable so queued offline writes from old mobile builds still succeed. |
| D-1.3-e | SMS destination switches to `appointments.facility_id`, falling back to the current latest-referral lookup only while it is NULL. |
| D-1.3-f | One appointment permits at most one follow-up (UNIQUE); unscheduled visits are allowed (nullable `appointment_id`). |
| D-1.3-g | Amendments are updates plus an audit row. No delete. Follow-up `notes` are facility-only and never leave the server. |
| D-1.3-h | `cancelled` is added to `appointments.status`; closing a case cancels its future scheduled appointments in the same transaction. |
| D-1.3-i | The Patient Care Timeline is a read-time aggregation RPC, not an event table, and authorizes patient and case independently. |
| D-1.3-j | Case and follow-up UI stays on web. The only mobile change is the `AppointmentStatus` union. |

Deferred, with reasons recorded: facility-transfer UI (Priority B); making `appointments.facility_id` NOT NULL (after the unassigned list reaches zero); mobile case UI (clinical scope on device undecided).

Unconfirmed with the TB-DOTS head nurse and blocking migration 2.1: the treatment-outcome vocabulary, and `weight_kg` on follow-ups.

## 2026-09-09 — Codex Revision 2 re-review

Revision 2 resolves ARCH-02, ARCH-03, ARCH-05 and ARCH-07. The architecture gate remains not approved because R2-01 through R2-05 are HIGH. The conditional outcome path is accepted: without local vocabulary confirmation, omit `outcome` and keep `closed` unreachable. Weight may also be omitted.

Claude is approved to implement BASE-01 as an independent next sequential migration while the case design is revised. With no newer migration present, BASE-01 becomes 0028 and case work moves to 0029 or the next actual number. Facility short codes require a separate eleven-row mapping derived from 0009 and a type-aware nullable constraint so BHS rows are not forced to carry case-number codes.

## 2026-09-09 — Codex migration 0028 / Revision 3 review

Migration 0028's core guard fix is accepted on source inspection, but application approval is withheld until its ACL/body verifiers are corrected and the real-role matrix passes in a transactional preflight or disposable database. BASE-06 is confirmed as a separate release-blocking HIGH issue: deactivated accounts retain RLS access while an old JWT is valid.

Revision 3 resolves the earlier transfer-link exclusivity, audit sequencing, treatment-start atomicity, admin disclosure, boolean legacy helper, void replacement, and type-aware short-code direction. The gate remains not approved for R3-01 through R3-04. The proposed eleven facility codes are acceptable defaults pending the facility's own abbreviations and live-table reconciliation; the CHECK must explicitly require `short_code IS NOT NULL` for TB-DOTS rows.

## 2026-09-09 — Codex Task 1.4 gate result

The proposed model is not yet approved. The entity boundaries and appointment-reuse principle are accepted, but D-1.2-f/i, D-1.2-g, D-1.3-b/c/d/j and the idempotency design require revision under ARCH-01 through ARCH-07 in CODEX_REVIEW.md.

Decisions accepted for the revision: `cancelled` may be added to appointment status; closing a case may atomically cancel scheduled appointments on or after Manila today; case/follow-up UI may remain web-only; admin audit access may cover metadata-whitelisted rows only; transfer UI may be deferred but an executable transfer RPC must ship with global active-case uniqueness. Outcome vocabulary and follow-up weight remain clinically unconfirmed.

## 2026-09-09 — Revision 2, after the Task 1.4 gate (NOT APPROVED)

Codex recorded 7 HIGH and 2 MEDIUM architecture findings (ARCH-01..09). Both design documents were revised. Decisions superseded below are struck from the revision-1 table above; where a row is not mentioned here, it stands unchanged.

**Withdrawn (my design was wrong):**

| Was | Why withdrawn | Replaced by |
| --- | --- | --- |
| D-1.2-f composite FK `tb_cases -> referrals (referral_id, patient_id, facility_id)` | ARCH-01: pinned case facility to the referral facility for life, so no transfer could ever execute | Creation-time validation inside `create_tb_case`, `referral_id` pinned immutable, plus a trigger blocking re-route of a cited referral (1.2 §4) |
| D-1.2-g partial: TB-DOTS direct table UPDATE on `tb_cases` | ARCH-03: contradicted the RPC-only lifecycle; a PATCH could skip audit and cancellation | `revoke insert, update, delete`; SELECT only; three RPCs are the whole write surface (1.2 §7.2) |
| D-1.2-i transfer UI **and RPC** deferred to Priority B | ARCH-01/gate Q5: the global one-active-case index has no remedy without the RPC | Transfer RPC ships in 0028; only the UI is deferred (1.2 §5) |
| D-1.3-c legacy predicate sharing a NULL row across every referred facility | ARCH-06: reproduced the BASE-02 cross-facility hole and made claiming a race | `sole_referral_facility()` — one facility or none; ambiguous rows go to an admin-only queue (1.3 §3.1–3.2) |
| D-1.3-j "the only mobile change is the AppointmentStatus union" | ARCH-05: contradicted the same document's promise that mobile would send `facility_id` | Full cross-layer mobile contract change, listed file by file (1.3 §3.3) |
| Case number from a PostgreSQL sequence, claimed gap-free | ARCH-09: sequences are non-transactional, so the claim was false; and no facility short code exists | `facilities.short_code` (seeded, immutable) plus a transactional `case_number_counters` row (1.2 §6) |
| `rpc_requests (request_id, created_at, result_id)` | ARCH-07: no operation namespace, actor binding or payload binding | Namespaced, actor/facility-bound, fingerprinted, typed result, authorized replay, 7-day retention (1.2 §7.3) |

**Added:**

| # | Decision |
| --- | --- |
| D-1.2-l | `create_tb_case` enforces an admission predicate, not just a role: active TB-DOTS profile, facility of type `tb_dots`, referral agreement on patient and facility with status past `submitted`, and for referral-free creation membership of `own_enrolled_patient_ids()`. Every failure returns one uniform 42501 so patient existence is never disclosed. |
| D-1.2-m | The lifecycle transition table is defined once and shared by `set_tb_case_status()` and the table trigger, so there is exactly one transition authority. |
| D-1.2-n | Every new SECURITY DEFINER function checks `users.active` directly rather than trusting `current_user_role()`, which does not filter it. The ACL test matrix (anon, missing profile, inactive, wrong role, wrong facility, allowed) applies to each. |
| D-1.2-o | The outcome vocabulary is sourced to the WHO 2013 reporting framework adopted by the DOH NTP MOP. If local confirmation does not arrive, 0028 ships **without** `outcome` and `closed` is unreachable — no guessed CHECK, no free-text column. |
| D-1.3-k | `appointments.referral_id` is added alongside `facility_id` and `tb_case_id`; the mobile referral screen already knows the referral id at insert time, so pre-case ownership is recorded rather than inferred. |
| D-1.3-l | `revoke update (facility_id, referral_id, tb_case_id) on appointments from authenticated, anon`. Ownership is supplied at insert or changed by an authorized RPC, never by a PATCH. |
| D-1.3-m | Both ownership FKs use reviewed `ON UPDATE CASCADE`, which is what makes a case transfer executable in one statement and makes a referral re-route carry its initial appointment. |
| D-1.3-n | The compatibility window is bounded by a follow-up migration that rejects NULL-`facility_id` inserts with 42501 (classified PERMANENT by `syncErrors.ts`). `facility_id NOT NULL` is not promised for Day 2. |
| D-1.3-o | Follow-ups are bounded in time (within the case interval, not in the future) and, when linked, require an attended appointment whose `attended_date` equals `visit_date`. |
| D-1.3-p | Erroneous follow-ups are **voided** (`voided_at/by/reason` + audit event), not amended away. Voided rows are excluded from timelines and counts. |
| D-1.3-q | `record_visit()` performs attendance, follow-up, optional transition and optional next appointment atomically, so the clinical path does not repeat BASE-03's partial-write shape. |
| D-1.3-r | Closing a case cancels only `scheduled` appointments dated on or after Manila today; past scheduled rows remain for missed-visit handling. Each cancellation is audited. |

Still blocking migration 0028: treatment-outcome vocabulary confirmation (hard blocker), `weight_kg` confirmation (soft — omit if late), and the facility short-code seed list.

## 2026-09-09 - Revision 3, after the second gate

**Withdrawn (my design was wrong again):**

| Was | Why withdrawn | Replaced by |
| --- | --- | --- |
| D-1.3-l `revoke update (facility_id, referral_id, tb_case_id) from authenticated` | R2-01: a column REVOKE does not subtract from a table-level UPDATE grant, so the statement would have changed nothing. And denying UPDATE on those columns would break the mobile whole-row upsert retry. | 0017's table-revoke-then-column-grant, plus `enforce_appointment_ownership()`: an unchanged re-send passes, any reassignment is rejected (1.3 s2.2) |
| D-1.3-m two cascades "cannot fight" | R2-02: an appointment holding both `referral_id` and `tb_case_id` shares one `facility_id` between two live parents, so a case transfer still fails | `check (num_nonnulls(referral_id, tb_case_id) <= 1)`; `assign_appointment_to_case()` swaps the links (1.3 s2.1) |
| Admin resolution queue for ambiguous legacy appointments | R2-05: would expose a named patient's referral history to a role deliberately denied clinical rows | No client sees them at all; resolved by support from a direct session before production, while the data is still synthetic (1.3 s3.2) |
| `sole_referral_facility(p_patient_id) returns uuid` | R2-06: a callable SECURITY DEFINER surface returning another patient's facility | `caller_owns_unassigned_appointment(p_patient_id) returns boolean`, which only ever compares against the caller's own facility; backfill computed inline (1.3 s3.1) |
| `unique (appointment_id)` on follow-ups | R2-07: a voided row kept the slot, so the corrected replacement could not be recorded | Partial unique index over live (non-voided) rows (1.3 s4.1) |
| `update_tb_case_details(p_case_id, p_treatment_start_date)` | R2-04: treatment start took two commits, and no invariant covered `interrupted`/`closed`, so a correction could clear the date | `set_tb_case_status()` takes the start date; `correct_tb_case_dates()` re-validates; symmetric invariants over every state (1.2 s3.2) |
| `audit_logs` scheduled for the Day-6 task | R2-03: every RPC in the case migration writes audit events, so they would ship unaudited or fail | The table, trigger, RLS and event contract ship in 0029; Day 6 adds the viewer (1.2 s9) |
| `facilities.short_code text not null unique` | R2-08: would fail on existing barangay health stations and block future BHS creation | Nullable, unique-where-present, required by a `type = 'tb_dots'` CHECK added after population and verification (1.2 s6) |

**Added:**

| # | Decision |
| --- | --- |
| D-1.3-s | Appointment ownership is enforced by a trigger, not by privileges. The privilege layer for this table is near-vacuous and the design says so rather than implying otherwise. Authorized RPCs signal intent with a `SET LOCAL` GUC that PostgREST gives clients no way to set. |
| D-1.3-t | An appointment has exactly one owner: a referral (pre-case) or a case, never both. |
| D-1.3-u | Void means the clinical record is invalid; it never rewrites attendance. Attendance has its own existing undo. A voided row frees the appointment's follow-up slot. |
| D-1.3-v | Correcting a linked follow-up's visit date is an atomic RPC over both rows; `visit_date` is not client-writable on linked follow-ups. |
| D-1.2-p | Treatment start is part of the status transition, not a separate edit. Symmetric invariants pin the start date across every lifecycle state. |
| D-1.2-q | `audit_logs` ships with the first migration that creates mutable case data. No RPC is enabled before its audit dependency exists. |
| D-0028-a | BASE-01 is repaired as its own migration, 0028, ahead of all case work. It adds `current_user_active_role()` (NULL for anonymous, unprovisioned and deactivated callers alike) and re-gates all six client-callable gated functions plus their ACLs. |
| D-0028-b | 0028 deliberately does NOT make `current_user_role()` active-aware. That helper backs ~20 RLS policies, so a deactivated user with an unexpired JWT can still read rows through them. Recorded as an open gap with its own work unit, not silently closed inside an authorization repair. |
| D-0028-c | 0028 deliberately does NOT fix BASE-04. Reporting arithmetic does not belong in an authorization fix; it gets its own migration and boundary tests. |
| D-0028-d | Six function bodies were restated verbatim to change their guards. `scripts/verify-0028-bodies.mjs` proves mechanically that nothing but the guard changed, and is itself mutation-tested. |

Still blocking case work (renumbered to 0030 at the final gate): treatment-outcome vocabulary confirmation (hard), `weight_kg` confirmation (soft), the short-code mappings (soft).

## 2026-09-09 - Revision 4, after the third gate

**Withdrawn (my design was wrong):**

| Was | Why withdrawn | Replaced by |
| --- | --- | --- |
| The `auth.role()` cascade exemption in `enforce_appointment_ownership()` | R3-01: an FK cascade from a BHW's referral re-route is an ordinary `authenticated` UPDATE with no GUC set, so the trigger would have rejected it and broken re-routing outright | The trigger validates the RESULT against the unchanged parent link. A cascade authorizes itself because the new facility equals the parent's; the GUC now authorizes only link swaps, legacy claims and transfers (1.3 s2.2) |
| `revoke update (voided_at, voided_by, void_reason)` on `treatment_followups` | R3-02: the same ineffective column-only revoke R2-01 had already established does not subtract from a table-level grant - I fixed it on `appointments` and left it standing here | Table revoke, then `grant update (notes, weight_kg, updated_at)`. Visit date and all void fields are RPC-only, verified with `has_column_privilege` rather than by reading the statement (1.3 s4.6) |
| `check ((type = 'tb_dots' and short_code ~ '...') or ...)` | R3-03: for a TB-DOTS row with a NULL code the regex is NULL, the whole CHECK is NULL, and PostgreSQL accepts an unknown CHECK - it permitted exactly the row it forbade | `short_code is not null and short_code ~ '...'`, with a six-case constraint test table (proposal s1) |
| `current_user_role()` in the new appointments policy | R3-04: only the legacy helper was active-aware, so 0029 would have reproduced BASE-06 inside authorization it was newly writing | `current_user_active_role()` in every new or replaced policy and helper, from its first version (1.3 s3.1, 1.2 s8) |
| `public.own_facility_case_ids()` | R3-05: an enumerating SECURITY DEFINER helper in the exposed schema, gated on facility alone - the same callable-surface defect already corrected under R2-06, reintroduced one section later | `app_private.own_facility_case_ids()`, active-role-aware, in a schema PostgREST does not expose (1.3 s4.6) |
| POST-CHECK 1's ACL query (inner join to `pg_roles`) | M28-01: PUBLIC is grantee OID 0 and has no `pg_roles` row, so the query could never show a surviving PUBLIC grant - the one thing it existed to catch | LEFT JOIN rendering grantee 0 as PUBLIC; service_role revoked from all seven so the expectation is uniform |
| The body verifier cutting from body start through the last guard | M28-02: that excluded pre-existing DECLARE blocks, notably `dashboard_counts()`'s Manila date variables, so it proved the query tail matched and printed OK regardless | Balanced-scan removal of only guard spans plus the single new `v_role` declaration; every pre-existing declaration is compared. Self-test now mutates a declaration token as well as a query token |
| "0028 is self-rolling-back" and "run it before 0028 is applied" | M28-03: the file opened a transaction it never closed, and it calls definitions that only exist after 0028, which itself committed | 0028 no longer opens a transaction; `scripts/build-0028-preflight.mjs` generates `begin; <0028> <matrix> rollback;` as one batch. The matrix now raises on any FAIL, which also guarantees rollback |

**Added:**

| # | Decision |
| --- | --- |
| D-1.3-w | Appointment ownership is authorized by the resulting row's agreement with its unchanged parent, not by the apparent privilege of the caller. Cascades need no exemption; they satisfy the check by construction. |
| D-1.3-x | Enumerating SECURITY DEFINER helpers belong in `app_private`, which PostgREST does not expose, and must be active-role-aware. The four existing ones in `public` share the defect and should move with BASE-06's policy pass. |
| D-0028-e | service_role EXECUTE is revoked from all seven functions. Under service_role `auth.uid()` is null, so each one raises; a standing grant on a function that cannot work is a trap. This differs from 0019's decision because there the service-role call was a harmless no-op. |
| D-0028-f | Migration 0028 opens no transaction of its own, so the preflight can wrap it and roll it back. The applier owns the transaction. |
| D-0028-g | The preflight is GENERATED from the migration and the matrix, never hand-maintained, so it cannot drift from what it verifies. The generator refuses to build if either input contains its own transaction control. |
| D-BASE-06 | Deactivated accounts keep RLS row access until JWT expiry. Release-blocking HIGH with its own unit. Superseded on final review by D-BASE-06-order: BASE-06 is migration 0029 and case work moves to 0030. |

Still blocking case work (renumbered to 0030 at the final gate): BASE-06 must ship first as 0029; treatment-outcome vocabulary (hard); `weight_kg` and the short-code mappings (soft). The 0028 matrix has since passed 73/73.
