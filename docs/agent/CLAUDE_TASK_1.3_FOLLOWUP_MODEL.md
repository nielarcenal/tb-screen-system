# Task 1.3 — Follow-up model (design for review)

Owner: Claude Code. Reviewer: Codex (Task 1.4 gate).
**Revision 4 — 2026-09-09.** Revised in response to the third gate (NOT APPROVED, R3-01…R3-06). Baseline: repository HEAD `4659d65`.
Status: **approved for implementation as migration 0031.** Prerequisite migrations 0028, 0029, and 0030 are applied; `weight_kg` is omitted. The old-client upsert compatibility test remains mandatory during implementation.
**IMPLEMENTED 2026-09-09** as `supabase/migrations/0031_case_registry_and_followups.sql`, verified by `supabase/tests/0031_case_registry_matrix.sql` (live preflight 119/119 PASS, rolled back) and **not yet applied**. The migration header lists seven deviations D1-D7 where this document could not be implemented as written; they are also in DECISIONS.md as D-0031-a..g. One defect in this document is corrected there: the backfill's `min(facility_id)` does not exist for `uuid`.

Depends on [Task 1.2](CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md).

### Revision 4 changelog

| Finding | Resolution | Section |
| --- | --- | --- |
| R3-01 | The `auth.role()` cascade exemption was **wrong** — a cascade from a BHW's referral re-route is an ordinary `authenticated` UPDATE and would have been rejected, breaking re-routing. The trigger now validates the *result* against the unchanged parent link instead of guessing at the caller's privilege. | §2.2 |
| R3-02 | The void columns repeated the ineffective column-only REVOKE. Same correction as R2-01: table revoke, then grant only the ordinary correction columns. | §4.6 |
| R3-04 | Every new or replaced policy uses `current_user_active_role()` from its first version, so 0031 does not reproduce BASE-06 in freshly written authorization. | §3.1, §4.6 |
| R3-05 | `own_facility_case_ids()` moves to a non-exposed schema and becomes active-role-aware, matching the correction already made for the sole-facility helper. | §4.6 |
| R3-06 | Withdrawn admin-queue wording removed from §3.4 and marked superseded in the revision-2 changelog. | §3.4 |
| BASE-06 | Accepted as a release-blocking HIGH and assigned migration 0029 before case/follow-up work in 0031. | §0 |

### Revision 3 changelog

| Finding | Resolution | Section |
| --- | --- | --- |
| R2-01 | The column-REVOKE claim was **wrong** — a column revoke does not subtract from a table-level grant. Replaced with 0017's table-revoke-then-column-grant pattern, plus an ownership trigger that permits an unchanged re-send (so the mobile retry still works) and rejects any reassignment. | §2.2 |
| R2-02 | Link exclusivity: `num_nonnulls(referral_id, tb_case_id) <= 1`. `assign_appointment_to_case()` swaps the referral link for the case link atomically; the case keeps the provenance. | §2.1, §2.2 |
| R2-05 | The admin resolution queue is **withdrawn** — it would have handed patient referral history to a role deliberately denied clinical rows. Ambiguous rows are resolved by support before production, visible to no client role. | §3.2 |
| R2-06 | `sole_referral_facility(patient_id)` is **withdrawn** as a callable surface. Replaced with a boolean helper that only ever compares against the caller's own facility; the backfill is computed inline in the migration. | §3.1 |
| R2-07 | Linked date correction becomes an atomic RPC over both rows; void is defined as "the clinical record is invalid, attendance is untouched"; the appointment UNIQUE becomes a partial index so a replacement can be recorded. | §4.3 |

### Revision 2 changelog

| Finding | Resolution | Section |
| --- | --- | --- |
| ARCH-01 | Appointment ownership FK gains reviewed `ON UPDATE CASCADE` so a transfer is executable in one statement. | §2 |
| ARCH-04 | `revoke update (facility_id, tb_case_id, referral_id)` from `authenticated`. Ownership is set at insert or by RPC, never by a PATCH. | §2.2 |
| ARCH-05 | Mobile is now a full cross-layer contract change, listed file by file. The "only the status union" claim is withdrawn — it contradicted §3.1. | §3.3 |
| ARCH-06 | Shared-visibility legacy arm **withdrawn**. Replaced by a deterministic sole-referral-facility authority, ~~an admin queue for ambiguous rows~~ (*superseded in revision 3 — the admin queue was itself withdrawn under R2-05*), and a bounded compatibility window that ends in a NULL-rejecting trigger. | §3 |
| ARCH-08 | Temporal bounds, attended-appointment linkage, `voided_*` metadata, and an atomic `record_visit()` RPC. | §4.2, §4.3 |
| Gate Q6 | Auto-cancellation bounded to `scheduled_date >= manila_today()`; past rows stay for missed-visit handling; changes audited. | §5 |

---

## 0. A prerequisite this design now depends on

