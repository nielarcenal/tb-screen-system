# Task 3.4 — Missed follow-up detection

Owner: Claude Code. Reviewer: Codex.
**Revision 1 — 2026-09-10.** Baseline: branch `feature/capstone-upgrade` at `f5ac601`, migrations 0028–0033 applied.
Status: **approved and applied as migration `0034_overdue_followup_detection.sql`.** Codex independently reran the live rollback preflight at **26/26 PASS** before atomic application; post-checks confirmed the invoker security mode, ACLs, partial index, and three current overdue rows.

**Taken off the critical path on purpose.** Codex holds uncommitted case registry UI
work in `web/src` (Tasks 2.2–2.5); rule 19 puts those files off limits. This unit is
SQL and docs only and shares no file with it.

---

## 1. The gap

The plan states the rule:

> scheduled appointment + date has passed + attendance not completed = missed follow-up

`appointments.status = 'missed'` already exists and four things read it — `barangay_report()`
(0027/0030), `dashboard_counts()` (0018/0028), the mobile dashboard, and the SMS follow-up
nudge. **Nothing writes it automatically.** `mobile/src/db/dashboardRepo.ts` says so in a
comment: *"missed = appointment status 'missed' (set by TB-DOTS staff)"*.

So an appointment whose day passes without anyone touching the record stays `scheduled`
indefinitely. It is counted as neither attended nor missed, it never reaches the follow-up
nudge, and no "attention required" surface can see it. On the live database at the time of
writing there are **3 such rows** out of 1100 appointments — small today, and structurally
unbounded, because nothing ever moves a row out of that state.

---

## 2. Two different claims, kept apart

The core decision of this unit:

| | Meaning | Who says it |
| --- | --- | --- |
| **overdue** | The day has passed and the record is still open. | Derived, at read time. |
| **missed** | A person recorded that the patient did not come. | Asserted by staff. |

They are not the same claim, and 0034 does not collapse them. Overdue is the worklist —
exactly the set of rows that need a human to look at them. Missed stays what it has always
been: someone's statement about a patient.

---

## 3. What 0034 ships

- **`public.appointment_is_overdue(text, date)`** — the rule, named once.
  `status = 'scheduled' and scheduled_date < public.manila_today()`. `STABLE`, not
  `IMMUTABLE`: the answer changes when the clock crosses Manila midnight, and an
  `IMMUTABLE` marking would license the planner to cache it.
- **`public.overdue_followups()`** — the worklist: appointment, patient display code,
  scheduled date, days overdue, and the ownership columns. No notes, no result, no contact
  number.
- **A partial index** on `(scheduled_date) where status = 'scheduled'` — proportional to
  the open worklist, not to history.

### It is `SECURITY INVOKER`, and that is the design

Every other read RPC here is `SECURITY DEFINER` and therefore restates its own
authorization — which is where 0031's M31-03 widening came from, a policy rewritten in
passing that let a facility name any patient uuid it liked. `overdue_followups()` reads
`appointments`, `patients` and `tb_cases`, all three of which already carry reviewed RLS.
Left as invoker, that scoping is **inherited rather than re-derived**: TB-DOTS sees its own
facility, a BHW sees their barangay's patients, midwife and admin see nothing. No policy is
added, changed or weakened. The safest authorization code here was the code not written.

The join to `patients` is inner, so a caller who could somehow see an appointment but not
the person gets no row. The join to `tb_cases` is left, because a BHW may legitimately see
the appointment and not the episode; `case_number` is then null, which is the right answer.

---

## 4. Why there is no sweep, and what a future one must solve

The obvious implementation is a nightly `pg_cron` job flipping past-due `scheduled` rows to
`missed`. 0031 already establishes the cron pattern, so it would have been easy. It is not
built, for two reasons — and the second one outlives the first.

### 4.1 It is an outbound SMS event, not a relabelling

- `appointments_set_updated_at` bumps `updated_at` on **every** UPDATE.
- `supabase/functions/sms-reminders` selects follow-up candidates as exactly
  `status = 'missed' AND updated_at >= now() - 14 days`.

So every row a sweep touches lands inside the follow-up window **at once** and becomes an
SMS candidate on the next daily run. The pipeline is live on a real provider with an
approved sender name. A first sweep would text real handsets about appointments from
arbitrary past dates. Three rows today; that is a property of this week's data, not of the
design.

### 4.2 An automatic sweep cannot tell a no-show from a data-entry backlog

This is the objection that survives even after the SMS coupling is fixed. "The patient did
not come" and "the patient came and nobody recorded it" produce the identical row. Marking
the second one `missed` sends a person who attended a message asking them to reschedule,
and files a false no-show into the barangay report — a **published** figure.

`missed` is currently a claim a health worker made. A sweep silently redefines it as an
inference about record-keeping, and does so underneath four existing consumers that were
written against the old meaning.

### 4.3 What a sweep would have to answer first

Not blockers to 0034; prerequisites to any future 0035.

