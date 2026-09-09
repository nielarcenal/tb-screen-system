# Task 1.2 — TB Case domain model (design for review)

Owner: Claude Code. Reviewer: Codex (Task 1.4 gate).
**Revision 4 — 2026-09-09.** Revised in response to the third gate (NOT APPROVED, R3-01…R3-06). Baseline: repository HEAD `4659d65`.
Status: **approved for implementation as migration 0031.** Prerequisite migrations 0028, 0029, and 0030 are applied; the outcome vocabulary and facility codes are accepted project conventions. The old-client upsert compatibility test remains mandatory during implementation.
**IMPLEMENTED AND APPLIED 2026-09-09** as `supabase/migrations/0031_case_registry_and_followups.sql`, verified by `supabase/tests/0031_case_registry_matrix.sql` (strengthened live preflight 140/140 PASS, rolled back before application). The migration header lists seven deviations D1-D7 where this document could not be implemented as written; they are also in DECISIONS.md as D-0031-a..g. One defect in this document is corrected there: the backfill's `min(facility_id)` does not exist for `uuid`.

Read with [CODEX_BASELINE_AUDIT.md](CODEX_BASELINE_AUDIT.md), [CODEX_REVIEW.md](CODEX_REVIEW.md), [Task 1.3](CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md) and [the short-code proposal](CLAUDE_FACILITY_SHORT_CODES_PROPOSAL.md).

### Revision 4 changelog

| Finding | Resolution | Section |
| --- | --- | --- |
| R3-03 | The short-code CHECK accepted NULL for TB-DOTS rows — a NULL regex test makes the whole CHECK unknown, which PostgreSQL accepts. `short_code is not null` added, with a constraint test table. | §6 |
| R3-04 | Every new or replaced RLS policy and helper in 0031 uses `current_user_active_role()` (0028) from its first version, so 0031 does not reproduce BASE-06 in freshly written authorization. | §8 |
| BASE-06 | Accepted as a release-blocking HIGH and assigned migration 0029 before case work in 0031. | §8.2 |

### Revision 3 changelog

| Finding | Resolution | Section |
| --- | --- | --- |
| R2-03 | `audit_logs`, its whitelist trigger and its RLS move **into 0031**, the first migration that creates mutable case data. No RPC ships before its audit dependency exists. | §9 |
| R2-04 | Treatment start becomes one atomic transition: `set_tb_case_status()` takes the date. `update_tb_case_details()` can no longer touch it. New row invariants pin the date to the states that semantically follow treatment start, and pin it NULL for the states that precede it. | §3.2, §4, §7.2 |
| R2-08 | `short_code` becomes nullable with a `type = 'tb_dots'` CHECK, populated and verified before the constraint is added. The eleven mappings are proposed separately as reviewable data. | §6 |
| Renumbering | Every case-work reference to "0028" becomes **0031**; 0028 is now the BASE-01 repair. | throughout |

### Revision 2 changelog

| Finding | Resolution | Section |
| --- | --- | --- |
| ARCH-01 | Composite FK to `referrals` **withdrawn**. Referral becomes immutable provenance validated at creation; a trigger blocks re-routing a cited referral. Appointment ownership FK gains reviewed `ON UPDATE CASCADE`. Transfer RPC ships with the constraint, not later. | §4, §5 |
| ARCH-02 | Full admission predicate specified: active TB-DOTS profile, facility type, referral agreement, explicit referral-free intake rule, uniform error. | §7.1 |
| ARCH-03 | Direct UPDATE policy and grant on `tb_cases` **withdrawn**. All mutation is RPC-only; triggers remain as defence in depth. | §7.2, §8 |
| ARCH-07 | `rpc_requests` redesigned: namespaced by operation, bound to actor/facility, payload fingerprint, typed result, authorized replay, bounded retention. | §7.3 |
| ARCH-09 | Sequence-based numbering **withdrawn** (the no-gap claim was false). Replaced with `facilities.short_code` plus a transactional per-facility/year counter row. | §6 |
| Gate Q1 | Outcome vocabulary given a documented source instead of standing as a guess; local confirmation still blocking. | §3.1 |
| Gate Q2 | BASE-01 repair accepted as a prerequisite of the first migration exposing new RPCs, with the named ACL test matrix. | §8.2 |
| Gate Q4 | Admin audit read gated on a null-safe **active**-role check. | §9 |

