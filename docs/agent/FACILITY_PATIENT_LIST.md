# Facility patient list

## Plan and implementation

1. Preserve the existing patient-read boundary: active TB-DOTS staff see patients referred to their facility or enrolled by their own account. Province-wide exact-match registration lookup remains separate.
2. Add Patient list navigation with name/ID search, stable ordering and server pagination (25 rows).
3. View demographics, SMS preferences and address; link to accessible referrals, TB cases and the existing timeline. Clinical actions stay in their established workflows.
4. Correct name parts, birthdate, sex, sitio, phone, SMS consent and language through a narrowly scoped server function. Preserve patient ID, display code, enrolment attribution and barangay assignment. No deletion, merge or reassignment action.
5. Require verification in the form; enforce validation, optimistic concurrency and identity collision detection in PostgreSQL. Log category flags, actor, patient and facility, never names or phone values.

## Release status 2026-09-17

- Web implementation and migration `0042_facility_patient_details.sql` are prepared.
- TypeScript and production build pass (existing bundle-size warning remains).
- All 218 portal tests pass, including 11 new patient-list/domain tests.
- Linked-database 0042 preflight passed inside a rollback-only transaction; no fixtures or migration changes were retained.
- Signed-in local browser: directory, patient detail, edit form, address rendering and related clinical links inspected. No real patient edits submitted.
- Production migration and Vercel deployment have NOT been performed.

Before enabling saves, apply 0042 through the existing reviewed migration workflow, then deploy the web portal. A missing RPC is reported as an explicit migration-required message rather than a false save success.

## Constraints and follow-up checks

### Release update — 2026-09-20

- Migration 0042 rollback preflight passed again, then the transaction was applied to the linked production database.
- Live RPC verified: SECURITY DEFINER, authenticated execute allowed, anonymous execute denied.
- All 218 portal tests and production build passed again; 236 mobile tests and mobile TypeScript check passed.
- Release source commit: `75fcfa0`. BHW 1.3.0 APK published with the documented matching SHA-256. Both production Vercel deployments succeeded; the live portal serves the new patient-edit RPC client and the website links to 1.3.0. Deployment IDs: portal `6548218672`, website `6548216192`.
- Physical-device PIN acceptance remains pending. No real patient edits were submitted during release verification.

- Barangay is immutable under 0020 because it determines BHW visibility. A reassignment/handoff workflow needs separate design; editing sitio is supported.
- Existing offline mobile synchronization uses last-write-wins. Portal optimistic concurrency prevents a stale portal save but does not redesign mobile conflict handling; test pending mobile edits versus later facility edits before real-data rollout.
- The identity collision check serializes patient writes with a short table lock. It prevents a conflicting correction at the time of this transaction; it is not a universal uniqueness constraint on all future registrations. Review performance before large deployments.
- Patient audit entries cover this RPC, not historical edits or all mobile updates.
- Related records are limited to the 100 most recent per section and state that limit in the UI.
- Newly added Tagalog/Cebuano wording should receive native-speaker review.

## Manuscript placement

- Chapter 3, System Development: add **SMS Reminder and Follow-up Module** after Database and Services. Explain data flow, scheduler, consent, language, neutral templates, provider adapter, duplicate-send prevention, logging and failure handling. Identify the gateway actually configured in the evaluated build, not just every adapter supported by source code.
- Chapter 4: describe test cases and observed outcomes. Separate provider acceptance from verified handset receipt. The current source uses up to two reminder opportunities (five days before and the appointment day), a 14-day missed-appointment follow-up window and a maximum of three failed follow-up attempts; late bookings may miss the advance reminder. This supersedes any blanket statement that failed messages are never retried. Verify deployed configuration before reporting operational behavior.
- Appendix: sample neutral messages, screenshots and a test matrix without credentials or identifiable patient data.
- AI disclosure: follow the college/adviser's required template. In the absence of one, propose a separate **Declaration of AI Assistance** in the preliminary pages before the table of contents, with a short Chapter 3 explanation of development assistance and an optional appendix use log. Distinguish AI assistance in development/writing from the TB-Screen application, which does not use AI to diagnose TB or analyze cough audio.
- Identify actual tools and tasks (planning, code assistance, debugging, diagrams and language editing), and explain the author's review and responsibility. Do not present an AI tool as a research participant, author or source of fabricated study evidence.