1. **A grace period**, or none. How many days after the scheduled date does an unrecorded
   appointment become a claim about the patient rather than about the clinic? This is a
   health-office question, not an engineering one.
2. **Decoupling from the SMS window.** Either a separate marker for swept-vs-asserted
   misses, or a follow-up selection that keys on something other than `updated_at`.
3. **Staging the first run.** The backfill of existing past-due rows is a distinct event
   from steady-state operation and must be run with sending disabled, or bounded to rows
   recent enough that a nudge still makes sense.
4. **Whether the report should change at all.** If swept misses enter `barangay_report()`,
   published figures move. That is the health office's decision, exactly as with the
   referral-cohort basis (D-1.3 / DECISIONS).

---

## 5. Verification

`supabase/tests/0034_overdue_detection_matrix.sql`, run through
`node scripts/build-preflight.mjs 0034` against the live project: **26/26 PASS**, rolled
back. Re-queried afterwards — no functions, no index, 1100 appointments unchanged, no
fixture rows left. All 17 check kinds produced rows, so no section passed by not running.

| Section | What it asks |
| --- | --- |
| 1. The rule | The overdue set is exactly `{yesterday, 30-days-ago}` under four session timezones, and `days_overdue` is 30 under all of them |
| 2. Exclusions | today, tomorrow, attended, missed and cancelled each asked by name, plus a positive control so an invisible fixture cannot pass them all |
| 3. Negative controls | three, see below |
| 4. Scoping | facility A vs B both directions, BHW barangay, admin sees nothing |
| 5. Writes nothing | appointment status counts unchanged across the run |

### The negative control, and why it cannot pass vacuously

A timezone test can go green for the wrong reason: run it at 03:00 Manila, when UTC and
Manila agree on the calendar date, and a `current_date` implementation and a
`manila_today()` one return the same thing. HANDOFF §6 records two earlier tests in this
branch that failed exactly that way.

So this control does not read the wall clock. **Pacific/Midway is UTC-11 and
Pacific/Kiritimati is UTC+14** — 25 hours apart, more than a day, so their local dates
*always* differ, with Midway strictly behind, at every instant. The fixture puts one
appointment on Midway's `current_date`. The matrix then shows:

- `current_date is broken` — the naive predicate answers **false** under Midway and
  **true** under Kiritimati. Same row, same instant, two answers.
- `manila_today() is not` — `overdue_followups()` answers the same under both.
- `dates differ` — asserts the 25-hour premise itself, so if a tzdata change ever broke
  it the control would fail rather than quietly stop testing anything.

That is the acceptance criterion — *no UTC/Manila rollover regression* — demonstrated
rather than asserted.

One concession the reviewer should see: the test grants `select` on its two fixture-id temp
tables to `authenticated`, because every assertion filters the function's output down to
this fixture and the role switch otherwise raises `permission denied for table t_ids`. It
discloses nothing under test — the uuids were generated seconds earlier in the same
transaction, and no assertion's verdict depends on reading them. RLS still decides every
question actually being asked.

---

## 6. Consumers, current and future

Nothing consumes `overdue_followups()` yet — deliberately, since every candidate consumer
lives in `web/src`.

- **Task 5.1 / 5.2 (attention dashboard).** This is the natural first caller. Note the
  alignment question: 5.1's "missed follow-ups" count should be built on *overdue*, not on
  `status = 'missed'`, or the dashboard will under-report by exactly the rows nobody
  recorded — the gap this unit exists to close.
- **Task 4.1 (timeline).** `appointment_missed` there is dated to `scheduled_date`, which
  is the same anchor `days_overdue` counts from, so the two agree by construction. That was
  open question 4 of the timeline contract and this closes it.
- **The case registry** (Codex, in flight) filters on `row.status === 'missed'` client-side.
  It will under-report the same way. Not changed here — it is someone else's uncommitted
  file — but worth raising at their gate.

---

## 7. Open questions for the gate

1. **Is deriving rather than sweeping the right call?** §4 argues yes on two grounds, the
   second of which is clinical rather than technical. If Codex disagrees, the sweep is a
   separate migration and 0034 stands unchanged underneath it either way.
2. **`SECURITY INVOKER` for a read RPC** is new in this codebase — everything else is
   definer. I believe it is strictly safer here because it adds no authorization surface at
   all. Confirm there is no PostgREST behaviour that makes an invoker function behave
   differently from a plain view for these three tables.
3. **Should `overdue_followups()` be reachable by BHWs?** It currently is, via inherited
   RLS, and I think that is right — a BHW chasing a patient who missed a check-up is the
   whole community-health workflow. It is worth stating as a decision rather than leaving
   it as a side effect of not writing a role gate.
4. **The grace period in §4.3(1).** Even without a sweep, Task 5.1 will have to decide
   whether "overdue by 1 day" belongs on the same dashboard line as "overdue by 30". 0034
   returns `days_overdue` so that the decision can be made in one place later rather than
   hard-coded now.