---

## 1. Entity boundaries

Five entities, each with exactly one job. The first three exist and are reused unchanged.

| Entity | Answers | Cardinality |
| --- | --- | --- |
| `patients` | Who is this person? | One row per person, forever. |
| `screenings` | What did one DOH-NTP checklist event record? | Many per patient. |
| `referrals` | One screening sent to one receiving facility. A *request*. | Many per patient. |
| `tb_cases` **(new)** | One treatment episode at one owning facility. | Many per patient, over time. |
| `treatment_followups` **(new, Task 1.3)** | What happened at one visit inside one case. | Many per case. |

The line that matters: **a referral is a request to be tested; a case is a record that treatment is being managed.** They are not two names for the same thing, which is why `referrals.status = 'closed'` must keep meaning "the facility finished with this referral" and must never be reinterpreted as a treatment outcome (baseline audit, flow 2).

### Case creation is data entry, not inference

A case is created by facility staff, by hand, recording that a clinician has enrolled this patient into TB treatment at that facility. The system does **not** create a case automatically from `result_outcome = 'positive'`, and no column stores a probability, score, or system-formed conclusion. This keeps the case registry inside the project's positioning rule (§1/§5, architecture rule 12): TB-Screen records a decision a clinician already made; it does not make one.

A positive result is therefore a *prompt* in the UI ("this patient has a positive result and no open case — register one?"), never a trigger.

---

## 2. `tb_cases`

```text
case_id                uuid    pk    default gen_random_uuid()
patient_id             uuid    not null  -> patients(patient_id)     restrict
referral_id            uuid    null      -> referrals(referral_id)   restrict
facility_id            uuid    not null  -> facilities(facility_id)  restrict
case_number            text    not null  unique
registration_date      date    not null  default manila_today()
case_status            text    not null  default 'registered'
treatment_start_date   date    null
outcome                text    null
outcome_date           date    null
created_by             uuid    not null  -> users(user_id)
created_at             timestamptz not null default now()
updated_at             timestamptz not null default now()
```

Notes on each choice:

- **`facility_id` is the owning TB-DOTS facility and is the authorization key.** Every RLS policy on this table compares it to `current_user_facility()` directly. No `referred_patient_ids()` indirection, no patient-wide scope. This is the structural answer to BASE-02 for case data.
- **`referral_id` is nullable, and is *provenance only*.** It records which referral brought the patient in. It is validated once, at creation (§7.1), and pinned immutable thereafter. It is **not** an ownership key, and after revision 2 it no longer participates in any lifetime constraint on `facility_id` — that was ARCH-01.
- **`case_number`** is the human-facing identifier, generated server-side (§6), never on-device. `case_id` is the real key. This mirrors `patients.display_code` / `patient_id`.
- **No `diagnosis_or_confirmation_date`.** The master plan lists it as a candidate; it is dropped. TB-Screen does not hold the confirmation event, the laboratory does, and `referrals.result_date` / `result_outcome` already record what this system legitimately knows. Adding a diagnosis date would put a clinical assertion into a non-diagnostic system.
- **No `treatment_end_date`.** It would always equal `outcome_date`. One column, one meaning.
- **No `treatment_status`.** The master plan lists both `case_status` and `treatment_status`; carrying both makes `treatment_status = 'ended'`, `case_status = 'closed'` and `outcome is not null` three encodings of one fact, and they will drift. One lifecycle column (§3) plus `outcome` covers every state.

### Date columns are Manila civil dates

`registration_date`, `treatment_start_date` and `outcome_date` are `date`, defaulted from `manila_today()` (0018), never `current_date`. Any RPC filtering them uses `manila_day_start()` half-open ranges. BASE-04 is this exact bug in 0027 and must not be repeated here.

---

## 3. Lifecycle

```text
                 cancelled  (opened in error)
                     ^
                     |
   [registered] -----+----> [on_treatment] <----> [interrupted]
                                  |                    |
                                  +--------+-----------+
                                           v
                                       [closed]   (terminal, requires outcome)
```

