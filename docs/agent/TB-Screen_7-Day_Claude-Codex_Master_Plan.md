# TB-Screen System — 7-Day Capstone Upgrade Plan

> **Gate status — 2026-09-10:** Migrations 0028 through 0033 are approved and applied, and BASE-01 through BASE-06 are closed. Migration 0032's atomic walk-in RPC passed 18/18 live checks. Migration 0033's legacy-upsert compatibility boundary passed 13/13 live checks, followed by a disposable authenticated BHW run at 9/9 and `GATE: CLOSED`. The web/mobile/SMS appointment ownership client contract is implemented; full regression is 402/402 with build and typechecks passing. The seven-day Priority A finish remains achievable only with Priority B frozen and the remaining units completed in the recovery sequence below. See `HANDOFF.md` and `CODEX_REVIEW.md`.

**Project:** TB-Screen System  
**Repository:** `https://github.com/nielarcenal/tb-screen-system`  
**Primary Builder:** Claude Code  
**Review / QA / Security:** Codex  
**Timebox:** 7 days

## Goal

Upgrade the current system from:

> BHW pre-screening → referral → TB-DOTS facility → laboratory outcome → appointment follow-up

into:

> Patient registry → pre-screening → referral → facility assessment → TB case management → treatment monitoring → follow-up → missed-visit intervention → treatment outcome → program analytics

Do **not** attempt to clone DOH ITIS. Preserve the principle that TB-Screen supports screening, referral, and case management but does not diagnose TB or replace clinical judgment.

---

# 1. Non-Negotiable Architecture Rules

1. `main` must remain deployable.
2. Do not remove or weaken existing Supabase RLS.
3. Do not disable authorization checks to make a feature work.
4. Never edit an already-applied migration.
5. Every schema change requires a new sequential migration.
6. Claude Code is the **only agent allowed to create Supabase migrations** unless explicitly instructed otherwise.
7. Codex reviews migrations but does not create competing migrations.
8. Preserve the existing offline-first mobile architecture.
9. Preserve the existing sync engine unless a task explicitly requires changes.
10. Preserve role, facility, and barangay scoping.
11. Preserve existing screening and referral rules.
12. Do not introduce AI diagnosis, probability scores, or unsupported clinical risk scoring.
13. Do not expose TB-specific information in SMS beyond the existing privacy policy.
14. Do not perform unrelated refactoring during the sprint.
15. Do not rename major tables or components merely for style.
16. Never commit secrets, API keys, service-role keys, tokens, or `.env` files.
17. Every major feature requires tests.
18. Every major implementation unit requires review before the next one starts.
19. Never overwrite uncommitted work created by the other agent.
20. If a frontend/backend contract changes, update both sides in the same implementation task.

---

# 2. Agent Roles

## Claude Code — Primary Implementation Agent

Claude owns:

- feature implementation
- schema changes and migrations
- database/RPC functions
- RLS policies for new data
- frontend/backend integration
- web UI work
- mobile changes when required
- tests for implemented features
- implementation documentation

Claude must stop after each major work unit and create a review handoff.

## Codex — Review, QA, Security, and Regression Agent

Codex owns:

- code review
- migration review
- RLS/security review
- regression analysis
- frontend/backend contract review
- test coverage review
- TypeScript review
- data-integrity review
- offline/sync risk review
- accessibility/usability observations
- documentation consistency checks

Codex should **not modify the implementation by default**.

Use severities:

- `CRITICAL`
- `HIGH`
- `MEDIUM`
- `LOW`
- `INFORMATIONAL`

---

# 3. Shared Coordination Files

Create:

```text
docs/agent/
├── MASTER_PLAN.md
├── CLAUDE_STATUS.md
├── CODEX_REVIEW.md
├── ISSUES.md
└── DECISIONS.md
```

### `MASTER_PLAN.md`
Shared source of truth. Both agents must read it before work.

