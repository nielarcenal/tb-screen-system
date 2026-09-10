-- ============================================================================
-- 0038_appointment_audit_trail.sql — Task 6.2 / C41-02.
--
-- NOT APPLIED. AWAITING CODEX REVIEW.
--
-- ---------------------------------------------------------------------------
-- THE GAP
--
-- 0031 audits appointments from six call sites inside five RPCs. None of them
-- is the path either client actually uses. The portal and the mobile app mark
-- an appointment attended, missed or cancelled, and reschedule it, with an
-- ordinary authenticated PostgREST PATCH — and that writes no audit row at all.
--
-- So the appointment audit trail records only what the case-registry RPCs did,
-- and is silent about the everyday clinical workflow it exists to describe.
-- Logged as C41-02 when 0035 shipped and deliberately deferred then, because
-- adding a trigger on top of the six existing calls would double-log every
-- RPC-driven change.
--
-- ---------------------------------------------------------------------------
-- ONE AUTHORITATIVE EVENT PATH: THE TRIGGER
--
-- The brief forbids a generic trigger stacked on the existing calls, and it is
-- right to. Two ways to get to a single path:
--
--   (a) the trigger is authoritative, and the six explicit calls are removed;
--   (b) the calls stay, and the trigger skips when a transaction-local flag
--       says an RPC already logged this row.
--
-- (a) IS TAKEN. (b) needs the same five function bodies restated anyway — to
-- set the flag — and buys, in exchange, a flag that has to be proved
-- unspoofable, proved not to suppress a later unrelated update in the same
-- transaction, and proved to roll back with its business mutation. It also
-- fails SILENTLY and invisibly if a future RPC forgets to set it: the audit
-- row simply never appears, and nothing says so. (a) has exactly one failure
-- mode, transcription, which is mechanical and is what a mutation-tested
-- verifier is for.
--
-- The cost is real and stated plainly: §3 restates 471 lines of applied plpgsql
-- to delete 6 statements. `scripts/verify-0038-bodies.mjs` proves that is ALL
-- it deletes, by diffing every one of the five functions against its 0031
-- source with only those six removals normalised away, and it self-tests by
-- mutating its own input.
--
-- WHAT DOES NOT CHANGE. The action vocabulary is 0031's, exactly:
--
--     INSERT                      -> 'created'
--     status becomes 'cancelled'  -> 'cancelled'
--     anything else               -> 'updated'
--
-- `status_changed` is deliberately NOT adopted for appointments even though
-- 0035 uses it for referrals. 0031 already wrote 'updated' for an appointment
-- moving to `attended`, and those rows are in the live table. A vocabulary that
-- changes halfway through one entity_table is worse to read than one that
-- differs between two.
--
-- The whitelist is untouched, and that is a deliberate constraint on this file
-- rather than an oversight: the trigger emits only the six keys 0031 already
-- approved for appointments, so `verify-0035-whitelist.mjs` must still pass
-- unchanged after this migration. If a future edit here needs a seventh key,
-- that is a whitelist migration with its own review.
--
-- ---------------------------------------------------------------------------
-- WHAT THE RESTATEMENT LEAVES BEHIND, DELIBERATELY
--
-- Removing the six calls leaves ONE local in `record_visit()` written and never
-- read: `v_next`, which captured the id of the next appointment purely to audit
-- it. It is left in place. Deleting it would be a seventh change, and the whole
-- value of §3 is that the diff against 0031 is exactly six deletions and
-- nothing else. A reviewer should read it as intentional.
--
-- (`v_appt_old` in the same function is NOT dead: its SELECT ... FOR UPDATE is
-- the authorization check and the row lock. Only its audit consumption went.)
--
-- ---------------------------------------------------------------------------
-- Verified by supabase/tests/0038_appointment_audit_matrix.sql. Run
--     node scripts/build-preflight.mjs 0038
-- and execute the generated file; it wraps both in one rolled-back transaction.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The trigger function.
--
-- SECURITY DEFINER because app_private.write_audit() is revoked from every
-- role, `authenticated` included, and this must reach it however the row was
-- written. write_audit() still reads auth.uid() and current_user_active_role()
-- from the CALLER's JWT, so the actor is whoever made the change: the clinic
-- staff account behind a PATCH, the RPC's caller, or NULL for a direct session.
--
-- The six columns are exactly the appointments arm of the 0031 whitelist. No
-- patient name, no contact number, no notes, no clinical value — an appointment
-- carries none of those, which is part of why this table is safe to audit
-- densely.
-- ---------------------------------------------------------------------------
create or replace function public.audit_appointment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_changes jsonb := '{}'::jsonb;
  v_action  text;
