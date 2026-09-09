# Task 4.1 — Patient Care Timeline data contract (design for review)

Owner: Claude Code. Reviewer: Codex.
**Revision 1 — 2026-09-10.** Baseline: branch `feature/capstone-upgrade` at `939ce5f`, with migrations 0028–0033 applied.
Status: **not implemented.** No migration, no schema, no application code. This document is the contract Task 4.2 (UI), 4.3 (privacy review) and 4.4 (tests) build against.

Depends on [Task 1.2](CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md) and [Task 1.3](CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md) §6, which pinned the timeline as a read-time aggregation and forbade an event table.

**Written off the critical path on purpose.** Codex holds uncommitted work in `web/src`
(the case registry UI, Tasks 2.2–2.5). Rule 19 forbids touching it, so this unit is
docs-only and shares no file with that work.

---

## 0. What is already decided, and what this document is allowed to choose

Three prior decisions bound this design before it starts:

| Pinned | Where |
| --- | --- |
| The timeline is a **query, not a table**. No presentation-layer event rows are written. | D-1.3-i, Task 1.3 §6 |
| It authorizes **patient and case independently** — seeing a patient never implies seeing another facility's episode. | D-1.3-i |
| It **excludes voided follow-ups** and never returns `notes`, `referrals.result`, `contact_number`, or SMS payload. | D-1.3-i, D-1.3-p, Task 1.3 §6 |

What is left to choose, and what this document decides: the event vocabulary, where each
event's time actually comes from, how a stream of calendar dates and instants is ordered
deterministically, the shape of the function, and which of the plan's listed events the
schema **cannot currently supply**. That last one is the finding that matters; §2 is the
part to review first.

---

## 1. The event catalogue

Eighteen event types across six source tables. Every column named below exists today; no
event is invented for symmetry.

`occurred_on` is the Manila calendar date the event is displayed and sorted on.
`occurred_at` is the instant, where one is recorded — it is **nullable**, and §3 explains
why that is a property of the schema rather than an omission.

| # | Event type | Source | `occurred_on` | `occurred_at` | Actor | Payload beyond the type |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `patient_enrolled` | `patients` | `created_at` → Manila date | `created_at` | `enrolled_by` | — |
| 2 | `screening_recorded` | `screenings` | `created_at` → Manila date | `created_at` | **none recorded** | `referred` (boolean) |
| 3 | `referral_submitted` | `referrals` | `created_at` → Manila date | `created_at` | **none recorded** | facility name + `short_code` |
| 4 | `referral_received` | `referrals.status` | **unavailable** | **unavailable** | — | see §2 |
| 5 | `lab_result_recorded` | `referrals.result_date` | `result_date` → Manila date | `result_date` | — | **presence only** — never the text |
| 6 | `patient_did_not_present` | `referrals.presented = false` | **unavailable** | **unavailable** | — | see §2 |
| 7 | `referral_closed` | `referrals.status = 'closed'` | **unavailable** | **unavailable** | — | see §2 |
| 8 | `case_registered` | `tb_cases` | `registration_date` | `created_at` | `created_by` | `case_number`, facility |
| 9 | `treatment_started` | `tb_cases.treatment_start_date` | `treatment_start_date` | audit `occurred_at`, else null | audit actor, else null | — |
| 10 | `case_status_changed` | `audit_logs` (`tb_cases`, `status_changed`) | `occurred_at` → Manila date | `occurred_at` | `actor_user_id` | `case_status` from → to |
| 11 | `case_transferred` | `audit_logs` (`tb_cases`, `transferred`) | `occurred_at` → Manila date | `occurred_at` | `actor_user_id` | receiving facility name |
| 12 | `case_closed` | `tb_cases.outcome_date` | `outcome_date` | audit `occurred_at`, else null | audit actor, else null | `outcome` (one of the six) |
| 13 | `appointment_scheduled` | `appointments` | `created_at` → Manila date | `created_at` | **none recorded** | `scheduled_date`, facility |
| 14 | `appointment_attended` | `appointments.attended_date` | `attended_date` | **none** | — | — |
| 15 | `appointment_missed` | `appointments.status = 'missed'` | `scheduled_date` (see §2) | **none** | — | — |
| 16 | `appointment_cancelled` | `appointments.status = 'cancelled'` | audit `occurred_at` → date, else `scheduled_date` | audit `occurred_at`, else null | audit actor, else null | — |
| 17 | `followup_recorded` | `treatment_followups` where `voided_at is null` | `visit_date` | `created_at` | `recorded_by` | — |
| 18 | `sms_sent` | `sms_log` | `sent_at` → Manila date | `sent_at` | system | `message_kind`, `delivery_status` |