### `CLAUDE_STATUS.md`
Claude updates after every work unit with:

- task completed
- files changed
- migrations created
- functions added
- RLS changes
- tests run
- test results
- known limitations
- items Codex should inspect
- commit hash

### `CODEX_REVIEW.md`
Codex writes findings in this format:

```text
Severity:
File:
Location:
Problem:
Impact:
Recommended fix:
```

### `ISSUES.md`
Only confirmed unresolved issues.

### `DECISIONS.md`
Architectural decisions such as:

- relationship choices
- treatment status vocabulary
- appointment linkage
- role permissions
- UI conventions
- deferred scope

---

# 4. Recommended Git / Worktree Setup

```text
tb-screen-system/
tb-screen-claude/
tb-screen-codex/
```

Example:

```bash
git worktree add ../tb-screen-claude -b feature/capstone-upgrade
git worktree add ../tb-screen-codex -b review/capstone-upgrade
```

Claude works in `tb-screen-claude` and makes checkpoint commits. Codex reviews those commits from `tb-screen-codex`.

Do not allow both agents to edit the same uncommitted working tree simultaneously.

---

# 5. Sprint Priorities

## Priority A — Must Finish

1. TB Case Registry
2. Treatment Monitoring
3. Follow-up / Appointment Integration
4. Patient Care Timeline
5. Attention Required Dashboard
6. Audit Trail
7. Regression, security, and deployment hardening

## Priority B — Only If Time Allows

1. SMS delivery-state improvements
2. SMS retry handling
3. Extra analytics
4. richer case filters
5. printable/exportable case summary

## Explicitly Out of Scope

- AI diagnosis
- AI risk scoring
- contact tracing
- patient-level geographic mapping
- pharmacy inventory
- billing
- full laboratory information system
- full DOH ITIS replication
- major authentication redesign
- major sync-engine rewrite
- unrelated visual redesigns

---

# DAY 1 — Architecture Freeze, Audit, and Schema Design

## Task 1.1 — Repository Baseline Audit

**Owner:** Codex  
**Type:** Review only  
**Priority:** Critical

Inspect:

```text
mobile/
web/
supabase/
docs/
```

Identify:

- current schema
- referral lifecycle
- appointment model
- laboratory-result fields
- SMS workflow
- role model
- RLS architecture
- offline/mobile dependencies
- relevant tests
- unfinished TODOs
- technical debt
- naming conventions

### Deliverable

Create:

```text
docs/agent/CODEX_BASELINE_AUDIT.md
```

### Acceptance Criteria

The audit clearly states:

- what current tables should be reused
- which new entities are truly required
- which flows must not be broken
- migration risks
- frontend integration points
- mobile impact

---

## Task 1.2 — Define TB Case Domain Model

**Owner:** Claude Code  
**Reviewer:** Codex  
**Priority:** Critical

Create a clean distinction between:

```text
Patient
Screening
Referral
TB Case
Treatment Follow-up
```

Potential new structures:

```text
tb_cases
treatment_followups
audit_logs
```

Potentially reuse:

```text
appointments
referrals
patients
screenings
sms_log
```

### Candidate TB Case Fields

```text
id
patient_id
referral_id
facility_id
case_status
diagnosis_or_confirmation_date
treatment_start_date
treatment_end_date
treatment_status
outcome
outcome_date
created_by
created_at
updated_at
```

Use only clinically appropriate fields supported by the project requirements. Do not invent DOH-specific fields unless verified.

### Acceptance Criteria

- one patient may have multiple cases over time
- each case is linked to one patient
- case may link to the originating referral
- facility ownership is explicit
- role access is documented
- lifecycle statuses are documented
- case status is not used as an AI diagnostic mechanism

---

## Task 1.3 — Define Follow-up Model

**Owner:** Claude Code  
**Reviewer:** Codex

Determine how treatment follow-up relates to the existing `appointments` model.

Preferred principle:

> Reuse the existing appointment system instead of creating a second scheduler.