| Status | Meaning |
| --- | --- |
| `registered` | The facility has opened the episode. Treatment has not started. |
| `on_treatment` | Treatment is under way. Requires `treatment_start_date`. |
| `interrupted` | The patient has stopped attending and the facility has not yet declared a final outcome. Reversible. |
| `closed` | The episode ended. Requires `outcome` and `outcome_date`. Terminal. |
| `cancelled` | The row was opened by mistake. Terminal. **Not a clinical statement** — never counted in any report. |

Allowed transitions, enforced by a `BEFORE UPDATE` trigger (`enforce_tb_case_transition`) **and** by `set_tb_case_status()`, which share one transition table (§7.2):

```text
registered   -> on_treatment | cancelled
on_treatment -> interrupted  | closed
interrupted  -> on_treatment | closed
closed       -> (none)
cancelled    -> (none)
```

**A closed case never reopens.** A relapse or a retreatment is a *new* case for the same patient — which is exactly why one patient may hold many cases, and why `patient_id` must not be unique on this table.

### 3.2 Treatment start is part of the transition, not a separate edit

Revision 2 let `set_tb_case_status()` move a case to `on_treatment` while
`update_tb_case_details()` wrote `treatment_start_date` in a second call. Codex
was right that this is two commits for one clinical event, and that the CHECKs
permitted states they should not: a `registered` case could carry a treatment
date, and `update_tb_case_details()` could later clear the date out of an
`interrupted` or `closed` case, because only `on_treatment` had a row CHECK.

Corrected. `set_tb_case_status()` takes `p_treatment_start_date`, and moving to
`on_treatment` supplies it in the same statement that changes the status.
`update_tb_case_details()` loses the column entirely — a mistaken start date is
corrected by `correct_tb_case_dates()`, which re-validates every invariant below
rather than writing one column blind.

The invariants become symmetric over the whole lifecycle, so no state can hold
the wrong shape regardless of which path reached it:

```text
case_status in ('on_treatment','interrupted','closed') => treatment_start_date is not null
case_status in ('registered','cancelled')              => treatment_start_date is null
```

`closed` is reachable only from `on_treatment` or `interrupted`, so a closed case
always has a start date; `cancelled` is reachable only from `registered`, so it
never does. The two CHECKs state that directly rather than leaning on transition
history to imply it.

### 3.1 Outcome vocabulary — accepted project standard

Accepted values: `cured`, `treatment_completed`, `treatment_failed`, `died`, `lost_to_follow_up`, `not_evaluated`.

**Source.** These are the six treatment outcomes in the Philippine DOH NTP Manual of Procedures, 6th Edition, consistent with WHO's *Definitions and reporting framework for tuberculosis — 2013 revision*. `treatment_success` is an aggregate of `cured` plus `treatment_completed`, not a seventh patient-level outcome, so it is not stored in the CHECK.

**Project decision, 2026-09-09:** the user directed implementation to continue without local head-nurse confirmation because of the defense deadline. Migration 0031 uses the six-value national standard above and cites the NTP MOP 6th Edition. This records a project convention; it does not claim that a separate local paper-register convention was verified.

---

## 4. Constraints, and what "duplicate" means

### Cross-row: one active episode per patient

```sql
create unique index tb_cases_one_active_per_patient
  on public.tb_cases (patient_id)
  where case_status in ('registered', 'on_treatment', 'interrupted');
```

**Definition:** a duplicate is *a second non-terminal case for the same patient, regardless of facility*. A patient is on TB treatment in one place at a time; two facilities each holding an open episode for one person is a data error, not a workflow. Terminal rows (`closed`, `cancelled`) are excluded, so treatment history accumulates without limit.

This is a database-level guarantee, so it holds under two concurrent requests. UI button-disabling is not a substitute (baseline audit, migration risks).

**Consequence accepted (ARCH-01):** because this index is global, a patient who moves between facilities blocks the receiving facility until the case is transferred. The transfer RPC (§5) is therefore the operational remedy for this constraint and **ships in the same migration**. Shipping the index without the RPC would create a dead end with no way out.

### Cross-table: referral agreement is a creation-time check, not a lifetime constraint

