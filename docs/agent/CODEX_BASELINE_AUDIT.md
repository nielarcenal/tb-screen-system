# Task 1.1 — Repository baseline audit

Date: 2026-09-09. Reviewed repository HEAD `4659d65` and the working tree. No CLAUDE_STATUS.md, DECISIONS.md, or sprint checkpoint existed at intake. Existing untracked design brief and supplied plan were preserved. This is a source audit, not verification of deployed migrations or production permissions.

## Current schema and reuse

There are 27 sequential server migration files, 0001 through 0027. Read them cumulatively: several early policies and functions are superseded. No case, treatment-follow-up, or audit table exists.

| Existing entity | Current responsibility / upgrade guidance |
| --- | --- |
| patients | Reuse identity, enroller, name parts, birthdate/age, sex, PSGC barangay, sitio, SMS consent/contact/language. UUID patient_id is identity; display_code is a unique display identifier. Do not create a second patient registry. |
| screenings | Reuse patient-linked checklist, supplementary PGI-S, referred flag and optional vitals. Preserve the checklist-only referral rule shared by web and mobile. |
| referrals | Reuse patient_id, screening_id, receiving facility_id, status, lab_sample_id, result notes, result_outcome, result_date and presented. Current result_outcome is nullable positive/negative entered by staff. Migration 0024 replaces specimen_id with lab_sample_id; do not restore the obsolete specimen-based referral model. |
| appointments | Reuse appointment_id, patient_id, scheduled_date, attended_date and scheduled/attended/missed status. There is no referral_id, facility_id or case linkage. Ownership must be designed before adding treatment scheduling. |
| sms_log | Reuse appointment-linked attempt log with queued/sent/failed/stubbed and reminder/follow_up kinds. No client read/write policies. sent means provider acceptance, not handset delivery. |
| users / facilities | Reuse role, active flag, forced-password-change flag, facility membership, barangay assignment and facility type. Do not infer clinical authorization from administrative privileges. |
| ref_regions / ref_provinces / ref_cities / ref_barangays | Reuse Bukidnon PSGC hierarchy; city default_facility_id supplies nearest-DOTS defaults. |

Conventions: UUID entity-specific primary keys, snake_case SQL, text CHECK vocabularies, timestamptz created_at/updated_at and update triggers; scheduling uses date. Mobile alone stores pending/synced bookkeeping. Client TypeScript contracts are maintained separately in web/src/lib/types.ts and mobile/src/db/types.ts.

## Existing flows that must survive

1. BHW enrolls locally, completes screening and generates a referral and initial appointment. Local writes survive loss of connectivity. Mobile displays/prints the referral document; lab sample identity is entered at the facility.
2. Facility inbox reads referrals with patient/screening joins. ReferralDetail.tsx receives/reverses receipt, records structured outcome and optional notes, closes/reopens referrals and manages patient appointments. Current status vocabulary is submitted/received/tested/closed; do not reinterpret closed as a treatment outcome.
3. RegisterPatient.tsx registers walk-ins through patient, screening and referral writes; referral starts received even when screening criteria are not met. The writes are currently non-atomic (BASE-03).
4. Facility staff schedule follow-ups and mark attendance/missed status. Existing appointments are patient-wide, including the detail query; they cannot reliably identify an episode or destination (BASE-02).
5. sms-reminders uses a cron secret and server service-role client. Reminder offsets and missed-visit selection live in _shared/selection.ts. It reserves a queued row before sending, suppresses same-day reminder attempts, caps follow-up attempts, ages abandoned reservations and suppresses follow-up for rebooked patients. Messages support en/tl/ceb and neutral facility wording. Gateways are stub, Semaphore and TextBee. No provider message ID/callback lifecycle is persisted. Do not enable delivery/retry expansion merely by renaming sent.
6. Existing dashboard_counts, hotspot_counts, admin_overview, bhw_activity and barangay_report RPCs provide operational/aggregate reporting. Aggregate cross-facility reporting is intentional in existing reporting functions; patient-row access is a different boundary.

## Roles and security architecture

- BHW: clinical rows for assigned barangay OR personally enrolled patients, including enrollments outside that barangay. Child access follows bhw_visible_patient_ids().
- TB-DOTS: own facility referrals and their screenings/patients; migration 0025 additionally permits reading personally enrolled patients/screenings during walk-in creation. Appointments follow referred patient IDs rather than appointment ownership.
- Midwife: barangay-scoped BHW supervision; existing design excludes patient-level clinical access. Migration 0026 replaces captain vocabulary.
- Admin: account/facility management and aggregates, not blanket clinical-table access.
- Service role: bypasses RLS; restricted to server management/SMS operations. New audit access must not expose these capabilities to clients.

RLS is enabled by 0002; SECURITY DEFINER helpers break recursive policy dependencies. Migration 0017 restricts user UPDATE to assigned_barangay_code and adds a narrow referral retry policy. Migration 0020 protects identity/link fields with triggers. Preserve these protections when evolving contracts. Helpers must be reviewed as directly callable functions, not just as policy internals. BASE-01 documents fail-open report role gates.