Decide whether:

- `appointments` receives `tb_case_id`
- clinical follow-up notes need a separate table
- attendance remains in `appointments`
- treatment follow-up metadata lives separately

### Acceptance Criteria

No duplicate scheduling system is introduced.

---

## Task 1.4 — Architecture Review Gate

**Owner:** Codex

Review:

- normalization
- foreign keys
- delete behavior
- unique constraints
- role boundaries
- facility scoping
- barangay visibility
- privacy
- RLS feasibility
- support for multiple TB episodes
- compatibility with existing appointments

Claude must not implement the schema until Critical/High design issues are resolved.

---

# DAY 2 — TB Case Registry

## Task 2.1 — Database Migration

**Owner:** Claude Code  
**Reviewer:** Codex  
**Priority:** Critical

Create the next sequential migration.

Migration responsibilities:

- create case table(s)
- add foreign keys
- add indexes
- add constraints
- connect case to patient
- connect case to referral where appropriate
- connect case to facility
- define RLS
- add grants only where required

Review access for:

- admin
- BHW
- midwife
- TB-DOTS/facility staff
- service role

Do not assume every role should see treatment data.

---

## Task 2.2 — Case Creation Workflow

**Owner:** Claude Code

Facility staff should be able to create/open a TB case from the appropriate patient/referral workflow.

Requirements:

- prevent accidental duplicates
- preserve patient identity
- associate originating referral
- assign owning facility
- record actor
- validate allowed transitions
- show clear success/error feedback

---

## Task 2.3 — Case List

**Owner:** Claude Code

Minimum useful fields:

- patient
- case status
- facility
- treatment status
- latest follow-up
- next appointment
- attention indicator

Minimum filters:

- active
- completed/closed
- follow-up due
- missed follow-up

---

## Task 2.4 — Case Detail

**Owner:** Claude Code

Must show:

- patient identity
- originating screening/referral
- facility
- case state
- treatment state
- appointments/follow-ups
- outcome
- audit-relevant metadata

---

## Task 2.5 — Case Tests

**Owner:** Claude Code  
**Reviewer:** Codex

Test:

- successful case creation
- duplicate prevention
- invalid patient/referral
- role denial
- facility scoping
- status transitions
- RLS behavior

---

## Task 2.6 — Codex Review Gate

Codex reviews:

- migration safety
- schema integrity
- UI/backend contract
- RLS
- role scoping
- tests
- error handling
- regression risk

Claude fixes all Critical and High findings before Day 3.

---

# DAY 3 — Treatment Monitoring and Follow-up Integration

## Task 3.1 — Treatment Status Model

**Owner:** Claude Code  
**Reviewer:** Codex

Implement a minimal treatment lifecycle, for example:

```text
not_started
active
interrupted
completed
closed
```

Do not add unsupported medical terminology just to increase apparent complexity.

### Acceptance Criteria

- finite validated statuses
- invalid transitions prevented where reasonable
- understandable UI labels
- status changes are auditable

---

## Task 3.2 — Link Appointments to TB Case

**Owner:** Claude Code

If approved during Day 1:

- add `tb_case_id` or equivalent
- update create/read/update flows
- preserve existing appointments
- backfill only when safe
- do not break referral scheduling

### Acceptance Criteria

Existing appointment workflows continue to work.

---

## Task 3.3 — Follow-up Recording

**Owner:** Claude Code

Allow authorized facility staff to record follow-up information associated with a case.

Minimum useful data:

- appointment
- attendance state
- follow-up date
- notes if consistent with current policy
- treatment status after visit
- next follow-up if needed

Do not turn this into a full EMR.

---

## Task 3.4 — Missed Follow-up Detection

**Owner:** Claude Code

Logic:

```text
scheduled appointment
+
date has passed
+
attendance not completed
=
missed follow-up
```

Use Asia/Manila date handling correctly.

### Acceptance Criteria