**Revision 2 withdraws the composite FK to `referrals`.** Codex was right: `tb_cases_referral_agrees` pinned `tb_cases.facility_id` to the referral's facility for the case's whole lifetime, so any transfer would either fail or force the historical referral to be re-routed — which would destroy the referral's meaning as a record of where the patient was originally sent.

The replacement separates provenance from current ownership:

1. **At creation**, `create_tb_case()` verifies inside the RPC that the named referral's `patient_id` equals `p_patient_id` and its `facility_id` equals the caller's facility (§7.1). A case cannot be born pointing at someone else's referral.
2. **After creation**, `referral_id` is pinned immutable (below), so the link cannot be retargeted.
3. **The referral cannot be re-routed out from under the case.** `referrals.facility_id` is deliberately mutable (0020 header) so a BHW can re-route a still-`submitted` referral. A new `BEFORE UPDATE` trigger on `referrals` raises when `facility_id` changes and any `tb_cases` row cites that referral. This is narrower than the withdrawn FK — it constrains the referral, not the case — and it leaves `tb_cases.facility_id` free to move.

Net effect: `referral_id` means "the referral this episode came from", permanently and truthfully, while `facility_id` means "who manages this episode now". Those are two different facts and they now have two different mechanisms.

### Within-row CHECKs

```text
case_status in ('on_treatment','interrupted','closed') => treatment_start_date is not null
case_status in ('registered','cancelled')              => treatment_start_date is null
case_status = 'closed'        <=>  outcome is not null
outcome is not null           <=>  outcome_date is not null
treatment_start_date is null  or   treatment_start_date >= registration_date
outcome_date is null          or   outcome_date >= coalesce(treatment_start_date, registration_date)
```

Revision 2 stated only the `on_treatment` half and argued that transition history would guarantee the rest. Codex was right that this was not enough: a date-correcting RPC could clear the start date out of an `interrupted` or `closed` case without violating any CHECK, and nothing forbade a `registered` case from carrying a treatment date it had not reached. The two symmetric invariants above hold in every state regardless of the path that reached it, so no RPC can leave the row in a shape the lifecycle does not allow. See §3.2.

### Immutability

Extend the existing `enforce_immutable_columns` trigger (0020) to `tb_cases`, pinning `case_id`, `patient_id`, `referral_id`, `case_number`, `created_by`, `registration_date`.

`facility_id` is **not** pinned — it is the transfer target (§5). It is protected instead by having no client write path at all (§8).

### Delete behaviour

**No DELETE policy for any client role.** A mistake becomes `cancelled`, which preserves the audit trail; deletion destroys it. Child FKs (`treatment_followups.case_id`, `appointments.tb_case_id`) use `on delete restrict`, so even a direct database session cannot orphan children silently.

---

## 5. Facility transfer

**Decision: a transfer moves the case; it does not close and re-open it.** Closing a case on transfer would force staff to record an outcome that did not happen and would corrupt every outcome count.

**Revision 2: the transfer RPC ships in migration 0031, not in Priority B.** Only the *UI* is deferred. Codex's point stands — the global one-active-case index (§4) creates a state that only a transfer can resolve, so shipping the constraint without the remedy would strand a receiving facility with no recourse.

### Making the transfer executable

The blocker Codex identified was the immediate composite FK between `appointments` and `tb_cases`: updating the case first conflicts with the children's old facility, and updating the children first conflicts with the parent's old facility. Being in one transaction does not help, because the check is per-statement.

Resolution — **an explicitly reviewed `ON UPDATE CASCADE`** on the appointment ownership FK:

```sql
alter table public.tb_cases
  add constraint tb_cases_identity_uniq unique (case_id, facility_id);

alter table public.appointments
  add constraint appointments_case_facility_agrees
  foreign key (tb_case_id, facility_id)
  references public.tb_cases (case_id, facility_id)
  on update cascade
  on delete restrict;
```

A single `update tb_cases set facility_id = ...` now propagates to every linked appointment's `facility_id` in the same statement. The cascade touches only rows whose `tb_case_id` is non-NULL (under `MATCH SIMPLE`, rows with a NULL link are not participants), which is exactly the intended set.

`treatment_followups` needs no cascade: it is keyed on `case_id`, which never changes.