begin
  if tg_op = 'INSERT' then
    -- On an insert every non-null column is news. `from` is null throughout,
    -- which is the truth: the row did not exist.
    if new.status         is not null then v_changes := v_changes || jsonb_build_object('status',         jsonb_build_object('from', null, 'to', new.status));         end if;
    if new.scheduled_date is not null then v_changes := v_changes || jsonb_build_object('scheduled_date', jsonb_build_object('from', null, 'to', new.scheduled_date)); end if;
    if new.attended_date  is not null then v_changes := v_changes || jsonb_build_object('attended_date',  jsonb_build_object('from', null, 'to', new.attended_date));  end if;
    if new.facility_id    is not null then v_changes := v_changes || jsonb_build_object('facility_id',    jsonb_build_object('from', null, 'to', new.facility_id));    end if;
    if new.referral_id    is not null then v_changes := v_changes || jsonb_build_object('referral_id',    jsonb_build_object('from', null, 'to', new.referral_id));    end if;
    if new.tb_case_id     is not null then v_changes := v_changes || jsonb_build_object('tb_case_id',     jsonb_build_object('from', null, 'to', new.tb_case_id));     end if;

    perform app_private.write_audit(
      'appointments', new.appointment_id, 'created',
      new.patient_id, new.facility_id, v_changes);

    return null;
  end if;

  if new.status         is distinct from old.status         then v_changes := v_changes || jsonb_build_object('status',         jsonb_build_object('from', old.status,         'to', new.status));         end if;
  if new.scheduled_date is distinct from old.scheduled_date then v_changes := v_changes || jsonb_build_object('scheduled_date', jsonb_build_object('from', old.scheduled_date, 'to', new.scheduled_date)); end if;
  if new.attended_date  is distinct from old.attended_date  then v_changes := v_changes || jsonb_build_object('attended_date',  jsonb_build_object('from', old.attended_date,  'to', new.attended_date));  end if;
  if new.facility_id    is distinct from old.facility_id    then v_changes := v_changes || jsonb_build_object('facility_id',    jsonb_build_object('from', old.facility_id,    'to', new.facility_id));    end if;
  if new.referral_id    is distinct from old.referral_id    then v_changes := v_changes || jsonb_build_object('referral_id',    jsonb_build_object('from', old.referral_id,    'to', new.referral_id));    end if;
  if new.tb_case_id     is distinct from old.tb_case_id     then v_changes := v_changes || jsonb_build_object('tb_case_id',     jsonb_build_object('from', old.tb_case_id,     'to', new.tb_case_id));     end if;

  -- A write that moved nothing watched records nothing. `appointments` has an
  -- updated_at trigger, so an idempotent re-send from a retrying mobile client
  -- is an UPDATE like any other, and auditing those would bury the real events
  -- under rows that say nothing happened.
  if v_changes = '{}'::jsonb then
    return null;
  end if;

  v_action := case
    when new.status is distinct from old.status and new.status = 'cancelled' then 'cancelled'
    else 'updated'
  end;

  perform app_private.write_audit(
    'appointments', new.appointment_id, v_action,
    new.patient_id, new.facility_id, v_changes);

  return null;
end;
$fn$;

revoke all on function public.audit_appointment_change() from public, anon, authenticated, service_role;

comment on function public.audit_appointment_change() is
  'The single writer of appointment audit events (0038, C41-02). Fires for '
  'every successful insert or watched-column update, whatever path made it — '
  'an ordinary client PATCH included, which is what 0031 missed. The five '
  'case-registry RPCs no longer audit appointments themselves; see §3.';

drop trigger if exists appointments_audit on public.appointments;
create trigger appointments_audit
  after insert or update on public.appointments
  for each row execute function public.audit_appointment_change();