No UTC/Manila rollover regression.

---

## Task 3.5 — Treatment / Follow-up Tests

Test:

- active case appointment
- attended follow-up
- missed follow-up
- rescheduled follow-up
- wrong-facility access
- closed case behavior
- timezone-boundary cases

---

## Task 3.6 — Codex Review Gate

Codex checks:

- appointment regressions
- Manila timezone handling
- race conditions
- duplicate follow-ups
- RLS
- treatment status integrity
- date handling
- nullable-field behavior

---

# DAY 4 — Patient Care Timeline

## Task 4.1 — Timeline Data Contract

**Owner:** Claude Code  
**Reviewer:** Codex

Timeline may combine:

- patient creation
- screening
- referral
- facility receipt
- lab result
- case creation
- treatment start
- appointments
- attendance
- missed follow-up
- relevant SMS events
- outcome

Do not duplicate source records just to populate the timeline. Build a read/aggregation model from existing records.

---

## Task 4.2 — Timeline UI

**Owner:** Claude Code

Example:

```text
Sep 01 — Patient enrolled
Sep 01 — TB pre-screening completed; referral criteria met
Sep 03 — Referral received by TB-DOTS facility
Sep 04 — Laboratory outcome recorded
Sep 05 — TB case created
Sep 06 — Treatment started
Sep 20 — Follow-up attended
Oct 04 — Follow-up missed
Oct 04 — Reminder sent
```

UI requirements:

- chronological
- readable on desktop
- clear status badges/icons
- no unnecessary clutter
- clear date/time
- actor/source where useful
- responsive

---

## Task 4.3 — Timeline Privacy Review

**Owner:** Codex

Check:

- no service-role-only information exposed
- no unnecessary SMS payload content exposed
- no role-based data leaks
- no bypass of normal patient scoping

---

## Task 4.4 — Timeline Tests

Test:

- empty timeline
- referral-only patient
- case with several follow-ups
- same-day events
- missing optional data
- closed case
- unauthorized user

---

# DAY 5 — Attention Required Dashboard and Analytics

## Task 5.1 — Define Operational Alerts

**Owner:** Claude Code  
**Reviewer:** Codex

Recommended categories:

```text
Missed follow-ups
Follow-ups due soon
Referrals awaiting facility action
Cases without recent follow-up
Appointments today
```

Do not use speculative risk scoring.

---

## Task 5.2 — Attention Required Dashboard

**Owner:** Claude Code

Example:

```text
ATTENTION REQUIRED

4 missed follow-ups
7 referrals awaiting action
3 appointments today
5 active cases without a recent follow-up
```

Each item should navigate to the appropriate filtered list.

---

## Task 5.3 — Program Overview Metrics

**Owner:** Claude Code

Useful metrics:

- screened
- referred
- referral received
- cases created
- active treatment cases
- follow-ups due
- missed follow-ups
- completed/closed cases

Use only metrics supported by current data.

---

## Task 5.4 — Query Performance Review

**Owner:** Codex

Review:

- excessive round trips
- N+1 queries
- missing indexes
- overfetching
- incorrect counts
- RLS performance
- unrestricted large queries

---

## Task 5.5 — Dashboard Tests

Test:

- no data
- one facility
- multiple facilities
- role/facility scoping
- date boundaries
- closed cases
- count accuracy
- navigation to filtered views

---

# DAY 6 — Audit Trail, SMS Review, and Security

## Task 6.1 — Audit Log Migration

**Owner:** Claude Code  
**Reviewer:** Codex  
**Priority:** High

Candidate structure:

```text
audit_logs

id
actor_user_id
actor_role
action
entity_type
entity_id
facility_id
metadata
created_at
```

Avoid storing unnecessary sensitive values.

---

## Task 6.2 — Audit Events

At minimum consider:

- case created
- case status changed
- treatment status changed
- appointment status changed
- outcome recorded
- major referral status changes
- sensitive account actions already in scope