### The RPC

```text
transfer_tb_case(p_case_id uuid, p_to_facility_id uuid, p_reason text)
```

`SECURITY DEFINER`, `search_path = public`, admin-only with a null-safe **active**-role gate (§8.2). It verifies the destination facility exists and is type `tb_dots`, rejects a no-op transfer, rejects transfer of a terminal case, updates `facility_id`, and writes a `transferred` audit event naming both facilities. No `tb_cases` policy or grant permits a facility user to change `facility_id`.

### Required tests

- Transfer a case that has **both** an originating referral and linked appointments; assert the case, its appointments, and the audit row all land on the destination, in one transaction.
- Assert the releasing facility loses read access to the case, its appointments and its follow-ups immediately.
- Assert the destination facility can now open the case, and that the one-active-case index no longer blocks it.
- Assert a non-admin caller (each of `tb_dots`, `bhw`, `midwife`, anonymous, missing-profile, inactive) is rejected.
- Assert re-routing a referral cited by a case is rejected (§4).

---

## 6. `case_number` generation

**Revision 2 withdraws the sequence-based design.** My claim that "a failed insert consumes no number" was false: PostgreSQL sequences are non-transactional, so a rolled-back insert still burns a value — and `next_facility_patient_code()` (0025), which I cited as the pattern, has exactly that property. Codex was right to catch it.

Two concrete gaps had to be closed: there is no stable facility short code anywhere in the schema, and there is no transactional counter.

**Facility code.** Revision 2 proposed `short_code text not null unique`, which Codex correctly rejected: the table already holds barangay health stations (`seed.sql` seeds Casisang BHS), so NOT NULL would fail on existing rows, and admin facility creation supports both types, so a required case-number field would block creating a BHS that will never have a case number.

Corrected shape — nullable, unique where present, required by a type-aware CHECK:

```sql
alter table public.facilities add column short_code text;

create unique index facilities_short_code_uniq
  on public.facilities (short_code) where short_code is not null;

alter table public.facilities
  add constraint facilities_short_code_scope check (
    (type =  'tb_dots' and short_code is not null
                       and short_code ~ '^[A-Z0-9]{2,8}$')
    or
    (type <> 'tb_dots' and short_code is null)
  );
```

**`short_code is not null` is load-bearing (R3-03).** Revision 3 omitted it, so for a TB-DOTS row with a NULL code the regex test was NULL, the whole CHECK was NULL, and PostgreSQL accepts an unknown CHECK — the constraint permitted exactly the row it existed to forbid. The full test table is in the [short-code proposal](CLAUDE_FACILITY_SHORT_CODES_PROPOSAL.md).

The CHECK is added **last**, after the eleven rows are populated and after the migration verifies that no `tb_dots` row is left without a code and no other row has one — raising rather than proceeding if either count is non-zero. The baseline audit warns these migrations have been hand-applied, so a live TB-DOTS facility absent from the mapping must stop the migration, not receive an invented code.

The eleven mappings are accepted project data in [CLAUDE_FACILITY_SHORT_CODES_PROPOSAL.md](CLAUDE_FACILITY_SHORT_CODES_PROPOSAL.md) — never derived from `facilities.name` at runtime, since 0009 itself renamed a facility and a code already printed on patient records must not follow. `short_code` is pinned immutable by the 0020 trigger. Admin facility creation (0013) gains a short-code field, required only when the type is `tb_dots`.

**Transactional counter.**

```sql
create table public.case_number_counters (
  facility_id uuid not null references public.facilities(facility_id),
  year        int  not null,
  next_seq    int  not null default 1,
  primary key (facility_id, year)
);
```

`create_tb_case()` does `insert ... on conflict do update set next_seq = case_number_counters.next_seq + 1 returning next_seq`, inside its own transaction. The row lock serialises concurrent creators at the same facility, and a rollback restores the counter — so this design *can* keep the no-gap promise the sequence version could not. At this system's scale the lock is not a contention concern.

Format: `TBC-<SHORT>-<YYYY>-<5-digit sequence>`, e.g. `TBC-MLYBLY-2026-00017`. The year comes from `manila_today()`, not `current_date`. The global `unique (case_number)` constraint remains the final collision guard.

