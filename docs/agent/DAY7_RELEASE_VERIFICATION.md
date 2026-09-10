# Day 7 release verification

Date: 2026-09-10. Status: **RELEASE GATE PASSED FOR CAPSTONE/DEMO**.

No Critical or High finding remains open. Automated, database, build, and source-review
gates pass. On 2026-09-10, the user confirmed that the complete physical Android
offline/reconnect/cache-isolation checklist passed and that native-speaker review approved
the Tagalog and Cebuano copy. The two final human release checks are therefore closed.

## Automated gate

| Component | Command | Passed | Failed | Skipped |
| --- | --- | ---: | ---: | ---: |
| Portal | `cd web; npm test` | 181 | 0 | 0 |
| Mobile | `cd mobile; npm test` | 218 | 0 | 0 |
| Edge functions | `cd supabase/functions; npm test` | 51 | 0 | 0 |
| Total | | **450** | **0** | **0** |

`web: npm run build`, mobile `tsc --noEmit`, and Edge `npm run typecheck` pass.
The production build retains only the known chunk-size advisory. Migration 0038 passed
36/36 linked rollback checks before atomic application; its live posture was read back.

After the release-candidate commit, the mobile dependency manifest was aligned with the
Expo SDK 57 patch set and `expo-font` was registered as a config plugin. The focused
post-alignment gate passed on 2026-09-10: Expo Doctor **21/21**, mobile tests **218/218**,
and mobile `tsc --noEmit` clean. This changes dependency/native configuration only; it
does not satisfy the physical-device checklist below.

## Security audit

Live catalog inspection found RLS enabled on every public table and a fixed search path
on every SECURITY DEFINER function. The browser/mobile bundles use only the anon key;
service credentials remain in Edge Functions. Reviewed matrices cover inactive accounts,
BHW barangay scope, midwife denial, TB-DOTS facility scope, admin clinical denial,
cross-facility access, immutable identifiers, case/timeline/dashboard/audit boundaries,
and function ACLs.

Non-High findings carried forward:

- **S7-01 MEDIUM — device data at rest.** Clinical SQLite and the persisted Supabase
  session are app-sandboxed but not application-level encrypted. Safe sign-out wipes the
  clinical cache and tests protect pending rows from accidental deletion. Production
  operations need managed-device PIN/biometric and remote-wipe controls, or a future
  encrypted cache/session design.
- **S7-02 LOW — legacy broad table grants.** `anon`/`authenticated` retain Supabase-style
  table privileges. RLS is enabled everywhere, clients cannot issue SQL/TRUNCATE, and no
  callable RPC turns this into a row leak. Narrow grants only in a dedicated migration
  with a full role matrix.
- **D6-01 MEDIUM — audit retention.** No automatic purge for this release candidate.
  Health-office retention/archive approval is required before real production use.
- **C50-01 MEDIUM — destination list scale.** Dashboard aggregation is bounded, while
  some destination lists remain unpaginated. Acceptable at current capstone volume; not
  for large rollout.

## Regression and offline evidence

Automated coverage verifies login failure/success states, forced password change order,
deactivation/role refusal, patient registration, checklist referral rules, facility
walk-in single-RPC submission, referral/result workflows, scheduling/attendance,
three-locale key parity, case/treatment transitions, timeline isolation, dashboard
predicates, audit paging, sync error isolation, tied-timestamp pull recovery, pending-row
sign-out protection, and clinical-cache deletion after confirmed sign-out.

Physical Android checklist — **PASSED by user attestation on 2026-09-10**:

1. [x] Sign in as a dedicated BHW test account and sync once online.
2. [x] Enable airplane mode; create patient, screening, referral, and appointment.
3. [x] Confirm all four remain visible and pending after force-close/reopen.
4. [x] Reconnect; wait for auto-sync, then confirm all rows land once and become synced.
5. [x] Create an intentional permanent rejection and confirm later rows still sync while the
   rejected row remains pending with a partial-failure message.
6. [x] Trigger a reconnect during a sync and confirm serialization/rerun, not two passes.
7. [x] Cancel sign-out with pending work and confirm the cache remains. Then sync, sign out,
   sign in as another test account, and confirm the prior clinical cache is absent.

Native-speaker review of the Tagalog and Cebuano user-facing copy — **PASSED by user
attestation on 2026-09-10**.

## Walk-in atomicity

Resolved by migration 0032. The portal sends one `register_walkin()` request with stable
request/patient/screening/referral IDs. The function writes all records and its replay
record in one transaction. The 18/18 linked matrix proves rollback, replay, payload
mismatch denial, role/facility scoping, and exact row counts.

## Demo data and defense flow

`supabase/seed_capstone_day7.sql` prepares seven visibly synthetic, non-SMS patients for:
screened/no referral; awaiting referral; registered case; active treatment journey;
attended follow-up; unresolved missed follow-up; and completed case. It dynamically uses
an existing active TB-DOTS facility, embeds no credential or real identity, and ends in
`ROLLBACK` by default. Its live-schema validation completed successfully and rolled back.

Defense story: BHW enrollment and checklist → referral → facility receipt/result → case
enrolment → treatment start → attended visit → unresolved missed visit → attention card
→ neutral SMS workflow explanation → complete patient timeline → dashboard counts →
facility audit trail. State explicitly that `sent` means provider acceptance, not handset
delivery, and that the software records clinical decisions rather than making them.