Never log passwords, auth tokens, secrets, or unnecessary medical text.

---

## Task 6.3 — Audit Viewer

**Owner:** Claude Code

If feasible, add an authorized admin/facility view showing:

- actor
- action
- entity
- timestamp
- relevant context

Access must be tightly scoped.

---

## Task 6.4 — SMS Delivery-State Feasibility Review

**Owner:** Codex first

Inspect the current SMS provider implementation and determine whether it can safely support:

- accepted
- delivered
- failed
- retry

If delivery callbacks are unreliable or the change creates too much risk, defer it.

---

## Task 6.5 — SMS Delivery / Retry Improvement

**Owner:** Claude Code  
**Conditional:** Only if Task 6.4 says feasible

Possible states:

```text
queued
submitted
delivered
failed
```

Do not equate provider acceptance with handset delivery.

Add safe retry limits and prevent duplicate reminder spam.

---

## Task 6.6 — Security Audit

**Owner:** Codex  
**Priority:** Critical

Audit:

### Authentication

- first-password-change handling
- inactive accounts
- session handling

### Authorization

- BHW scope
- midwife scope
- TB-DOTS/facility scope
- admin scope

### Database

- RLS
- SECURITY DEFINER functions
- grants
- immutable fields
- cross-facility leakage
- public access

### Application

- patient privacy
- error-message leakage
- service-role usage
- SMS-log exposure
- sensitive data in browser/mobile storage

### New Features

- case access
- treatment access
- audit access
- timeline access
- dashboard counts

All Critical/High findings must be resolved before release.

---

# DAY 7 — Regression, Hardening, Documentation, and Demo

## Task 7.1 — Full Automated Test Run

**Owner:** Claude Code

Record:

```text
command
test count
pass count
fail count
skipped count
```

No unexplained failures may remain.

---

## Task 7.2 — Regression Audit

**Owner:** Codex

Verify:

- login
- forced password change
- account deactivation
- BHW patient registration
- screening
- referral generation
- referral receipt
- laboratory outcome
- facility walk-in registration
- appointment scheduling
- attendance
- SMS scheduling
- multilingual UI
- facility restrictions
- barangay restrictions
- admin functions
- mobile offline behavior
- sync

---

## Task 7.3 — Mobile Offline / Sync Verification

**Owner:** Claude Code  
**Reviewer:** Codex

Test:

- offline data entry
- queued changes
- reconnect
- pull
- push
- conflicts
- failed rows
- logout
- clinical-cache cleanup

Do not change sync unless actually required.

---

## Task 7.4 — Transactional Walk-In Registration Review

**Owner:** Codex

Check whether facility walk-in registration can currently leave partial records.

If it still performs independent writes for:

```text
patient
screening
referral
```

then Claude should convert it to an atomic transaction/RPC where safe.

Acceptance: all records succeed together or all fail together.

---

## Task 7.5 — Documentation Reconciliation

**Owner:** Claude Code  
**Reviewer:** Codex

Update:

- migration count
- schema documentation
- role permissions
- case workflow
- treatment/follow-up workflow
- audit model
- timeline
- dashboard metrics
- known limitations
- deferred scope

Documentation must match the actual repository.

---

## Task 7.6 — Demo Dataset

**Owner:** Claude Code

Prepare synthetic records for:

1. screened, no referral
2. referred patient awaiting facility action
3. registered TB case
4. active treatment case
5. attended follow-up
6. missed follow-up
7. completed/closed case

Never use real patient data in the capstone demo.

---

## Task 7.7 — Defense Demo Flow

Prepare one clean end-to-end story:

```text
1. BHW registers patient
2. BHW performs screening
3. Referral is generated
4. TB-DOTS facility receives referral
5. Facility records result/assessment
6. TB case is created
7. Treatment begins
8. Follow-up is scheduled
9. One follow-up is attended
10. Another is missed
11. System marks attention required
12. SMS follow-up workflow is demonstrated
13. Patient timeline shows the complete journey
14. Dashboard updates
15. Audit trail proves who changed what
```