**Observation, not part of this task:** `next_facility_patient_code()` has the same rollback-gap behaviour for `PAT-DOTS-####`. It is harmless there (the codes are cosmetic and the function loops on collision), but it should be recorded rather than treated as a pattern worth copying.

---

## 7. Writes go through RPCs, not client table access

BASE-03 showed what independent client writes cost: `RegisterPatient.tsx` can leave a committed patient and screening with no referral, and a retry mints a second patient. Case creation and case transitions have the same shape and must not repeat it.

### 7.1 `create_tb_case` — authorization is admission, not just role

```text
create_tb_case(
  p_patient_id        uuid,
  p_referral_id       uuid,   -- nullable
  p_registration_date date,   -- nullable, defaults manila_today()
  p_request_id        uuid    -- idempotency key
) returns tb_cases
```

`SECURITY DEFINER`, `search_path = public`. Because it bypasses RLS, role alone is not sufficient — ARCH-02 was correct that the previous draft would have let any facility attach any patient UUID to itself. The full predicate, all checks null-safe:

1. **Caller identity.** `auth.uid()` resolves to a `public.users` row with `role = 'tb_dots'` **and `active = true`**. `current_user_role()` does not filter `active` (baseline audit), so this RPC checks the column directly rather than trusting the helper.
2. **Caller's facility.** `current_user_facility()` resolves to a `facilities` row with `type = 'tb_dots'`. A barangay health station cannot own a case.
3. **Admission — referral-backed.** When `p_referral_id` is given: the referral must exist, its `patient_id` must equal `p_patient_id`, its `facility_id` must equal the caller's facility, and its `status` must be in `('received', 'tested', 'closed')` — the patient has actually arrived. A still-`submitted` referral is not an admission.
4. **Admission — referral-free.** When `p_referral_id` is NULL, patient existence is **not** sufficient. The patient must be in `own_enrolled_patient_ids()` (0025) — that is, this facility registered them as a walk-in. Any other referral-free intake (a genuine transfer-in from outside TB-Screen) is **not** available on this path; it is an admin operation using `transfer_tb_case()` semantics against a case created by the originating facility, or a support action. This is deliberately narrow; widening it needs its own review.
5. **Uniform failure.** Every failure in 1–4 raises the same `not authorized` with `errcode = 42501` and no detail. A caller must not be able to distinguish "no such patient" from "not your patient" — that difference is itself a disclosure that a patient identifier exists.
6. `facility_id` and `created_by` are taken from the session. They are never read from the payload.

### 7.2 Mutation is RPC-only (ARCH-03)

**Revision 2 withdraws the direct UPDATE policy and grant on `tb_cases`.** Codex was right that granting table UPDATE while claiming RPC-only transitions is a contradiction: a client could PATCH `case_status` straight through PostgREST, skipping the audit write and the appointment cancellation even if the transition trigger allowed the edge.

So:

```sql
revoke insert, update, delete on public.tb_cases from authenticated, anon;
-- SELECT only, gated by the read policy in §8.
```

There is no INSERT, UPDATE or DELETE policy on `tb_cases` for any client role. Three RPCs are the entire write surface:

| RPC | Purpose |
| --- | --- |
| `create_tb_case(...)` | §7.1 |
| `set_tb_case_status(p_case_id, p_new_status, p_treatment_start_date, p_outcome, p_outcome_date)` | Every lifecycle transition, including starting treatment (§3.2) |
| `correct_tb_case_dates(p_case_id, p_registration_date, p_treatment_start_date, p_outcome_date)` | Correcting dates on an existing case, re-validating every §3.2 invariant |

`set_tb_case_status()` and the `enforce_tb_case_transition` trigger read **the same transition table**, defined once as an immutable SQL function, so there is exactly one transition authority and the trigger cannot drift from the RPC. The trigger stays in place as defence in depth against direct database sessions.

Transitioning to `closed` performs, atomically in one transaction: the status/outcome update, the `closed` audit event, and cancellation of that case's `scheduled` appointments dated on or after `manila_today()` (Task 1.3 §5, per gate decision 6).

### 7.3 `rpc_requests` — idempotency, redesigned (ARCH-07)