Codex confirmed **BASE-06**: RLS policies still call `current_user_role()`, which is not active-aware, so a deactivated account with an unexpired JWT keeps scoped patient, referral, screening and appointment access until the token expires. Migration 0028 hardened the RPC gates only and says so.

That is a release-blocking HIGH with its own work unit, and it lands on this design in two places. Everything below uses `current_user_active_role()` (0028) in every new or replaced policy and helper — R3-04 caught me writing `current_user_role()` into a *new* policy, which would have reproduced BASE-06 in freshly written authorization. Because a mixed policy family is its own hazard, **the required order is BASE-06 in 0029, then this design in 0031**, so `appointments` never carries active-aware and inactive-aware policies together.

---

## 1. The principle, and what it costs

> Reuse the existing appointment system instead of creating a second scheduler.

Accepted without exception. `appointments` remains the **only** table that holds a date and an attendance state. `treatment_followups` holds no `scheduled_date`, no attendance flag and no status of its own. If a reviewer finds a date in `treatment_followups` that could drive a reminder, the design has been violated.

The split:

| Question | Table |
| --- | --- |
| When should the patient come? | `appointments.scheduled_date` |
| Did they come? | `appointments.status` / `attended_date` |
| Who owns this visit? | `appointments.facility_id` (new, §2) |
| Which referral or episode is it part of? | `appointments.referral_id` / `appointments.tb_case_id` (new, §2) |
| What happened clinically at the visit? | `treatment_followups` (§4) |

The cost of reuse is that `appointments` must first acquire an ownership boundary it never had. That is BASE-02, and it is the substance of this task.

---

## 2. `appointments` gains ownership

**Three** nullable columns. Revision 2 adds `referral_id`, which is what makes the legacy path deterministic (§3) rather than a shared-visibility hole.

```sql
alter table public.appointments
  add column facility_id uuid references public.facilities(facility_id),
  add column referral_id uuid references public.referrals(referral_id) on delete restrict,
  add column tb_case_id  uuid references public.tb_cases(case_id)      on delete restrict;

create index appointments_facility_date_idx on public.appointments (facility_id, scheduled_date);
create index appointments_case_idx          on public.appointments (tb_case_id);
create index appointments_referral_idx      on public.appointments (referral_id);
```

### Why three columns and not one

Most appointments in this system are *not* treatment follow-ups. The BHW's initial "go get tested" visit and every pre-case facility check-up have no case and never will. If ownership rode only on `tb_case_id`, every one of those rows would stay patient-wide and BASE-02 would remain open for the majority of the table.

- `facility_id` — **who owns this row.** Every appointment, always. The authorization key.
- `referral_id` — **which request this visit serves**, for pre-case appointments. The mobile referral screen already knows it (`mobile/app/referral/[screeningId].tsx:89-97` mints `referralId` immediately before inserting the appointment), so this is a recorded fact, not an inference.
- `tb_case_id` — **which episode**, for the subset inside a case.

### 2.1 Consistency, and making transfer executable

Both links agree with `facility_id` declaratively:

```sql
alter table public.referrals
  add constraint referrals_identity_uniq unique (referral_id, facility_id);

alter table public.appointments
  add constraint appointments_referral_facility_agrees
  foreign key (referral_id, facility_id)
  references public.referrals (referral_id, facility_id)
  on update cascade on delete restrict;

-- tb_cases_identity_uniq (case_id, facility_id) is created in Task 1.2 §5.
alter table public.appointments
  add constraint appointments_case_facility_agrees
  foreign key (tb_case_id, facility_id)
  references public.tb_cases (case_id, facility_id)
  on update cascade on delete restrict;
```

`MATCH SIMPLE` skips each check when either of its columns is NULL, which is what legacy and pre-case rows need.

**`ON UPDATE CASCADE` is the answer to ARCH-01, and it is deliberate in both places:**

- On the case FK: `transfer_tb_case()` does one `update tb_cases set facility_id = ...` and every linked appointment follows in the same statement. Codex was right that an immediate FK made the transfer unexecutable in either order; the cascade removes the ordering problem entirely rather than papering over it with `SET CONSTRAINTS`.
- On the referral FK: a BHW re-routing a still-`submitted` referral (a real workflow, 0020 header) *should* move that referral's initial appointment with it. The patient is going somewhere else. The cascade makes that automatic and correct.

**Link exclusivity, which revision 2 was missing (R2-02).** My claim that the two cascades could not fight considered only a referral re-route. Codex found the case I missed: an appointment holding *both* links shares one `facility_id` between two live parents, so transferring the case cascades that column to the destination while the unchanged referral FK still demands the origin — and the statement fails. ARCH-01 was reproducible after all.

The fix is to make the two links mutually exclusive, so `facility_id` never has two parents:

```sql
alter table public.appointments
  add constraint appointments_one_owner
  check (num_nonnulls(referral_id, tb_case_id) <= 1);
```