---

# 6. Review Protocol After Every Major Task

## Claude

1. Run relevant tests.
2. Inspect `git diff`.
3. Commit the work.
4. Update `docs/agent/CLAUDE_STATUS.md`.
5. Stop.

## Codex

1. Review Claude's checkpoint commit.
2. Inspect changed files.
3. Inspect migrations/RLS where applicable.
4. Run relevant tests.
5. Write `docs/agent/CODEX_REVIEW.md`.
6. Stop.

## Claude After Review

1. Read Codex review.
2. Fix `CRITICAL` issues.
3. Fix `HIGH` issues.
4. Address `MEDIUM` where practical.
5. Document deferred `LOW` findings.
6. Run tests.
7. Commit.

---

# 7. Severity Rules

## CRITICAL

Examples:

- patient-data leak
- RLS bypass
- cross-facility access
- destructive migration
- production data corruption
- authentication bypass
- system unusable

Must be fixed immediately.

## HIGH

Examples:

- incorrect case ownership
- duplicate records
- broken appointment workflow
- incorrect treatment status
- offline-sync regression
- incorrect timezone handling

Must be fixed before the next major feature.

## MEDIUM

Examples:

- incomplete validation
- weak error handling
- performance concern
- confusing workflow
- missing test

Fix during the sprint where practical.

## LOW

Examples:

- cosmetic issue
- small refactor opportunity
- minor naming inconsistency

Defer if the deadline is tight.

---

# 8. Definition of Done

The sprint is successful when:

- [ ] existing BHW pre-screening still works
- [ ] existing referral workflow still works
- [ ] TB-DOTS staff can create/manage a TB case
- [ ] treatment state can be tracked
- [ ] appointments/follow-ups connect to the case
- [ ] missed follow-ups can be identified
- [ ] patient care timeline works
- [ ] dashboard highlights actionable items
- [ ] important case/treatment changes are auditable
- [ ] RLS remains intact
- [ ] no role/facility/barangay data leak exists
- [ ] mobile/offline workflow still works
- [ ] SMS remains privacy-safe
- [ ] automated tests pass
- [ ] documentation matches production code
- [ ] synthetic demo flow is ready

---

# 9. If the Schedule Slips

Cut features in this order:

### Cut First

1. SMS delivery callbacks
2. SMS retry system
3. advanced analytics
4. extra filters
5. audit viewer UI

### Keep No Matter What

1. TB Case Registry
2. Follow-up integration
3. Treatment status
4. Patient Care Timeline
5. Attention Required dashboard
6. RLS/security
7. regression testing

---

# 10. Claude Code Startup Prompt

Paste into Claude Code:

```text
You are the PRIMARY IMPLEMENTATION AGENT for the TB-Screen System 7-day capstone upgrade.

Read:
- docs/agent/MASTER_PLAN.md
- docs/agent/CODEX_REVIEW.md if it exists
- docs/agent/DECISIONS.md if it exists

Before doing anything:
1. Inspect git status.
2. Inspect the current architecture.
3. Confirm the exact task number from MASTER_PLAN.md.
4. Do not work beyond the assigned task.

You own implementation, database migrations, backend changes, frontend integration, tests, and implementation documentation.

You are the ONLY agent allowed to create Supabase migrations unless explicitly told otherwise.

Never:
- weaken RLS
- disable authorization
- edit already-applied migrations
- rewrite the offline architecture
- introduce AI diagnosis/risk scoring
- expose secrets
- perform unrelated refactors
- overwrite uncommitted work belonging to another agent

At the end of each work unit:
1. run relevant tests
2. inspect git diff
3. commit the work
4. update docs/agent/CLAUDE_STATUS.md
5. stop and report that the task is ready for Codex review
```

---

# 11. Codex Startup Prompt