The previous `(request_id, created_at, result_id)` sketch was under-specified in exactly the way Codex describes: a caller-supplied key with no operation namespace, no actor binding and no payload binding can return another operation's result or suppress a legitimate one.

```sql
create table public.rpc_requests (
  operation           text not null check (operation in ('create_tb_case', 'register_walkin')),
  request_id          uuid not null,
  actor_user_id       uuid not null references public.users(user_id),
  facility_id         uuid not null references public.facilities(facility_id),
  payload_fingerprint text not null,          -- sha256 over a canonical JSON of the operation's inputs
  result_kind         text not null check (result_kind in ('tb_case', 'patient')),
  result_id           uuid not null,
  created_at          timestamptz not null default now(),
  primary key (operation, request_id)
);
revoke all on public.rpc_requests from authenticated, anon;
```

Replay rule, enforced inside every RPC that uses it: on a hit for `(operation, request_id)`, the stored `actor_user_id` must equal `auth.uid()`, the stored `facility_id` must equal `current_user_facility()`, and `payload_fingerprint` must match the current inputs. If all three match, return the referenced result. If any differs, raise the same uniform `not authorized` (42501) — never a message revealing which check failed, and never the stored result.

The primary key is namespaced by `operation`, so a `create_tb_case` key can never collide with a `register_walkin` key.

**Retention is bounded.** Rows older than 7 days are purged by the existing cron infrastructure (0003). A retry window is measured in minutes; after the purge a replayed key simply creates a new record, which is the correct behaviour for a key that is no longer meaningful. The purge job is part of the migration, not an afterthought.

The table is created in 0031 and reused unchanged by the BASE-03 atomic walk-in registration RPC, per gate decision 3.

---

## 8. Role access

| Role | Access to `tb_cases` |
| --- | --- |
| `tb_dots` | **SELECT only**, where `current_user_active_role() = 'tb_dots'` and `facility_id = current_user_facility()`. All writes via the three RPCs in §7.2. No INSERT/UPDATE/DELETE policy or grant. |
| `bhw` | **No direct table policy.** Read-only summary through `bhw_case_summary()` (§8.1). |
| `midwife` | None. The existing design excludes midwives from patient-level clinical data (0026, baseline audit). Aggregates only. |
| `admin` | None on rows. `transfer_tb_case()`, aggregates, and audit metadata only — consistent with the existing rule that administrative privilege is not clinical authorization. |
| `service_role` | Bypasses RLS. Used only by Edge Functions. No new client-reachable surface. |

### 8.1 Why BHWs read through an RPC and not a policy

A BHW has a real need: *is the patient I referred actually on treatment?* A BHW has no need for the outcome, the dates, or the clinical notes.

RLS cannot restrict columns, and a column `GRANT` cannot separate BHWs from TB-DOTS staff because both authenticate as `authenticated` — the exact constraint documented on `REFERRAL_COLUMNS` in `syncEngine.ts`, where the boundary ended up client-side and therefore unenforced.

`bhw_case_summary(p_patient_id uuid)` fixes that class of problem instead of repeating it. It is `SECURITY DEFINER`, returns only `(patient_id, case_status, facility_name, registration_date)` for patients in `bhw_visible_patient_ids()`, and gives the device no path to any other column. **This is a real server-side column boundary**, and it is the pattern new work should follow.

### 8.2 Null-safe, active-aware role gates are mandatory

BASE-01 is live in `barangay_report`, `admin_overview` and the 0026 variants: `current_user_role()` returns NULL for an anonymous caller or an authenticated caller with no `public.users` row, and both `NULL NOT IN (...)` and `NULL <> 'admin'` evaluate to NULL, so the guard never raises.

Per gate decision 2, **BASE-01 is repaired before or inside the first migration that exposes new `SECURITY DEFINER` RPCs.** Every new and repaired function:

- resolves role **and `active`** from `public.users` in one null-safe lookup, rather than trusting `current_user_role()`, which does not filter `active`;
- raises `42501` with a uniform message on any failure;
- is created with `revoke execute ... from public, anon` and an explicit grant to `authenticated` (or nothing, for admin-only functions gated internally).

