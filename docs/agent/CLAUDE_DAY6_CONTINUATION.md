# Claude continuation brief — Day 6 audit and security unit

Use this brief only after reading `MASTER_PLAN.md`, `HANDOFF.md`, `CODEX_REVIEW.md`,
`ISSUES.md`, and the authoritative seven-day plan. The current branch is
`feature/capstone-upgrade`; Day 5 is committed and pushed at `becaede`. Migrations 0028
through 0037 are live. The only untracked file at handoff is
`docs/TB-Screen_Barangay_Report_Design_Canvas_Brief.md`; it belongs to the user and must not be
staged, edited, deleted, or folded into this unit.

## Outcome to deliver

Prepare the Day 6 implementation for Codex review:

1. close C41-02 so ordinary authenticated appointment status PATCHes create the same
   minimal audit evidence as RPC-driven changes, without double-logging RPC paths;
2. add a tightly scoped, paginated audit viewer for authorized facility staff if it can
   be done without widening clinical access;
3. change displayed SMS `sent` wording to "accepted by provider; delivery unknown" in
   English, Tagalog, and Cebuano, without changing stored states or retry behavior;
4. run a security review of the new audit surface and record every finding.

Task 6.5 is deferred. Read `CODEX_TASK_6.4_SMS_FEASIBILITY.md`; do not add provider
callbacks, delivery claims, or expanded retry behavior.

## Non-negotiable boundaries

- Use migration **0038** for database changes. Do not edit an applied migration.
- Do **not apply 0038 live** and do not mark it approved. Day 6's migration requires
  Codex review when the usage window resets. You may generate and run a rollback-only
  linked preflight if authorized, but preserve the output for review.
- `audit_logs` is server-written. Clients receive SELECT only; never grant INSERT,
  UPDATE, or DELETE.
- Never log passwords, tokens, contact numbers, patient names, clinical notes, symptom
  JSON, free-text lab results, positive/negative result values, or void reasons.
- Keep `app_private.write_audit()` private and the whitelist fail-closed. Re-run
  `scripts/verify-0035-whitelist.mjs` including all mutation self-tests after any change
  to the audit path.
- Facility staff may see only their facility's audit events. Do not use referral history
  or patient visibility to widen that boundary. Midwife and BHW receive no audit viewer.
- If an admin view is considered, prove that every exposed change key is non-clinical;
  otherwise ship the facility-only view and state the deferral.
- Preserve source truth: overdue is derived, missed is staff-recorded, and `sent` means
  provider acceptance only.
- Keep Priority B frozen and avoid mobile edits unless the appointment audit contract
  genuinely requires them. If mobile files become necessary, read `mobile/AGENTS.md`
  and its required Expo SDK documentation first.

## C41-02 implementation review points

Start by inventorying every appointment write and every explicit appointment
`write_audit()` call in migrations 0031–0037 and both clients. Choose one authoritative
event path. A generic trigger added on top of existing RPC audit calls is unacceptable
because it duplicates events.

If using a transaction-local skip flag, prove all of the following:

- every RPC sets the flag before the appointment mutation it explicitly audits;
- ordinary PostgREST PATCH cannot set or spoof the flag;
- the flag cannot suppress a later unrelated update in the same transaction;
- failure rolls the flag and audit row back with the business mutation;
- multi-row updates produce one whitelisted event per changed appointment;
- no-op updates produce no audit event;
- only status, scheduled/attended date, facility/link ownership, and other already
  approved keys are emitted.

Prefer a small transcription verifier if applied function bodies must be restated.
Its mutation self-tests must demonstrate that it catches a missing skip flag or a changed
audit call, not merely print success on the real file.

## Audit viewer contract

Use a bounded server query or keyset-paginated RLS read; do not download the whole audit
table and filter it in the browser. Stable order should be `occurred_at desc, audit_id desc`.
Show actor role/identifier, action, entity type, timestamp, and a whitelisted human-readable
summary. Do not render raw JSON. Include loading, empty, error/retry, pagination, and locale
states. Add the navigation item only for the role whose access matrix passes.

## Required verification

The 0038 rollback matrix must include:

- direct facility appointment PATCH produces exactly one event;
- every RPC appointment path still produces exactly one event, never zero or two;
- no-op and rejected writes produce zero events;
- cross-facility, BHW, midwife, inactive and anon denial;
- allowed change-key exactness and explicit forbidden-key absence;
- facility A/B viewer isolation, empty facility, stable pagination ties;
- function/trigger security posture, ACLs, fixed search paths, and RLS enabled/forced as
  appropriate;
- regression of referral, case, follow-up, and timeline audit behavior.

Then run portal tests/build, mobile tests/typecheck, edge tests/typecheck, `git diff
--check`, and corruption scans. Update `CLAUDE_STATUS.md` with files, migration state,
test counts, unresolved findings, and an explicit "NOT APPLIED; AWAITING CODEX REVIEW".
Commit and push the reviewable unit, excluding the user's design brief.