-- ---------------------------------------------------------------------------
-- 2. Nothing else on this table changes.
--
-- No policy is added, dropped or rewritten. No grant moves. `audit_logs`
-- remains SELECT-only for clients with no INSERT, UPDATE or DELETE policy for
-- any role, and app_private.write_audit() stays revoked from all four grantees.
-- This migration widens no read surface; it fills one in that was empty.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 3. The five RPCs, restated with their appointment audit calls removed.
--
-- Everything below this line is 0031's text with six `perform
-- app_private.write_audit('appointments', ...)` statements deleted and NOTHING
-- else altered — not a predicate, not a lock, not a denial, not a comment that
-- did not belong to a deleted call.
--
-- Do not hand-edit this section to fix something else. A change here that the
-- verifier does not know about will be reported as a transcription failure,
-- which is the point. If one of these functions needs a real change, it wants
-- its own migration and its own review.
--
--   node scripts/verify-0038-bodies.mjs
-- ---------------------------------------------------------------------------
create or replace function public.set_tb_case_status(
  p_case_id             uuid,
  p_new_status          text,
  p_treatment_start_date date default null,
  p_outcome             text default null,
  p_outcome_date        date default null
) returns public.tb_cases
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_caller  record;
  v_old     public.tb_cases;
  v_new     public.tb_cases;
  v_start   date;
  v_appt    record;
  v_action  text;
begin
  select * into v_caller from app_private.tbdots_caller();

  select * into v_old from public.tb_cases
   where case_id = p_case_id and facility_id = v_caller.caller_facility_id
     for update;
  if not found then
    perform app_private.deny();
  end if;

  if not public.tb_case_transition_allowed(v_old.case_status, p_new_status) then
    raise exception 'tb_cases: % is not a permitted transition from %',
      p_new_status, v_old.case_status
      using errcode = '42501';
  end if;

  -- Shape the target row. The CHECKs in §5 are the authority; these raises
  -- exist so the caller gets a sentence instead of a constraint name.
  if p_new_status = 'on_treatment' then
    v_start := coalesce(p_treatment_start_date, v_old.treatment_start_date);
    if v_start is null then
      raise exception 'set_tb_case_status: starting treatment requires a start date'
        using errcode = '22004';
    end if;
    if v_start > public.manila_today() then
      raise exception 'set_tb_case_status: treatment start date % is in the future', v_start
        using errcode = '22007';
    end if;
  else
    v_start := v_old.treatment_start_date;
  end if;

  if p_new_status = 'closed' then
    if p_outcome is null or p_outcome_date is null then
      raise exception 'set_tb_case_status: closing a case requires an outcome and its date'
        using errcode = '22004';
    end if;
    if p_outcome_date > public.manila_today() then
      raise exception 'set_tb_case_status: outcome date % is in the future', p_outcome_date
        using errcode = '22007';
    end if;

    -- M31-04. §8.1's trigger enforces `visit_date <= outcome_date` only when a
    -- FOLLOW-UP is written; closing the parent never re-checked the rows that
    -- already exist. So a case could be closed with an outcome dated before a
    -- visit it had already recorded — an episode that ended before its own last
    -- visit, which every timeline and duration figure would then repeat.
    --
    -- The invariant belongs to the pair, so it is enforced from both sides:
    -- here when the case moves, in the trigger when the follow-up moves.
    if exists (
      select 1 from public.treatment_followups f
       where f.case_id = p_case_id
         and f.voided_at is null
         and f.visit_date > p_outcome_date
    ) then
      raise exception
        'set_tb_case_status: outcome date % precedes a recorded visit on this case',
        p_outcome_date
        using errcode = '22007',
              hint = 'Correct or void the later follow-up first, or close on a later date.';
    end if;
  elsif p_outcome is not null or p_outcome_date is not null then
    raise exception 'set_tb_case_status: an outcome belongs only to a closed case'
      using errcode = '22023';
  end if;

  -- D3 — the cancellation sweep, before the status changes.
  if p_new_status in ('closed','cancelled') then
    for v_appt in
      select appointment_id, patient_id, facility_id, scheduled_date
        from public.appointments
       where tb_case_id = p_case_id
         and status = 'scheduled'
         and scheduled_date >= public.manila_today()
       for update
    loop
      update public.appointments
         set status = 'cancelled'
       where appointment_id = v_appt.appointment_id;
    end loop;
  end if;

  update public.tb_cases
     set case_status          = p_new_status,
         treatment_start_date = v_start,
         outcome              = case when p_new_status = 'closed' then p_outcome else null end,
         outcome_date         = case when p_new_status = 'closed' then p_outcome_date else null end
   where case_id = p_case_id
  returning * into v_new;

  v_action := case p_new_status
                when 'closed'    then 'closed'
                when 'cancelled' then 'cancelled'
                else 'status_changed'
              end;

  perform app_private.write_audit(
    'tb_cases', v_new.case_id, v_action, v_new.patient_id, v_new.facility_id,
    jsonb_strip_nulls(jsonb_build_object(
      'case_status', jsonb_build_object('from', v_old.case_status, 'to', v_new.case_status),
      'treatment_start_date',
        case when v_old.treatment_start_date is distinct from v_new.treatment_start_date
             then jsonb_build_object('from', v_old.treatment_start_date, 'to', v_new.treatment_start_date) end,
      'outcome',
        case when v_old.outcome is distinct from v_new.outcome
             then jsonb_build_object('from', v_old.outcome, 'to', v_new.outcome) end,
      'outcome_date',
        case when v_old.outcome_date is distinct from v_new.outcome_date
             then jsonb_build_object('from', v_old.outcome_date, 'to', v_new.outcome_date) end
    )));

  return v_new;
end;
$fn$;


create or replace function public.claim_unassigned_appointment(p_appointment_id uuid)
returns public.appointments
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_caller record;
  v_appt   public.appointments;
begin
  select * into v_caller from app_private.tbdots_caller();

  select * into v_appt from public.appointments
   where appointment_id = p_appointment_id for update;
  if not found or v_appt.facility_id is not null then
    perform app_private.deny();
  end if;

  -- The same authority rule the read policy uses: true only when EVERY
  -- referral for this patient names the caller's own facility.
  if not public.caller_owns_unassigned_appointment(v_appt.patient_id) then
    perform app_private.deny();
  end if;

  perform set_config('tbscreen.ownership_change', 'on', true);

  update public.appointments set facility_id = v_caller.caller_facility_id
   where appointment_id = p_appointment_id
  returning * into v_appt;
  perform set_config('tbscreen.ownership_change', 'off', true);

  return v_appt;
end;
$fn$;


create or replace function public.assign_appointment_to_case(
  p_appointment_id uuid,
  p_case_id        uuid
) returns public.appointments
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_caller record;
  v_old    public.appointments;
  v_appt   public.appointments;
begin
  select * into v_caller from app_private.tbdots_caller();

  select * into v_old from public.appointments
   where appointment_id = p_appointment_id
     and facility_id = v_caller.caller_facility_id
     for update;
  if not found then
    perform app_private.deny();
  end if;

  -- M31-02: the PATIENT has to match too, not just the facility. The
  -- patient-aware FK would now reject the mismatch anyway, but an FK violation
  -- is a constraint name in a log, and this is an authorization question — a
  -- caller asking to attach one patient's appointment to another patient's
  -- episode gets the uniform denial, like every other admission failure.
  if not exists (
    select 1 from public.tb_cases c
     where c.case_id = p_case_id
       and c.facility_id = v_caller.caller_facility_id
       and c.patient_id = v_old.patient_id
       and c.case_status not in ('closed','cancelled')
  ) then
    perform app_private.deny();
  end if;

  perform set_config('tbscreen.ownership_change', 'on', true);

  update public.appointments
     set referral_id = null,
         tb_case_id  = p_case_id
   where appointment_id = p_appointment_id
  returning * into v_appt;
  perform set_config('tbscreen.ownership_change', 'off', true);

  return v_appt;
end;
$fn$;


create or replace function public.record_visit(
  p_case_id              uuid,
  p_visit_date           date,
  p_appointment_id       uuid default null,
  p_notes                text default null,
  p_next_scheduled_date  date default null,
  p_new_case_status      text default null,
  p_treatment_start_date date default null,
  p_outcome              text default null,
  p_outcome_date         date default null,
  p_request_id           uuid default null
) returns public.treatment_followups
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_caller      record;
  v_case        public.tb_cases;
  v_appt_old    public.appointments;
  v_appt        public.appointments;
  v_followup    public.treatment_followups;
  v_next        uuid;
  v_fingerprint text;
  v_replay      uuid;
  v_visit       date;
begin
  select * into v_caller from app_private.tbdots_caller();

  v_visit := coalesce(p_visit_date, public.manila_today());

  -- M31-05. Reject what this function cannot honestly represent, BEFORE any
  -- row is written, so a caller is never told a visit was recorded and a status
  -- moved when only the first is true.
  if p_new_case_status = 'cancelled' then
    raise exception
      'record_visit: a case cancelled as opened in error cannot also have a visit recorded'
      using errcode = '22023',
            hint = 'Use set_tb_case_status() to cancel, and void the follow-up if one exists.';
  end if;

  if p_new_case_status is not null
     and p_new_case_status not in ('on_treatment','interrupted','closed') then
    raise exception 'record_visit: % is not a status this call can set', p_new_case_status
      using errcode = '22023';
  end if;

  if p_new_case_status = 'closed' and (p_outcome is null or p_outcome_date is null) then
    raise exception 'record_visit: closing a case requires an outcome and its date'
      using errcode = '22004';
  end if;

  if p_new_case_status is distinct from 'closed'
     and (p_outcome is not null or p_outcome_date is not null) then
    raise exception 'record_visit: an outcome belongs only to a closed case'
      using errcode = '22023';
  end if;

  if p_next_scheduled_date is not null and p_new_case_status = 'closed' then
    raise exception
      'record_visit: cannot book a next appointment while ending the episode'
      using errcode = '22023',
            hint = 'Close the case in its own call; ending it cancels future visits.';
  end if;

  v_fingerprint := app_private.payload_fingerprint(jsonb_build_object(
    'case_id',              p_case_id,
    'visit_date',           v_visit,
    'appointment_id',       p_appointment_id,
    'notes',                p_notes,
    'next_scheduled_date',  p_next_scheduled_date,
    'new_case_status',      p_new_case_status,
    'treatment_start_date', p_treatment_start_date,
    'outcome',              p_outcome,
    'outcome_date',         p_outcome_date
  ));

  v_replay := app_private.replayed_result(
    'record_visit', p_request_id, v_caller.caller_user_id, v_caller.caller_facility_id, v_fingerprint);
  if v_replay is not null then
    select * into v_followup from public.treatment_followups where followup_id = v_replay;
    return v_followup;
  end if;

  select * into v_case from public.tb_cases
   where case_id = p_case_id and facility_id = v_caller.caller_facility_id
     for update;
  if not found then
    perform app_private.deny();
  end if;

  -- Attendance first, so §8.1's invariant sees the appointment already marked.
  if p_appointment_id is not null then
    select * into v_appt_old from public.appointments
     where appointment_id = p_appointment_id
       and facility_id = v_caller.caller_facility_id
       and tb_case_id  = p_case_id
       for update;
    if not found then
      perform app_private.deny();
    end if;

    update public.appointments
       set status = 'attended', attended_date = v_visit
     where appointment_id = p_appointment_id
    returning * into v_appt;
  end if;

  insert into public.treatment_followups
    (case_id, appointment_id, visit_date, notes, recorded_by)
  values
    (p_case_id, p_appointment_id, v_visit, p_notes, v_caller.caller_user_id)
  returning * into v_followup;

  -- The audit records that a visit was recorded and when. It never carries
  -- `notes` — that is the whitelist's whole point.
  perform app_private.write_audit(
    'treatment_followups', v_followup.followup_id, 'created',
    v_case.patient_id, v_case.facility_id,
    jsonb_build_object('visit_date', jsonb_build_object('from', null, 'to', v_visit)));

  if p_next_scheduled_date is not null then
    insert into public.appointments
      (patient_id, scheduled_date, status, facility_id, tb_case_id)
    values
      (v_case.patient_id, p_next_scheduled_date, 'scheduled',
       v_caller.caller_facility_id, p_case_id)
    returning appointment_id into v_next;
  end if;

  -- Delegated to the single transition authority rather than re-implemented,
  -- now with the fields each advertised transition actually needs (M31-05).
  -- It runs LAST, so M31-04's check sees the follow-up just inserted: closing
  -- on a date earlier than this very visit is refused here too.
  if p_new_case_status is not null and p_new_case_status <> v_case.case_status then
    perform public.set_tb_case_status(
      p_case_id, p_new_case_status, p_treatment_start_date, p_outcome, p_outcome_date);
  end if;

  if p_request_id is not null then
    insert into public.rpc_requests
      (operation, request_id, actor_user_id, facility_id,
       payload_fingerprint, result_kind, result_id)
    values
      ('record_visit', p_request_id, v_caller.caller_user_id, v_caller.caller_facility_id,
       v_fingerprint, 'treatment_followup', v_followup.followup_id);
  end if;

  return v_followup;
end;
$fn$;


create or replace function public.correct_followup_visit_date(
  p_followup_id uuid,
  p_visit_date  date
) returns public.treatment_followups
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_caller record;
  v_case   public.tb_cases;
  v_old    public.treatment_followups;
  v_row    public.treatment_followups;
  v_appt   public.appointments;
begin
  select * into v_caller from app_private.tbdots_caller();

  select f.* into v_old
    from public.treatment_followups f
    join public.tb_cases c on c.case_id = f.case_id
   where f.followup_id = p_followup_id
     and c.facility_id = v_caller.caller_facility_id
     for update of f;
  if not found then
    perform app_private.deny();
  end if;

  if v_old.voided_at is not null then
    raise exception 'correct_followup_visit_date: this record is voided'
      using errcode = '22023';
  end if;

  select * into v_case from public.tb_cases where case_id = v_old.case_id;

  -- The appointment moves first, so the follow-up's own temporal trigger sees
  -- the corrected attendance date and re-validates the pair as a whole.
  if v_old.appointment_id is not null then
    update public.appointments
       set attended_date = p_visit_date
     where appointment_id = v_old.appointment_id
    returning * into v_appt;
  end if;

  update public.treatment_followups set visit_date = p_visit_date
   where followup_id = p_followup_id
  returning * into v_row;

  perform app_private.write_audit(
    'treatment_followups', v_row.followup_id, 'updated',
    v_case.patient_id, v_case.facility_id,
    jsonb_build_object('visit_date',
      jsonb_build_object('from', v_old.visit_date, 'to', p_visit_date)));

  return v_row;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. ACLs, re-asserted.
--
-- CREATE OR REPLACE preserves a function's existing grants, so §3 did not drop
-- any. They are restated anyway: Supabase's default privileges grant EXECUTE to
-- `anon` and `service_role` BY NAME (0019, M28-01), and a migration that
-- replaces five reachable RPCs should say out loud what may reach them rather
-- than relying on what a previous file left behind.
-- ---------------------------------------------------------------------------
do $acl$
declare f text;
begin
  foreach f in array array[
    'public.set_tb_case_status(uuid, text, date, text, date)',
    'public.claim_unassigned_appointment(uuid)',
    'public.assign_appointment_to_case(uuid, uuid)',
    'public.record_visit(uuid, date, uuid, text, date, text, date, text, date, uuid)',
    'public.correct_followup_visit_date(uuid, date)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('revoke all on function %s from service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$acl$;


-- ---------------------------------------------------------------------------
-- 5. facility_audit_events() — the viewer's read path.
--
-- KEYSET PAGINATION, not OFFSET, and not "download the table and filter in the
-- browser". The client passes the last row it saw; the server returns the next
-- page. OFFSET would re-scan and, worse, would silently skip or repeat rows
-- when a new event lands between two page requests — an audit viewer that drops
-- an event while you page through it is not an audit viewer.
--
-- SECURITY INVOKER, for the same reason 0034's worklist is: `audit_logs`
-- already carries reviewed RLS from 0031 (tb_dots sees its own facility, admin
-- sees all, nobody else has a policy). Inheriting that is strictly safer than
-- restating it, and it means this function CANNOT widen the boundary even if
-- its own predicates were wrong.
--
-- BHW and midwife therefore receive nothing here, with no role check written:
-- they hold no audit_logs read policy, so RLS returns them an empty set. The
-- brief asks that they get no viewer, and the portal adds no navigation item
-- for them; this function is the second, independent reason they see nothing.
--
-- The tie-break is `audit_id desc` after `occurred_at desc`, and it is load
-- bearing rather than decorative: occurred_at defaults to now(), which is
-- TRANSACTION-stable, so every event written by one RPC — a case closure that
-- cancels three appointments writes four — carries an identical timestamp
-- (C35-03). Ordering on occurred_at alone would let those four rows come back
-- in a different order on each page request and a keyset cursor would then skip
-- or repeat them.
-- ---------------------------------------------------------------------------
create or replace function public.facility_audit_events(
  p_limit         int         default 50,
  p_before_at     timestamptz default null,
  p_before_id     uuid        default null,
  p_entity_table  text        default null
)
returns table (
  audit_id      uuid,
  entity_table  text,
  entity_id     uuid,
  action        text,
  actor_user_id uuid,
  actor_role    text,
  actor_name    text,
  patient_id    uuid,
  facility_id   uuid,
  changes       jsonb,
  occurred_at   timestamptz
)
language sql
stable
security invoker
set search_path = public
as $fn$
  select a.audit_id, a.entity_table, a.entity_id, a.action,
         a.actor_user_id, a.actor_role,
         u.full_name,
         a.patient_id, a.facility_id, a.changes, a.occurred_at
    from public.audit_logs a
    left join public.users u on u.user_id = a.actor_user_id
   where (p_entity_table is null or a.entity_table = p_entity_table)
     and (
       p_before_at is null
       or a.occurred_at < p_before_at
       or (a.occurred_at = p_before_at and p_before_id is not null and a.audit_id < p_before_id)
     )
   order by a.occurred_at desc, a.audit_id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$fn$;

comment on function public.facility_audit_events(int, timestamptz, uuid, text) is
  'Keyset-paginated audit read for the portal viewer (0038). SECURITY INVOKER: '
  'the facility boundary is audit_logs'' own RLS from 0031, not a predicate '
  'here, so this cannot widen it. Returns only whitelisted `changes`; the '
  'whitelist trigger is what keeps clinical values out of that column.';

-- The actor's name is joined from `users`, which has its own RLS. A TB-DOTS
-- account can read `users` rows for bhw staff and itself (0029 §4), so a
-- colleague's name resolves and anyone out of scope comes back NULL rather than
-- leaking. The viewer falls back to the role and the id, which is why the
-- column is nullable and the UI must not assume it.

do $acl$
declare f text := 'public.facility_audit_events(int, timestamptz, uuid, text)';
begin
  execute format('revoke all on function %s from public', f);
  execute format('revoke all on function %s from anon', f);
  execute format('revoke all on function %s from service_role', f);
  execute format('grant execute on function %s to authenticated', f);
end;
$acl$;


-- ============================================================================
-- POST-CHECKS (run separately — the SQL editor returns only the last result).
--
-- The behaviour matrix is supabase/tests/0038_appointment_audit_matrix.sql, run
-- through `node scripts/build-preflight.mjs 0038`.
--
-- 1. The trigger exists, is AFTER INSERT OR UPDATE, and is the only one of its
--    kind on the table:
--
--    select tgname, pg_get_triggerdef(oid) from pg_trigger
--     where tgrelid = 'public.appointments'::regclass and not tgisinternal
--     order by tgname;
--
-- 2. No appointment write_audit call survives in any applied function body:
--
--    select p.proname
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.prosrc like '%write_audit(%'
--       and p.prosrc like '%''appointments''%';
--
--    Expect exactly one row: audit_appointment_change. Any other name is a
--    double-log.
--
-- 3. Security posture of both new functions:
--
--    select p.proname, p.prosecdef, p.provolatile, p.proconfig
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.proname in ('audit_appointment_change', 'facility_audit_events');
--
--    Expect audit_appointment_change  secdef true,  volatile 'v', search_path set;
--           facility_audit_events     secdef false, volatile 's', search_path set.
--
-- 4. audit_logs is still SELECT-only for clients:
--
--    select polname, polcmd from pg_policy
--     where polrelid = 'public.audit_logs'::regclass order by polname;
--
--    Expect only SELECT policies. Any 'a', 'w' or 'd' is a defect.
--
-- 5. The whitelist is unchanged and still fail-closed:
--
--    node scripts/verify-0035-whitelist.mjs        -- must still print 7 OK
--
-- 6. Event volume, read once after application. Every appointment write now
--    produces a row, where before only the RPC paths did:
--
--    select entity_table, action, count(*) from public.audit_logs
--     group by 1, 2 order by 1, 2;
-- ============================================================================