**BASE-06, confirmed at the third gate, is a prerequisite.** 0028 hardened the RPC gates only; the RLS policies still call `current_user_role()`, so a deactivated account with an unexpired JWT keeps scoped row access until the token expires. Every policy and helper introduced by 0031 uses `current_user_active_role()` from its first version (R3-04), but a table carrying one active-aware policy beside several inactive-aware ones is its own hazard. **Required order: BASE-06 in 0029, then case work in 0031.**

**Required ACL test matrix**, applied to every new and repaired function, using real database roles rather than mocks:

| Caller | Expected |
| --- | --- |
| anonymous (`anon`, no JWT) | denied |
| authenticated, no `public.users` row | denied |
| authenticated, `active = false` | denied |
| wrong role (`bhw`, `midwife`, `admin` where not permitted) | denied |
| right role, wrong facility | denied |
| right role, right facility | allowed |

---

## 9. `audit_logs`

**Revision 3: this table ships in 0031, not on Day 6.** Codex was right that the previous plan was incoherent — `transfer_tb_case()`, `set_tb_case_status()`, the appointment-assignment RPCs and `record_visit()` are all specified to write audit events and all ship in the case migration, so scheduling `audit_logs` for a later task would leave them either failing outright or silently unaudited, with the early history unreconstructable afterwards.

So 0031 contains the table, the whitelist trigger function, the RLS policies and the event-writing contract. **No RPC is enabled before its audit dependency exists.** The Day-6 Audit Trail task adds the viewer and widens event coverage to tables beyond the case triad; it does not create the table.

```text
audit_id       uuid pk
entity_table   text not null check in ('tb_cases','treatment_followups','appointments')
entity_id      uuid not null
action         text not null check in
                 ('created','updated','status_changed','transferred','cancelled','closed','voided')
actor_user_id  uuid null -> users(user_id)   -- null = service_role / system
actor_role     text null                      -- snapshot at the time
patient_id     uuid null -> patients          -- for authorization scoping of reads
facility_id    uuid null -> facilities        -- for authorization scoping of reads
changes        jsonb not null default '{}'
occurred_at    timestamptz not null default now()
```

Rules:

- **Server-produced only.** Rows are written by `SECURITY DEFINER` triggers and RPCs. There is no client INSERT, UPDATE or DELETE policy on this table at all — `updated_at` columns are not an audit trail (baseline audit), and neither is a log a client can rewrite.
- **`changes` is a constrained whitelist, not a row dump.** It stores `{column: {from, to}}` for an explicit per-table column list, and **never** stores `treatment_followups.notes`, `referrals.result`, or `patients.contact_number`. The whitelist lives in the trigger function, so widening it requires a migration and a review.
- `patient_id` and `facility_id` are denormalized onto the row specifically so an audit read can be authorized without joining back into tables the reader may not be allowed to see.
- Reads: `tb_dots` where `facility_id = current_user_facility()`; `admin` across all rows, **gated by the null-safe active-role check of §8.2** (gate decision 4). Admin-wide read is acceptable *because* of the whitelist — an admin sees who changed a status and when, never clinical free text or contact data. If the whitelist is ever widened, this grant must be revisited in the same migration.

---

## 10. Acceptance criteria — self-check

| Criterion (Task 1.2) | Where met |
| --- | --- |
| One patient may have multiple cases over time | §4 partial unique index excludes terminal rows; closed cases never reopen (§3) |
| Each case is linked to one patient | `patient_id` NOT NULL, pinned immutable (§4) |
| Case may link to the originating referral | `referral_id` nullable, validated at creation, pinned immutable, protected by the referral re-route trigger (§4) |
| Facility ownership is explicit | `facility_id` NOT NULL, and it is the RLS key (§2, §8) |
| Role access is documented | §8 |
| Lifecycle statuses are documented | §3 |
| Case status is not used as an AI diagnostic mechanism | §1 — human data entry, no score column, no automatic creation |

---

## 11. Remaining implementation gates

1. Use the accepted six-value NTP outcome vocabulary in §3.1.
2. Use the accepted eleven project short codes in §6.
3. Execute the old-client PostgREST appointment-upsert compatibility test before relying on omitted ownership keys.
4. Omit follow-up `weight_kg` from migration 0031 because it remains clinically unconfirmed.