An appointment is owned by a referral (pre-case) *or* by a case, never both. `assign_appointment_to_case()` therefore **swaps** the links in one statement — clears `referral_id`, sets `tb_case_id` — rather than adding one alongside the other. Nothing is lost by the swap: `tb_cases.referral_id` already holds the episode's provenance (Task 1.2 §4), so the chain from appointment to case to originating referral stays intact and is recorded once instead of twice.

With exclusivity in place only one cascade can apply to any row, and Task 1.2 §4's block on re-routing a cited referral covers the remaining overlap.

**Required test (Codex's):** an appointment created referral-linked by the mobile flow, later assigned to a case, then the case transferred. The appointment must follow the case to the destination and the statement must succeed.

### 2.2 The ownership columns are not client-writable (ARCH-04)

Codex was right that adding authorization keys without constraining writes to them hands the client the ability to reassign ownership. The existing `appointments_tbdots_update` and BHW update policies would have permitted exactly that, and the 0020 immutable trigger pins only `appointment_id` and `patient_id`.

**Revision 2's fix does not work, and revision 3 withdraws it.** I wrote:

```sql
revoke update (facility_id, referral_id, tb_case_id) on public.appointments
  from authenticated, anon;   -- WRONG
```

A column-level `REVOKE` removes column-level grants. It does not subtract columns from a *table-level* `UPDATE` grant, which is what `authenticated` actually holds — so that statement would have run cleanly and changed nothing. This repository already documents the working pattern in 0017: revoke `UPDATE` on the whole table, then grant it back column by column.

Applying that pattern alone, though, breaks a legitimate path Codex also flagged. The mobile push is a **whole-row upsert** (`syncEngine.ts`, `APPOINTMENTS_PUSH`), and after §3.3 that row includes `facility_id` and `referral_id`. On a lost-response retry PostgREST re-sends the same row and `ON CONFLICT DO UPDATE SET` touches every payload column — so denying `UPDATE` on the ownership columns would make the retry fail permanently and strand a queued offline write.

The two requirements are not the same: *do not let a client **change** ownership* is different from *do not let a client **name** ownership*. Privileges can only express the second. So the design splits them.

**1. Table-level revoke, then column grants (0017's pattern).** The grant covers exactly what a legitimate client sends — the mobile payload columns plus the columns the portal edits — and omits `tb_case_id`, which no client ever writes:

```sql
revoke update on public.appointments from authenticated;
grant  update (scheduled_date, attended_date, status,
               facility_id, referral_id, patient_id, updated_at)
  on public.appointments to authenticated;
```

`patient_id` is in the list only because the whole-row upsert sends it; the 0020 immutable trigger already rejects any actual change to it. This is the honest reading: for this table the privilege layer is nearly a no-op, and the real boundary is the trigger below. Saying so is better than implying the grants do work they cannot.

**2. An ownership trigger that permits an unchanged re-send and rejects a change.**

Revision 3 wrote this with an `auth.role()` exemption borrowed from 0020, and claimed it "keeps FK cascades working". **That was wrong, and it would have broken referral re-routing outright.** A BHW re-routing a still-`submitted` referral issues an ordinary authenticated UPDATE on `referrals`; the `ON UPDATE CASCADE` fires inside that statement and does not change the JWT, so `auth.role()` is still `authenticated` and no RPC has set the GUC. The trigger would have rejected the cascade, and with it a workflow 0020 explicitly protects.

The mistake was authorizing by *who appears to be calling* instead of by *what the row ends up saying*. A cascade is legitimate precisely because the result still matches the parent, so that is what the trigger checks:

```sql
create or replace function public.enforce_appointment_ownership()
returns trigger language plpgsql set search_path = public as $fn$
declare
  v_parent uuid;
begin
  if new.facility_id is not distinct from old.facility_id
     and new.referral_id is not distinct from old.referral_id
     and new.tb_case_id  is not distinct from old.tb_case_id
  then
    return new;                              -- nothing moved: identical re-send
  end if;

  -- An authorized RPC (link swap, legacy claim, transfer) says so explicitly.
  if coalesce(current_setting('tbscreen.ownership_change', true), '') = 'on' then
    return new;
  end if;

  -- Otherwise the ONLY permitted change is facility_id following the parent
  -- this row is already linked to, with the link itself unchanged. That is
  -- exactly the shape an ON UPDATE CASCADE produces, and nothing else.
  if new.referral_id is not distinct from old.referral_id
     and new.tb_case_id is not distinct from old.tb_case_id
  then
    if new.referral_id is not null then
      select r.facility_id into v_parent
        from public.referrals r where r.referral_id = new.referral_id;
      if new.facility_id = v_parent then return new; end if;
    elsif new.tb_case_id is not null then
      select c.facility_id into v_parent
        from public.tb_cases c where c.case_id = new.tb_case_id;
      if new.facility_id = v_parent then return new; end if;
    end if;
  end if;

  raise exception 'appointment ownership is not client-writable'
    using errcode = '42501';
end;
$fn$;
```

Why each path is safe:

- **Identical re-send** (the mobile lost-response retry) changes nothing and returns early.
- **Referral cascade**: the link is unchanged and the new facility equals the referral's *current* facility, because the cascade set it from that row. Allowed, and re-routing keeps working.
- **Case cascade** on transfer: same shape against `tb_cases`. Allowed.
- **Malicious PATCH** of `facility_id` to an arbitrary facility: the link is unchanged but the value does not equal the parent's, so it falls through and raises.
- **PATCH to NULL** — the patient-wide revival: `new.facility_id = v_parent` is NULL, never true, so it raises.
- **Unlinked legacy row**: both links are NULL, neither branch applies, and it raises. Claiming one is what `claim_unassigned_appointment()` is for, with the GUC.
- **Swapping the links** never reaches the parent check, because a link changed. RPC only.

The `42501` is deliberate: `syncErrors.ts` classifies 403 as PERMANENT, so a rejected row is reported rather than aborting the sync pass, matching 0020.

The authorized RPCs set `tbscreen.ownership_change` with `SET LOCAL` for the duration of their own transaction. `SET LOCAL` is transaction-scoped, and PostgREST gives a client no way to set an arbitrary GUC, so the flag is reachable only from inside those functions. The GUC now authorizes **only** link swaps, legacy claims and transfers — not cascades, which authorize themselves against the parent.

**Required tests, each path separately (R3-01):** a malicious direct PATCH of each ownership column, including to NULL (rejected); an identical whole-row upsert retry after a lost response (accepted); a BHW re-routing a submitted referral that owns an appointment (accepted, via the parent check, **no GUC**); a case transfer cascading ownership (accepted, via the parent check); a link swap outside the RPC (rejected).

Insert is constrained by policy:

| Policy | `with check` |
| --- | --- |
| `appointments_bhw_insert` | `tb_case_id is null` and `referral_id` names a referral for this patient that the BHW can see, and `facility_id` equals that referral's facility. A BHW supplies ownership only from a referral they created. |
| `appointments_tbdots_insert` | `facility_id = current_user_facility()`, and `tb_case_id` (if given) belongs to a non-terminal case at that facility. |

Later assignment is an authorized operation, never a PATCH:

- `claim_unassigned_appointment(p_appointment_id)` — attaches a legacy NULL row to the caller's facility, subject to §3's authority rule.
- `assign_appointment_to_case(p_appointment_id, p_case_id)` — links an owned appointment to a non-terminal case at the same facility.

Both are `SECURITY DEFINER` with the null-safe active-role gate of Task 1.2 §8.2, both set `tbscreen.ownership_change` for their own transaction, and both write an audit event. There is no third, admin-facing assignment RPC — see §3.2.

**Required tests:** a BHW, and each of two facilities that share a patient, attempting to (a) PATCH `facility_id`, (b) PATCH `tb_case_id`, (c) NULL either column, (d) claim an appointment belonging to the other facility. All must fail.

---

## 3. Legacy rows — a deterministic authority and a bounded window

Codex rejected revision 1's approach on two counts, both correct: old clients keep inserting NULL rows so "the set never grows" was false, and the proposed predicate made one unowned row visible to *every* facility the patient was referred to, which is the same cross-facility hole BASE-02 describes.

Revision 2 replaces it with a single deterministic authority.

### 3.1 The authority rule

Revision 2 exposed this as `sole_referral_facility(p_patient_id) returns uuid`. Codex was right that a `SECURITY DEFINER` helper taking an arbitrary patient UUID and returning that patient's facility is a callable disclosure surface — it has to be executable for policy evaluation, which makes it reachable as an RPC. **Withdrawn.**

The replacement answers only the question the policy actually asks, about the caller's own facility, and never returns an identifier:

```sql
create or replace function public.caller_owns_unassigned_appointment(p_patient_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.current_user_active_role() = 'tb_dots'
     and public.current_user_facility() is not null
     and public.current_user_facility() = (
           select r.facility_id from public.referrals r
            where r.patient_id = p_patient_id
            group by r.facility_id
           having count(*) = (select count(*) from public.referrals
                               where patient_id = p_patient_id));
$$;
```

It is true only when *every* referral for that patient names the caller's own facility — a fact about the data, not a guess about intent — and false in every other case, including for a caller who is anonymous, unprovisioned or deactivated (it uses `current_user_active_role()` from 0028, not `current_user_role()`). A caller learns at most whether a patient they can already name is solely referred to their own facility, which they could determine from their own referral rows anyway.

The one-off backfill does **not** call it. The migration computes the unambiguous set inline (§3.1 below), so the helper exists only for policy evaluation. Direct-RPC denial for `anon` and for wrong-role callers is part of the ACL test matrix.

A NULL-`facility_id` appointment is therefore visible to exactly one facility, or to none:

```sql
-- tb_dots read / update
using (
  public.current_user_active_role() = 'tb_dots'
  and (
    facility_id = public.current_user_facility()
    or (facility_id is null
        and public.caller_owns_unassigned_appointment(patient_id))
  )
)
```

**`current_user_active_role()`, not `current_user_role()` (R3-04).** Revision 3 made only the legacy helper active-aware and left the owned-row branch on the old one, so a deactivated account would have kept reading and updating owned appointments — reproducing BASE-06 inside a policy this design is newly writing. Every new or replaced policy in 0031 uses the active-aware helper from its first version. See §0 on ordering.

**No row is ever visible to two facilities.** The claim race Codex described cannot occur, because at most one facility satisfies the predicate at any moment.

A one-off backfill assigns the same unambiguous set at migration time so the predicate is not evaluated forever:

```sql
update public.appointments a
   set facility_id = sole.facility_id
  from (select patient_id, min(facility_id) as facility_id
          from public.referrals
         group by patient_id
        having count(distinct facility_id) = 1) sole
 where a.patient_id = sole.patient_id
   and a.facility_id is null;
```

The migration `raise notice`s the remaining NULL count. That number is unknown until it runs against the live database.

### 3.2 Ambiguous rows are resolved by support, not by an admin screen

An appointment whose patient has referrals to two or more facilities has **no client read access at all** — not to either facility, and not to an admin.

Revision 2 sent these to an `admin_resolve_appointment_facility()` queue "with the patient's referral history shown so the decision is informed". Codex rejected that, correctly: the accepted role model gives admins aggregates and whitelisted audit metadata and no patient-level clinical rows, and a screen listing which facilities a named patient was referred to is exactly such a row. Closing a legacy ownership gap is not a reason to open a new disclosure to a non-clinical role. **Withdrawn — the RPC, the queue and the screen.**

Resolution instead happens where it belongs, once:

- **Before production**, as controlled migration and support cleanup. The live database holds only test data today — no real patient records exist yet — so the ambiguous set can be resolved, or simply discarded, from a direct database session with no client-facing disclosure at all. That is the whole remedy, and it is available now precisely because the data is synthetic.
- **After production**, an ambiguous row would be a support ticket handled with a direct session and a runbook, not a portal feature. If that ever became frequent enough to need a screen, the right answer is a clinical supervisor role — a separate authorization decision, outside this gate, and not something to smuggle in through an admin queue.

The cost is unchanged and still accepted: such an appointment is invisible to facility staff until resolved. The BHW who created it is unaffected — BHW visibility is barangay-scoped through `bhw_visible_patient_ids()` and does not depend on `facility_id`.

### 3.3 Mobile is a cross-layer contract change (ARCH-05)

Revision 1 said the next mobile release would send `facility_id` and also that the only mobile change was the `AppointmentStatus` union. Those cannot both be true. **The second claim is withdrawn.**

The referral screen already holds everything needed — it mints `referralId` and has `facilityId` selected before it calls `insertLocalAppointment()` — so this is plumbing, not new logic. The complete surface:

| File | Change |
| --- | --- |
| `mobile/src/db/database.ts` | New `PRAGMA user_version` migration step adding `facility_id` and `referral_id` to the local `appointments` table |
| `mobile/src/db/types.ts` | `AppointmentRow` gains both columns; `AppointmentStatus` gains `cancelled` |
| `mobile/src/db/appointmentsRepo.ts` | `insertLocalAppointment` signature, INSERT column list, row mapper, and `upsertPulledAppointment`'s `ON CONFLICT DO UPDATE SET` list |
| `mobile/app/referral/[screeningId].tsx` | Pass `facility_id: facilityId` and `referral_id: referralId` at line ~91 (mint `referralId` before the appointment insert — it already is) |
| `mobile/src/sync/syncEngine.ts` | Push payload follows the local row shape; confirm the appointments pull still uses `*` and now carries the new columns |
| `mobile/src/db/dashboardRepo.ts` | Confirm upcoming/missed queries exclude `cancelled` |
| mobile tests | Old-database upgrade test (a v-N database migrating forward with existing rows), insert/pull mapping, cache purge, pending-count, account switch |

Case and follow-up UI stay web-only, per gate decision 7.

**The old-client upsert claim must be executed, not reasoned about.** Revision 1 asserted that PostgREST builds `ON CONFLICT DO UPDATE SET` from payload keys only, so an old build's appointment upsert would leave `facility_id` and `tb_case_id` untouched. I have read the code path but **have not run it**. Before this design is relied upon, a test must push a payload with the *current* (pre-change) mobile column set over a server row that already has ownership set, against the real PostgREST stack, and assert both columns survive. If they do not, the compatibility window (§3.4) becomes mandatory rather than a convenience.

### 3.4 The window is bounded by a rejecting trigger

Once the mobile release above is published and the minimum supported build is enforced, a follow-up migration adds a `BEFORE INSERT` trigger on `appointments` that **rejects** an insert from `authenticated` with a NULL `facility_id`, using `errcode = 42501`.

That code is chosen deliberately: `syncErrors.ts` classifies 403 as PERMANENT, so an out-of-date device leaves the row pending and reports "could not be uploaded" rather than aborting the whole sync pass — the behaviour 0020 already relies on.

So the window is bounded by an event (the rejecting migration), not by hope. Two things follow, and I state them rather than promising more:

- Until that migration, old clients can still create NULL rows — but each one is either owned by exactly one facility under §3.1, or visible to nobody and left for the support backlog under §3.2. The cross-facility hole is closed **on day one**, not eventually. What remains open is only the *unassigned* condition, which is a workflow gap, not an authorization gap.
- `facility_id NOT NULL` is **not promised for Day 2**. It becomes possible only after unsupported clients are retired and the support backlog of ambiguous rows is empty. Its acceptance test is `select count(*) from appointments where facility_id is null` returning 0.

(Revision 3 said these rows were "parked in the admin queue". There is no admin queue — R2-05 withdrew it, and §3.2 replaced it with direct-session support cleanup. The stale wording is corrected here so no implementer restores a rejected workflow.)

### 3.5 SMS destination

`sms-reminders/index.ts:278-305` maps a patient to "the facility they were referred to" by taking the latest referral, which is wrong whenever a patient has two. The lookup becomes `appointment.facility_id`, falling back to the existing latest-referral query only while it is NULL. Same task, same commit — architecture rule 20.

---

## 4. `treatment_followups`

```text
followup_id     uuid pk default gen_random_uuid()
case_id         uuid not null -> tb_cases(case_id)      restrict
appointment_id  uuid null unique -> appointments(...)   restrict
visit_date      date not null default manila_today()
weight_kg       numeric(5,2) null
notes           text null
recorded_by     uuid not null -> users(user_id)
voided_at       timestamptz null
voided_by       uuid null -> users(user_id)
void_reason     text null
created_at      timestamptz not null default now()
updated_at      timestamptz not null default now()
```

### 4.1 Cardinality

- **One appointment permits at most one *live* follow-up.** Revision 2 used a plain `UNIQUE (appointment_id)`, which Codex showed is a trap: a voided follow-up keeps its non-NULL `appointment_id`, so the constraint would block staff from recording the corrected replacement and leave them stuck without direct database access. A partial index scopes uniqueness to the rows that still count:

  ```sql
  create unique index treatment_followups_one_live_per_appointment
    on public.treatment_followups (appointment_id)
    where appointment_id is not null and voided_at is null;
  ```

  A visit is still one event; a voided record simply stops occupying the slot.
- **Unscheduled visits are allowed.** `appointment_id` is nullable, so a walk-in still gets a record without inventing an appointment nobody scheduled.
- **The appointment and the follow-up must belong to the same case:**

  ```sql
  alter table public.appointments
    add constraint appointments_case_link_uniq unique (appointment_id, tb_case_id);

  alter table public.treatment_followups
    add constraint followups_appointment_agrees
    foreign key (appointment_id, case_id)
    references public.appointments (appointment_id, tb_case_id);
  ```

  Because `case_id` is NOT NULL here, naming an appointment forces that appointment's `tb_case_id` to be non-NULL and equal. A follow-up can never attach to an unassigned or foreign appointment.

### 4.2 Temporal rules (ARCH-08)

Revision 1 left `visit_date` unconstrained, so an impossible visit was structurally valid and would have been picked up by timeline and "no recent follow-up" logic. Enforced by a `BEFORE INSERT OR UPDATE` trigger, since these are cross-row checks:

```text
visit_date >= (case).registration_date
visit_date <= manila_today()
(case).outcome_date is null  or  visit_date <= (case).outcome_date
appointment_id is not null   =>  (appointment).status = 'attended'
                             and (appointment).attended_date = visit_date
```

A linked follow-up therefore records what happened at a visit the patient actually attended, and the two tables cannot disagree about when. Unlinked follow-ups keep `visit_date` as the sole authority, bounded by the case interval.

### 4.3 Correction and voiding

"Recorded in error is an amended note" was not good enough — the row stayed structurally valid and eligible for latest-follow-up logic, and because `notes` is deliberately excluded from the audit whitelist, editing the note could not reliably mark it invalid. Codex was right, and revision 2's replacement was still incomplete in two ways it also named.

**What void means, decided.** Voiding says *the clinical record is invalid*. It does **not** say the patient was absent. Attendance is a separate fact, it lives on the appointment, and it already has its own correction path — `ReferralDetail.tsx:171` undoes a mistaken `attended` back to `scheduled`. Keeping the two separate means neither operation has to guess about the other, and it avoids a void silently rewriting attendance history.

So the two error cases have two distinct remedies, and the UI must offer them as such:

| What actually went wrong | Remedy |
| --- | --- |
| The visit happened; what was written about it is wrong | Correct the follow-up (below), or void it and record a replacement |
| The visit did not happen at all | Undo attendance on the appointment first — which, via §4.2's invariant, requires voiding the linked follow-up |

`void_tb_followup(p_followup_id, p_reason)` sets `voided_at`, `voided_by` and `void_reason` (CHECK: all three NULL or all three non-NULL), writes a `voided` audit event, retains the row, and frees the appointment's follow-up slot (§4.1) so a replacement can be recorded. A voided follow-up is excluded from the timeline, from "no recent follow-up" calculations, and from every count.

**Correcting a linked visit date is atomic (R2-07).** Revision 2 let staff correct `visit_date` by a direct UPDATE while §4.2 requires a linked follow-up to satisfy `visit_date = appointments.attended_date`. Those cannot both hold: the direct UPDATE would simply be rejected by the invariant, with no supported way to fix the pair. So the two rows move together:

```text
correct_followup_visit_date(p_followup_id uuid, p_visit_date date)
```

`SECURITY DEFINER`, owning-facility gated, it updates `appointments.attended_date` and `treatment_followups.visit_date` in one transaction, re-checks every §4.2 bound, and audits both. `visit_date` is therefore **not** in the client `UPDATE` grant for linked follow-ups.

Other corrections — `weight_kg`, `notes` — remain ordinary updates by staff at the owning facility, audited on `weight_kg` (never on the `notes` body). There is still no DELETE policy.

### 4.4 One visit is one atomic operation

Recording a visit is, in the UI, one act: mark attended, record weight and notes, possibly move the case status, possibly book the next appointment. Four PostgREST writes would recreate BASE-03's partial-write failure mode on the clinical path.

```text
record_visit(
  p_appointment_id     uuid,   -- nullable, for an unscheduled visit
  p_case_id            uuid,
  p_visit_date         date,
  p_weight_kg          numeric,
  p_notes              text,
  p_next_scheduled_date date,  -- nullable
  p_new_case_status    text,   -- nullable
  p_request_id         uuid    -- idempotency, Task 1.2 §7.3
) returns treatment_followups
```

`SECURITY DEFINER`, same active-role and facility gate. It marks attendance, inserts the follow-up, delegates any status change to the single transition authority of Task 1.2 §7.2, creates the next appointment already owned by the case, and writes the audit events — in one transaction.

### 4.5 Other field decisions

- **`weight_kg` is omitted from migration 0031.** It remains clinically unconfirmed, and dropping it costs nothing structural. A later migration may add it after confirmation.
- **No `treatment_status_after`.** Where the patient stands is `tb_cases.case_status`; its history is `audit_logs`. A third copy per visit would drift from both.
- **`notes`** is free clinical text, facility-only, exactly like `referrals.result`. It never enters an SMS, a report, an audit payload, or the mobile device.

### 4.6 RLS and write privileges

Authorization is by the parent case's facility, via a `SECURITY DEFINER` helper in the established anti-recursion style (0005/0007/0025). Two corrections from the third gate are folded in here.

**The helper is not a public callable surface (R3-05).** Revision 3 put an enumerating `public.own_facility_case_ids()` in the exposed schema and gated it on `current_user_facility()` alone — so any account attached to a DOTS facility, including an admin, could call it directly and receive case identifiers the table policy would never have given them. That is the same defect already corrected for the sole-facility helper under R2-06, and I reintroduced it one section later.

```sql
create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant  usage on schema app_private to authenticated;

create or replace function app_private.own_facility_case_ids()
returns setof uuid language sql stable security definer set search_path = public
as $$
  select c.case_id from public.tb_cases c
   where public.current_user_active_role() = 'tb_dots'
     and c.facility_id = public.current_user_facility();
$$;

revoke all on function app_private.own_facility_case_ids() from public, anon, service_role;
grant  execute on function app_private.own_facility_case_ids() to authenticated;
```

`app_private` is not in PostgREST's exposed schema list, so the function is usable in a policy expression — which evaluates as the querying user and therefore needs EXECUTE — but is not reachable as an RPC. The active-role check means it returns nothing for a deactivated or non-DOTS caller even if it were reached.

*Observation, not part of this task:* the existing helpers `referred_patient_ids()`, `referred_screening_ids()`, `bhw_visible_patient_ids()` and `own_enrolled_patient_ids()` are enumerating functions in `public` with the same property. They are pre-existing surface, not something 0031 introduces, so moving them belongs with BASE-06's policy pass rather than here — but they should move.

**Policies use the active-aware helper from their first version (R3-04).**

```sql
create policy treatment_followups_tbdots_read on public.treatment_followups
  for select to authenticated
  using (
    public.current_user_active_role() = 'tb_dots'
    and case_id in (select app_private.own_facility_case_ids())
  );
```

No other role gets any policy — a follow-up note is the most sensitive row this design adds, and BHWs, midwives and admins have no need of it. `bhw_case_summary()` (Task 1.2 §8.1) exposes no follow-up data. INSERT is RPC-only (§4.4).

**Write privileges use the table-revoke pattern, not a column revoke (R3-02).** Revision 3 wrote `revoke update (voided_at, voided_by, void_reason) from authenticated, anon` — the *same* ineffective construct R2-01 had already established does not subtract from a table-level grant. I corrected it on `appointments` and left it standing here. As written, a facility client could have voided and un-voided records directly, forged `voided_by`, and bypassed the RPC's reason and audit entirely.

```sql
revoke update on public.treatment_followups from authenticated;
grant  update (notes, weight_kg, updated_at)
  on public.treatment_followups to authenticated;
```

Everything else is RPC-only by privilege, not by convention:

| Column | Written by |
| --- | --- |
| `notes`, `weight_kg` | Ordinary correction by staff at the owning facility |
| `visit_date` | `correct_followup_visit_date()` only — it must move with `appointments.attended_date` (§4.3) |
| `voided_at`, `voided_by`, `void_reason` | `void_tb_followup()` only |
| `followup_id`, `case_id`, `appointment_id`, `recorded_by` | Never — pinned by the 0020 immutable trigger |

`weight_kg` is omitted from 0031, so it is omitted from this grant too.

**Verify the effective privileges, not the statements.** The reason this class of error survived two revisions is that a wrong `REVOKE` runs without complaint. The test asserts the outcome:

```sql
select has_column_privilege('authenticated', 'public.treatment_followups', 'voided_at', 'UPDATE');
-- must be false; likewise voided_by, void_reason, visit_date
```

plus a direct PATCH of each RPC-only column as a real `tb_dots` caller, which must be denied.

---

## 5. Closed cases, and cancelling appointments

**Scheduling against a terminal case is rejected.** A `BEFORE INSERT OR UPDATE` trigger on `appointments` raises when `tb_case_id` names a case whose status is `closed` or `cancelled`. Same rule for new follow-ups. *Amending or voiding* an existing follow-up on a closed case stays allowed — correcting last month's record after the case closed is legitimate.

**`cancelled` is added to the `appointments.status` vocabulary**, approved at the gate as compatible with existing referral rules.

**Auto-cancellation boundary (gate decision 6), stated explicitly:** closing a case cancels its appointments where `status = 'scheduled'` **and `scheduled_date >= manila_today()`**, in the same transaction as the status change, writing one audit event per cancelled row. Past `scheduled` rows are left untouched — they are the input to missed-visit handling and erasing them would hide a real gap in care.

This is a contract change, so it moves as one unit (architecture rule 20):

| Surface | Change |
| --- | --- |
| `supabase/migrations` | New status in the CHECK constraint |
| `web/src/lib/types.ts` | `AppointmentStatus` union |
| `web/src/components/ReferralDetail.tsx` | Render `cancelled`; add a manual cancel action; branches at 643, 672, 691 |
| `web/src/components/Dashboard.tsx` | Exclude cancelled from counts |
| `mobile/*` | See §3.3 — the union is one line of a larger contract change |
| locale files (3) | New label |

The SMS function needs no change: both queries are `.eq('status', 'scheduled')` (`index.ts:251`, `:349`), so cancelled rows fall out automatically. That must be covered by a test rather than left as a happy accident.

The mobile local SQLite table has no CHECK on `status`, so a pulled `cancelled` row stores cleanly on an old build, which then renders an unknown status. Acceptable — display-only, and the row is inert. Recorded for the release checklist.

---

## 6. Patient Care Timeline

Priority A item 4. Recorded here because it constrains this design.

**The timeline is a query, not a table.** It aggregates authorized source rows — screenings, referrals, appointments, cases, follow-ups — at read time. No event table is created for presentation, per the baseline audit.

It is served by a `SECURITY DEFINER` RPC that applies patient authorization and case authorization **independently**, so being allowed to see a patient never implies being allowed to see another facility's episode. It excludes voided follow-ups (§4.3) and never returns `notes`, `referrals.result`, `contact_number`, or any SMS payload.

---

## 7. Acceptance criterion — self-check

> No duplicate scheduling system is introduced.

`treatment_followups` has no `scheduled_date`, no status, no attendance column, and cannot be reached by the reminder function. Every date that drives a reminder is still `appointments.scheduled_date`. The only scheduling-adjacent changes are one added status value and three ownership columns on the existing table.

---

## 8. Remaining implementation gate

**Old-client upsert behaviour** (§3.3) is still unexecuted. The test remains required because a genuine ownership null-out would fail loudly and make the compatibility window mandatory. `weight_kg` is omitted from 0031.