Forced password change is explicitly a client workflow gate in 0019, not server proof that a password changed. current_user_role() does not filter active; account management bans accounts and clients refresh account access. Release testing must cover existing tokens after deactivation and direct RPC access. The mobile exclusion of free-text result is also explicitly client-side, not a column-level authorization boundary.

## Required new entities and design gate

- tb_cases: required to represent multiple episodes per patient, explicit owning facility, optional originating referral, actor, lifecycle, dates and outcome. Do not make patient_id globally unique; specify precisely what constitutes an accidental duplicate active episode. Validate that referral, patient and facility agree, rather than relying on three independent foreign keys.
- treatment_followups: justified for minimal visit metadata/notes and treatment state after a visit. Attendance and scheduling should remain in appointments. Define whether one appointment permits one follow-up, how amendments work and whether unscheduled visits are allowed.
- audit_logs: required for durable actor/action history. Prefer server-produced events; constrain metadata and deny arbitrary client insert/update/delete. Current updated_at fields are not an audit trail.

These are recommendations for Claude's Tasks 1.2/1.3, not an approved schema. Decide facility transfers, multi-episode duplication, closed-case scheduling, status transitions, delete behavior, date consistency and BHW visibility explicitly. A timeline should aggregate authorized source records, not duplicate them in a second event store solely for presentation.

## Migration and integration risks

- Next migration is 0028 only if the sequence remains unchanged when Claude begins; Codex creates no migration. Never edit applied files. Reconcile live schema/ACLs before deployment because migration comments describe historical manual application.
- Add nullable case linkage to appointments for compatibility; do not guess a backfill from latest referral where multiple facilities/episodes exist. Resolve BASE-02 with explicit ownership and a documented legacy policy. Update SMS destination lookup, which currently picks the patient's latest referral, when appointments gain ownership.
- Preserve old mobile payload compatibility: adding a NOT NULL field without a safe default will break queued offline writes. Verify old clients cannot erase newly linked case fields on appointment upsert.
- Preserve anti-recursion helpers, immutable links and role gates; add indexes for actual case/facility/status/appointment date queries. Review unique constraints under concurrent requests, not only UI button disabling.
- Web integration points: App.tsx, ReferralInbox.tsx, ReferralDetail.tsx, RegisterPatient.tsx, Dashboard.tsx, BarangayReport.tsx, lib/types.ts and all three locale files. Preserve report capability detection and existing admin/midwife separation.
- New timelines must apply patient and case authorization independently and omit service-role SMS payloads. Dashboard counts need the same ownership filters as their linked lists and explicit period semantics.

## Mobile and offline impact

Expo SQLite local migrations use PRAGMA user_version. Repositories handle local writes and pulled rows; syncManager serializes sync and triggers on reconnect/foreground. syncEngine processes facilities, patients, screenings, referrals and appointments in dependency order, with per-table updated_at cursors. Permanent failures remain pending while later rows proceed; transient errors stop the pass. Pulls use last-write-wins repository handling.

Keep REFERRAL_COLUMNS explicit so free-text results do not enter the device. Sign-out performs a final sync and checks pending records before destructive cache cleanup. New cached entities would also require purge, pending-count and account-switch coverage. Prefer keeping the initial case UI on web until mobile clinical scope is decided.

BASE-05 identifies a cursor tie/pagination risk. Additional runtime verification is still needed for concurrent local edits during sync, revoked barangay scope in cached rows, token expiry, failed parent writes, logout and account switching. Unit tests do not establish device/database integration correctness.

## Tests, documentation and debt

Baseline commands use npm.cmd/npx.cmd because PowerShell rejects the unsigned npm.ps1 wrapper; no execution-policy change was made.

| Area | Command | Results |
| --- | --- | --- |
| web | npm.cmd test | 14 files, 129 passed, 0 failed, 0 skipped |
| mobile | npm.cmd test | 11 files, 197 passed, 0 failed, 0 skipped |
| Edge helpers/gateway | npm.cmd test | 3 files, 47 passed, 0 failed, 0 skipped |
| mobile | npx.cmd --no-install tsc --noEmit | Passed |
| Edge helpers | npm.cmd run typecheck | Passed; tsconfig includes _shared and Vitest config, not Deno entrypoints or gateway |

Web typecheck final result is recorded in CODEX_REVIEW.md. Tests total 373. Existing suites cover screening rules, vitals, translations, account/password gates, registration/referral UI, report rendering, sync error classification/notices, sign-out flow, SMS selection and gateways. No executable SQL/RLS integration suite was found in the inspected test inventory. Add real role/facility/anonymous denial, concurrent creation, partial failure and Manila boundary tests for new features; mocked client tests are insufficient evidence for RLS.

SYSTEM_DOCUMENTATION.md still claims migrations 0001–0025 although the repository contains 0026/0027. Its pre-screening-only scope will need deliberate reconciliation with the accepted case-management design. Locale files retain TODO i18n verify markers requiring native review. Existing known limitations include patient-level appointment linkage and client-only exclusion of result notes. Do not mistake old migration comments for the final schema.

No deployment, live patient query, SMS send, migration, production mutation or implementation edit was performed. Task 1.1 is complete; architecture approval remains pending Claude's domain/follow-up design and resolution of applicable high-severity findings.