Paste into Codex:

```text
You are the REVIEW, QA, SECURITY, AND REGRESSION AGENT for the TB-Screen System 7-day capstone upgrade.

Read:
- docs/agent/MASTER_PLAN.md
- docs/agent/CLAUDE_STATUS.md
- docs/agent/DECISIONS.md if it exists

Before reviewing:
1. inspect git status
2. identify Claude's latest checkpoint commit
3. inspect the relevant diff first
4. expand into related code only where necessary

Your default job is REVIEW, not implementation.

Review for:
- correctness
- regressions
- database integrity
- migration safety
- RLS
- authorization
- role/facility/barangay scoping
- frontend/backend contract mismatches
- TypeScript errors
- offline/sync risk
- timezone bugs
- privacy leaks
- race conditions
- missing validation
- test gaps
- documentation mismatch

Do not:
- create Supabase migrations
- revert Claude's implementation
- weaken RLS
- perform unrelated refactors
- expose secrets
- modify implementation unless explicitly instructed

Write findings to:
docs/agent/CODEX_REVIEW.md

Classify findings:
CRITICAL
HIGH
MEDIUM
LOW
INFORMATIONAL

For every issue include:
Severity:
File:
Location:
Problem:
Impact:
Recommended fix:

If no significant problem exists, explicitly record PASS.
```

---

# 12. Daily Checklist

## Recovery sequence — 2026-09-10 through 2026-09-16

This is the critical path for a seven-calendar-day finish. It is aggressive but still
credible because the schema, lifecycle RPCs, RLS, audit storage, atomic walk-in path,
and appointment compatibility/client foundations are already complete.

- **Sep 10:** foundations, compatibility gate, and appointment client contract — complete.
- **Sep 11:** case creation, facility case list/filtering, case detail, focused tests.
- **Sep 12:** treatment lifecycle actions, follow-up/visit recording, missed logic, tests.
- **Sep 13:** longitudinal timeline contract, UI, tests, privacy review.
- **Sep 14:** attention-required dashboard, metrics, query review, tests.
- **Sep 15:** audit viewer/access checks, security and performance pass; resolve all Highs.
- **Sep 16:** full regressions, device/offline smoke, demo data/rehearsal, release checkpoint.

Cut rule: if a Priority A unit slips, remove Priority B work immediately; do not compress
the Sep 16 regression and demo gate.

## Day 1

- [x] baseline audit
- [x] TB case model
- [x] follow-up relationship model
- [x] architecture review passed

## Day 2

- [x] TB case migration
- [x] RLS
- [ ] case creation
- [ ] case list/detail
- [ ] tests
- [ ] Codex review passed

## Day 3

- [ ] treatment status
- [ ] appointment/case integration
- [ ] follow-up recording
- [ ] missed follow-up logic
- [ ] timezone tests
- [ ] Codex review passed

## Day 4

- [ ] timeline contract
- [ ] timeline UI
- [ ] timeline tests
- [ ] privacy review passed

## Day 5

- [ ] attention-required rules
- [ ] dashboard section
- [ ] operational metrics
- [ ] query-performance review
- [ ] dashboard tests

## Day 6

- [ ] audit-log migration
- [ ] audit events
- [ ] audit access control
- [ ] SMS feasibility review
- [ ] security audit
- [ ] Critical/High findings resolved

## Day 7

- [ ] full tests pass
- [ ] regression review
- [ ] mobile/offline verification
- [ ] walk-in registration integrity review
- [ ] documentation updated
- [ ] demo dataset ready
- [ ] defense demo flow rehearsed
- [ ] release candidate committed/tagged

---

# Final Rule

The goal is **not maximum feature count**.

The goal is:

> **A stable, secure, demonstrable, longitudinal TB care workflow built on top of the system that already works.**

Do not sacrifice backend integrity, privacy, offline reliability, RLS, or the current referral workflow merely to complete another feature.