Three notes on the catalogue itself:

- **Events 2, 3 and 13 have no actor column.** `screenings`, `referrals` and the
  pre-0031 columns of `appointments` record no `created_by`. The plan asks for
  "actor/source where useful"; for these three the honest answer is the source table, not
  a person. The contract returns `actor_user_id = null` rather than inferring one from
  `patients.enrolled_by`, which would be a guess displayed as a fact.
- **Event 5 carries no result.** `referrals.result` is free text typed by facility staff.
  Task 1.3 §6 already forbids returning it, and the reason is worth restating: free text
  cannot be classified, so a timeline that displayed it would be publishing an
  unvalidated clinical statement into a screen that reads as a record. The event says an
  outcome was recorded and on what date; the result itself stays on the referral screen,
  behind that screen's own RLS.
- **Event 17 is the follow-up, not its notes.** `treatment_followups.notes` is the same
  class of free text and is excluded for the same reason.

---

## 2. Five events the schema cannot currently timestamp

This is the finding. The plan's Task 4.1 list includes "facility receipt" and "missed
follow-up" as timeline entries. **Three of the five referral/appointment transitions it
implies carry no timestamp at all**, and two more are only partially covered.

### 2.1 What is actually missing

`referrals` records `status` as a single mutable column with `created_at`, `updated_at`,
`result_date` and `presented`. There is no `received_at`, no `closed_at`, and no
`presented_recorded_at`. A referral that has been received, tested and closed has
**one** `updated_at`, which names the most recent write of any kind. So:

| Transition | Why it cannot be dated |
| --- | --- |
| `referral_received` (#4) | No column. `updated_at` is the last write of any kind, not this one. |
| `patient_did_not_present` (#6) | Same. `presented = false` is a state with no time. |
| `referral_closed` (#7) | Same. |

`audit_logs` does not rescue these: its `entity_table` CHECK admits only `tb_cases`,
`treatment_followups` and `appointments`. Referrals are outside the audit surface by
construction.

Appointments are covered only in part. `audit_logs` receives an appointment row **only
from the 0031 RPC paths** — `set_tb_case_status`, `claim_unassigned_appointment`,
`assign_appointment_to_case`, `record_visit`, `correct_followup_visit_date`. Marking an
appointment `attended` or `missed` through the ordinary PostgREST `PATCH` that both
clients use today writes **no audit row**. So:

| Transition | Coverage |
| --- | --- |
| `appointment_missed` (#15) | Never audited. No `missed_at` column. |
| `appointment_cancelled` (#16) | Audited *only* when cancelled by `set_tb_case_status`; a direct PATCH is invisible. |

### 2.2 The decision

**Do not add columns in this sprint, and do not fabricate dates.** Two options were
considered and one is taken.

*Rejected:* add `received_at`, `closed_at`, `presented_at` to `referrals` and
`missed_at`, `cancelled_at` to `appointments` as migration 0034. It is five nullable
columns and a backfill that cannot be backfilled — every existing row would get NULL or an
`updated_at` guess, and a guess written into a column named `received_at` becomes
indistinguishable from a fact within one release. It also reopens `appointments` and
`referrals` for writes from both clients, which is rule 20 territory on Day 4 of a
seven-day sprint.

*Taken:* the contract distinguishes **dated events** from **undated state**, and the
function returns both, marked.

- Events 4, 6 and 7 are returned with `occurred_on = null` and a flag
  `is_undated boolean`. The UI (Task 4.2) renders them in a short "Recorded, date
  unknown" group **below** the dated stream, never interleaved at a guessed position.
- Event 15 (`appointment_missed`) uses `scheduled_date` as `occurred_on` and sets
  `occurred_on_is_derived = true`. A missed appointment is missed *on the day it was
  scheduled* — that is a definition, not an approximation, and it is the same date the
  attention dashboard (Task 5.1) will count. It is flagged anyway so the UI can avoid
  implying someone recorded it that day.
- Event 16 (`appointment_cancelled`) uses the audit instant when one exists, and falls
  back to `scheduled_date` with `occurred_on_is_derived = true` otherwise.

This costs the timeline three of eighteen event types as precisely-placed entries, and it
is the correct cost. **The alternative was a screen that shows a date the database never
recorded.** The five columns are the right fix and belong in the Priority B backlog with
a forward-only policy — new transitions dated, historical rows honestly null — not in a
Day 4 aggregation task.

---

## 3. Ordering: dates and instants in one stream

Six of the eighteen events are anchored to a `date` (`registration_date`,
`treatment_start_date`, `outcome_date`, `attended_date`, `visit_date`, `scheduled_date`)
and eleven to a `timestamptz`. They are not comparable, and casting the dates to
midnight-Manila to force comparability would sort a case registered today *before* the
screening recorded at 09:00 the same morning.

**The sort key is `(occurred_on, rank, occurred_at nulls last, event_id)`.**

`occurred_on` is a Manila calendar date for every event, produced by the same expression
`manila_today()` uses (`at time zone 'Asia/Manila'`) for instant-anchored events and used
directly for date-anchored ones. This is the civil calendar the barangay report was
corrected onto in 0030 (BASE-04); the timeline must not introduce a second one.

`rank` is a fixed integer per event type, resolving same-day ties into clinical order
rather than insertion order. Task 4.4 requires a same-day test, and without a rank that
test is asserting whatever the planner happened to return:

```text
 10  patient_enrolled
 20  screening_recorded
 30  referral_submitted
 40  referral_received
 50  lab_result_recorded
 55  patient_did_not_present
 60  referral_closed
 70  case_registered
 80  treatment_started
 90  appointment_scheduled
100  sms_sent
110  appointment_attended
115  appointment_missed
118  appointment_cancelled
120  followup_recorded
130  case_status_changed
140  case_transferred
150  case_closed
```

`occurred_at` breaks ties within a rank where both events have an instant; `nulls last`
keeps instant-less events after dated ones. `event_id` (§5.1) makes the order **total**,
so two runs of the same query cannot disagree — which is what makes the same-day test
meaningful rather than flaky.

Ordering is **ascending** in the contract. The UI may reverse it; the function must not
return two orders depending on a parameter, because then the tie-break rules have to hold
in both directions and only one of them gets tested.

---

## 4. Authorization: two arms, checked independently

The function is `SECURITY DEFINER`, so RLS does not run. Every check below is therefore
written explicitly, and the design's whole safety argument is that the two arms are
evaluated **separately** and combined per event, never once per call.

### 4.1 The patient arm — may the caller see this person at all?

Reusing the existing helpers rather than restating their predicates:

| Active role | Patient arm |
| --- | --- |
| `bhw` | `p_patient_id in (select app_private.bhw_visible_patient_ids())` |
| `tb_dots` | `p_patient_id in (select app_private.referred_patient_ids())` **or** `patients.enrolled_by = auth.uid()` |
| `midwife` | **denied** — no `patients` SELECT policy exists for this role |
| `admin` | **denied** — same |
| inactive / no role | denied by `current_user_active_role()` returning null |

Midwife and admin are denied deliberately, and this is not an oversight to be "fixed"
during review. Neither role has a `patients` read policy today; granting the timeline to
them would hand a role that cannot read a patient row a chronological account of that
patient's TB care through a `SECURITY DEFINER` side door. That is the shape R2-05
rejected when it withdrew the admin resolution queue.

### 4.2 The case arm — may the caller see *this episode*?

Events 8–12 and 17 belong to a `tb_cases` row. The patient arm does not authorize them.
A BHW whose barangay includes the patient may see that a case exists — 0031 already grants
exactly that through `bhw_case_summary()` — but not another facility's follow-up record.

| Active role | Case-derived events |
| --- | --- |
| `tb_dots` | `case_id in (select app_private.own_facility_case_ids())` — full detail |
| `bhw` | **summary only**: `case_registered`, `treatment_started`, `case_closed`. No `followup_recorded`, no `case_status_changed`, no `case_transferred`. |
| others | already denied by the patient arm |

The BHW subset is exactly what `bhw_case_summary()` already discloses (status, facility,
registration date) plus the two lifecycle dates that make a timeline legible. It adds no
column that role cannot already read.

**A transferred case is the test of this arm.** After `transfer_tb_case()`, the losing
facility fails `own_facility_case_ids()` and its staff stop seeing the episode's events —
including the follow-ups they themselves recorded. That is correct, and it is a behaviour
change worth naming now, because it will look like a bug the first time it is seen. The
receiving facility sees the whole episode, including the earlier facility's entries, which
is the point of a transfer.

### 4.3 Denial is indistinguishable from absence

An unauthorized call and a call for a patient uuid that does not exist must produce the
**same** result. Otherwise the function is an existence oracle: try uuids, watch which
ones behave differently, learn which patients exist.

Both return **zero rows**, not an exception. This differs from the 0031 mutation RPCs,
which raise `42501` through `app_private.deny()`, and the difference is deliberate: a
mutation must fail loudly because the caller believes it changed something, whereas a
read that returns nothing has told the truth — "you have no timeline for this id."

The consequence is that an empty timeline and a denied timeline are the same response, so
**the client cannot render "access denied"** from this call. Task 4.4's "empty timeline"
and "unauthorized user" cases therefore assert the same thing, and the test must say so
in a comment, or a later reader will treat the duplication as a copy-paste error and
delete one of them.

### 4.4 No enumeration

`p_patient_id` is required. There is no "all patients" mode, no default, and no
list-patients-with-timelines companion. D-1.3-i's reasoning applies unchanged: a function
in `public` that returns other people's row ids has no policy standing between it and
PostgREST.

---

## 5. The shape

```sql
create or replace function public.patient_timeline(
  p_patient_id uuid,
  p_limit      int default 500
)
returns table (
  event_id               text,        -- stable synthetic key, §5.1
  event_type             text,        -- the closed vocabulary of §1
  occurred_on            date,        -- null only for the undated events of §2
  occurred_at            timestamptz, -- null where the schema records no instant
  is_undated             boolean,
  occurred_on_is_derived boolean,
  rank                   int,
  actor_user_id          uuid,
  actor_role             text,
  facility_id            uuid,
  facility_name          text,
  case_id                uuid,        -- null for pre-case events
  detail                 jsonb        -- §5.2, whitelisted
)
language sql
stable
security definer
set search_path = public
```

Granted to `authenticated`; revoked from `public`, `anon` and `service_role` **by name**,
per M28-01 — Supabase's default privileges grant EXECUTE to `anon` and `service_role`
by name, so a bare `revoke … from public` leaves both standing.

### 5.1 `event_id` is synthetic and stable

`event_type || ':' || source_row_id`. Two events can come from one row (a case supplies
`case_registered`, `treatment_started` and `case_closed`), so the source uuid alone is not
unique. It is `text`, not `uuid`, because it is not a row identifier — nothing can be
fetched by it, and typing it as a uuid would invite exactly that.

Its job is the total order in §3 and React keys in Task 4.2. It must be stable across
calls: same event, same id, so the UI does not remount every row on refresh.

### 5.2 `detail` is a whitelist, not a row dump

`jsonb`, and the only keys the function may emit:

| Event | Keys |
| --- | --- |
| `screening_recorded` | `referred` |
| `referral_submitted` | `facility_short_code` |
| `case_registered` | `case_number` |
| `case_status_changed` | `from_status`, `to_status` |
| `case_closed` | `outcome` |
| `appointment_scheduled` | `scheduled_date` |
| `sms_sent` | `message_kind`, `delivery_status` |
| all others | `{}` |

Everything else is `{}`. The audit whitelist trigger (0031) exists because a free-form
`jsonb` column is where clinical text leaks in unannounced; the same reasoning applies to
a `jsonb` column on the way *out*, and this one has no trigger to catch it. **The
whitelist is enforced by the function body containing no other key, and by a test that
asserts the union of emitted keys across a populated fixture.** That test is the only
thing standing between this design and a future `select row_to_json(r)`.

`symptom_flags` and `pgis_severity` are not here. A timeline is a care record, not a
symptom viewer, and `pgis_severity` in particular is the column the whole system is at
pains to keep away from anything that reads as clinical judgement.

### 5.3 `p_limit` and the bound

A patient on a full six-month regimen with monthly visits produces on the order of
50–80 events; a relapse case with history might reach 150. `p_limit` defaults to 500,
caps at 1000, and applies **after** ordering, taking the *oldest* 500 — a truncated
timeline that silently drops the beginning of care would misrepresent the record more than
one that drops recent events the user can find elsewhere.

If the limit is hit, the last row is not a marker; the client compares the returned count
to `p_limit`. A sentinel row inside a typed event stream is a value that means something
other than what its type says, which is how a renderer ends up with a special case.

---

## 6. Cost

One call, eight sources, all reached by an index that already exists:

| Source | Index used |
| --- | --- |
| `patients` | primary key |
| `screenings` | `screenings_patient_idx` |
| `referrals` | `referrals_patient_idx` |
| `appointments` | `appointments_patient_idx` |
| `tb_cases` | `tb_cases_patient_idx` |
| `treatment_followups` | `tb_cases_patient_idx` → `treatment_followups_case_idx` |
| `audit_logs` | `audit_logs_patient_idx` |
| `sms_log` | `appointments_patient_idx` → `sms_log_appointment_idx` |

No new index is proposed. Task 5.4 (query performance review) should confirm this with
`explain analyze` against the live database rather than against this table, because the
claim above is read off index definitions, and reading is not running — the same argument
that produced the preflight harness.

---

## 7. What this design does not do

- **No mobile timeline.** The BHW app is offline-first; this contract is a live server
  aggregation and cannot be served from SQLite without either syncing every source table
  or duplicating events locally — which is the event table D-1.3-i forbade, moved to the
  client. Web portal only for this sprint. Stated here so the omission is a decision and
  not a gap someone closes on Day 7.
- **No SMS content, ever.** `sms_log` has RLS enabled and *no client policies at all* —
  by design since 0002, clients cannot read it. This function would be the first thing
  ever to return any part of it to a client, and it returns `message_kind` and
  `delivery_status` only: that a nudge was sent, and whether it left the system. Task 4.3
  should treat this as the highest-risk line in the design, because it is the only place
  where the answer to "can a client see this table?" changes from no to partly.
- **No writes.** `stable`, not `volatile`. Reading a timeline records nothing, including
  no audit row. Whether reads should be logged is Task 6.x's question, not this one.

---

## 8. Acceptance criterion — self-check

> Do not duplicate source records just to populate the timeline. Build a read/aggregation model from existing records.

No table is created, no column is added, no row is written. Every one of the eighteen
event types is projected from a column that exists at `939ce5f`. The three that cannot be
dated are returned undated rather than given a synthesized timestamp, which is the form
this rule takes when the source record is incomplete.

---

## 9. Open questions for the gate

1. **The BHW case subset (§4.2)** widens BHW visibility from `bhw_case_summary()`'s three
   fields to three lifecycle *events*. I believe it discloses no new column. Confirm, or
   cut BHWs back to `case_registered` alone.
2. **§2's decision to ship five undated events.** The alternative is migration 0034 with
   five nullable columns and a forward-only policy. I ruled it out on sprint scope, not on
   merit. If Codex judges an undated "Referral received" worse than a Priority-B-deferred
   column, that reverses cleanly — nothing else in this document depends on it.
3. **`sms_sent` visibility to BHWs.** A BHW can see the patient and can see that a reminder
   was sent. `delivery_status = 'failed'` is arguably operational information a BHW should
   act on; it is also the first client-visible fact ever extracted from `sms_log`. Include,
   or restrict `sms_sent` to `tb_dots`?
4. **`appointment_missed` at rank 115, dated to `scheduled_date`.** This must agree with
   whatever Task 5.1 counts as a missed follow-up, or the dashboard and the timeline will
   disagree about the same day. Worth settling before 5.1 rather than after.
