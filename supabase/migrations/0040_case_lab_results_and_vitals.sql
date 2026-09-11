-- TB-Screen — laboratory results and vital signs recorded during a TB case
--
-- WHY. A case could be opened, started and closed, but nothing between those
-- events could be written down except a visit note. The two things a TB-DOTS
-- nurse actually records while a patient is on treatment had nowhere to go:
--
--   * Follow-up sputum results. DOH-NTP monitors bacteriologically confirmed
--     pulmonary TB with sputum at the end of the intensive phase (month 2), at
--     month 5 and at the end of treatment. "Cured" is DEFINED by those results,
--     so a registry that cannot hold them cannot support the outcome it offers.
--   * Weight (and the other vitals). Drug doses follow weight bands, so weight
--     is taken at visits. The only vitals the case could show were the ones from
--     the original pre-screening.
--
-- WHAT. Two case-scoped, append-only tables:
--
--   case_lab_results  one row per laboratory test result the facility entered
--   case_vitals       one row per set of measurements taken on a day
--
-- Both follow treatment_followups' correction model: a wrong row is VOIDED with
-- a reason (void_case_lab_result / void_case_vitals) and re-entered, never
-- edited in place. No client role holds UPDATE or DELETE.
--
-- POSITIONING. These are values a person at the facility typed in. Nothing here
-- computes a result, a classification or an outcome: closing a case as "cured"
-- stays a human decision made through set_tb_case_status / record_visit. Vitals
-- carry no interpretation, exactly as on screenings (0024).
--
-- AUDIT. One trigger per table is the single writer of its audit rows, the 0038
-- lesson. Only the DATE and the void fields are audited — never the result, the
-- measurements, the sample id or the notes — because audit_logs is readable by
-- admin, who holds no clinical read policy (see 0035's header).

do $guard$
begin
  if to_regprocedure('public.current_user_active_role()') is null
     or to_regprocedure('public.manila_today()') is null
     or to_regprocedure('app_private.own_facility_case_ids()') is null
     or to_regprocedure('app_private.tbdots_caller()') is null
     or to_regprocedure('app_private.deny()') is null
     or to_regprocedure('app_private.write_audit(text,uuid,text,uuid,uuid,jsonb)') is null
     or to_regprocedure('public.audit_appointment_change()') is null then
    raise exception '0040 requires migrations 0028, 0031, 0035 and 0038';
  end if;
end;
$guard$;


-- ---------------------------------------------------------------------------
-- 1. case_lab_results
-- ---------------------------------------------------------------------------
create table if not exists public.case_lab_results (
  lab_result_id  uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.tb_cases(case_id) on delete restrict,
  -- Xpert MTB/RIF (or another rapid molecular test), direct sputum smear
  -- microscopy, culture, or anything else the laboratory reports.
  test_type      text not null
                   check (test_type in ('xpert','smear','culture','other')),
  -- Where in treatment the test sits. The three monitoring points are the
  -- DOH-NTP schedule for drug-susceptible pulmonary TB; 'other' covers an
  -- extension month, a repeat, or a regimen with a different schedule.
  purpose        text not null
                   check (purpose in ('baseline','month_2','month_5',
                                      'end_of_treatment','other')),
  result_date    date not null,
  -- 'invalid' is a real laboratory answer (an Xpert error, a leaked specimen)
  -- and must be recordable without pretending it was negative.
  result_outcome text not null
                   check (result_outcome in ('positive','negative','invalid')),
  lab_sample_id  text
                   check (lab_sample_id is null
                          or length(btrim(lab_sample_id)) between 1 and 64),
  notes          text check (notes is null or length(notes) <= 1000),
  recorded_by    uuid not null default auth.uid() references public.users(user_id),
  created_at     timestamptz not null default now(),
  voided_at      timestamptz,
  voided_by      uuid references public.users(user_id),
  void_reason    text,

  constraint case_lab_results_void_triple check (
    (voided_at is null and voided_by is null and void_reason is null)
    or
    (voided_at is not null and voided_by is not null and void_reason is not null)
  )
);

create index if not exists case_lab_results_case_idx
  on public.case_lab_results (case_id, result_date desc);

comment on table public.case_lab_results is
  'Laboratory results entered by TB-DOTS staff during a TB case (0040). '
  'Append-only; corrections are voids with a reason. Facility-only.';
comment on column public.case_lab_results.notes is
  'Free clinical text, facility-only. Never enters an SMS, a report, an audit '
  'payload, or the mobile device.';


-- ---------------------------------------------------------------------------
-- 2. case_vitals — the same seven fields and ranges as screenings (0024).
-- ---------------------------------------------------------------------------
create table if not exists public.case_vitals (
  vitals_id      uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.tb_cases(case_id) on delete restrict,
  measured_on    date not null,
  height_cm      numeric(5,1)
                   check (height_cm is null or (height_cm >= 30 and height_cm <= 250)),
  weight_kg      numeric(5,1)
                   check (weight_kg is null or (weight_kg >= 1 and weight_kg <= 400)),
  temperature_c  numeric(4,1)
                   check (temperature_c is null or (temperature_c >= 30 and temperature_c <= 45)),
  systolic_bp    int
                   check (systolic_bp is null or (systolic_bp >= 50 and systolic_bp <= 300)),
  diastolic_bp   int
                   check (diastolic_bp is null or (diastolic_bp >= 20 and diastolic_bp <= 200)),
  pulse_rate     int
                   check (pulse_rate is null or (pulse_rate >= 20 and pulse_rate <= 250)),
  spo2_percent   int
                   check (spo2_percent is null or (spo2_percent >= 50 and spo2_percent <= 100)),
  recorded_by    uuid not null default auth.uid() references public.users(user_id),
  created_at     timestamptz not null default now(),
  voided_at      timestamptz,
  voided_by      uuid references public.users(user_id),
  void_reason    text,

  -- A row with nothing measured records nothing. Screenings allow all-null
  -- because the checklist is the row's real content; here the vitals are.
  constraint case_vitals_something_measured check (
    num_nonnulls(height_cm, weight_kg, temperature_c, systolic_bp,
                 diastolic_bp, pulse_rate, spo2_percent) > 0
  ),
  constraint case_vitals_void_triple check (
    (voided_at is null and voided_by is null and void_reason is null)
    or
    (voided_at is not null and voided_by is not null and void_reason is not null)
  )
);

create index if not exists case_vitals_case_idx
  on public.case_vitals (case_id, measured_on desc);

comment on table public.case_vitals is
  'Vital signs measured during a TB case (0040). Measurements only, no '
  'interpretation. Append-only; corrections are voids with a reason.';


-- ---------------------------------------------------------------------------
-- 3. Bounds. Cross-row, so triggers rather than CHECKs.
--
-- SECURITY INVOKER on purpose: the case is read through tb_cases' own RLS, so
-- a case the caller may not see is simply not found and the uniform denial is
-- raised — BEFORE triggers run ahead of the policy's WITH CHECK, so this must
-- not be the thing that reveals whether a foreign case exists.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_case_lab_result_bounds()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  c record;
begin
  -- A baseline test legitimately predates case registration, so the floor is
  -- the day the originating referral was created when there is one. A result
  -- that arrives after the case closed is still a fact and is accepted.
  select tc.case_status,
         least(tc.registration_date,
               coalesce((select (r.created_at at time zone 'Asia/Manila')::date
                           from public.referrals r
                          where r.referral_id = tc.referral_id),
                        tc.registration_date)) as floor_date
    into c
    from public.tb_cases tc
   where tc.case_id = new.case_id;
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and c.case_status = 'cancelled' then
    raise exception 'case_lab_results: a cancelled case takes no new results'
      using errcode = '42501';
  end if;

  if new.result_date < c.floor_date then
    raise exception 'case_lab_results: result date % precedes the referral or case', new.result_date
      using errcode = '22007';
  end if;
  if new.result_date > public.manila_today() then
    raise exception 'case_lab_results: result date % is in the future', new.result_date
      using errcode = '22007';
  end if;

  return new;
end;
$fn$;

create or replace function public.enforce_case_vitals_bounds()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  c record;
begin
  select case_status, registration_date, outcome_date
    into c
    from public.tb_cases
   where case_id = new.case_id;
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and c.case_status = 'cancelled' then
    raise exception 'case_vitals: a cancelled case takes no new measurements'
      using errcode = '42501';
  end if;
  if new.measured_on < c.registration_date then
    raise exception 'case_vitals: measured on % before case registration %',
      new.measured_on, c.registration_date
      using errcode = '22007';
  end if;
  if new.measured_on > public.manila_today() then
    raise exception 'case_vitals: measured on % is in the future', new.measured_on
      using errcode = '22007';
  end if;
  if c.outcome_date is not null and new.measured_on > c.outcome_date then
    raise exception 'case_vitals: measured on % after the case outcome date %',
      new.measured_on, c.outcome_date
      using errcode = '22007';
  end if;

  return new;
end;
$fn$;

revoke all on function public.enforce_case_lab_result_bounds() from public, anon, authenticated, service_role;
revoke all on function public.enforce_case_vitals_bounds() from public, anon, authenticated, service_role;

drop trigger if exists case_lab_results_bounds on public.case_lab_results;
create trigger case_lab_results_bounds
  before insert or update on public.case_lab_results
  for each row execute function public.enforce_case_lab_result_bounds();

drop trigger if exists case_vitals_bounds on public.case_vitals;
create trigger case_vitals_bounds
  before insert or update on public.case_vitals
  for each row execute function public.enforce_case_vitals_bounds();

-- Everything but the three void fields is fixed once written, including for
-- the void RPCs below: they run SECURITY DEFINER but under the caller's JWT, so
-- enforce_immutable_columns still applies to them.
drop trigger if exists case_lab_results_immutable_columns on public.case_lab_results;
create trigger case_lab_results_immutable_columns
  before update on public.case_lab_results
  for each row execute function public.enforce_immutable_columns(
    'lab_result_id', 'case_id', 'test_type', 'purpose', 'result_date',
    'result_outcome', 'lab_sample_id', 'notes', 'recorded_by', 'created_at'
  );

drop trigger if exists case_vitals_immutable_columns on public.case_vitals;
create trigger case_vitals_immutable_columns
  before update on public.case_vitals
  for each row execute function public.enforce_immutable_columns(
    'vitals_id', 'case_id', 'measured_on', 'height_cm', 'weight_kg',
    'temperature_c', 'systolic_bp', 'diastolic_bp', 'pulse_rate',
    'spo2_percent', 'recorded_by', 'created_at'
  );


-- ---------------------------------------------------------------------------
-- 4. RLS and privileges. TB-DOTS staff of the owning facility only — the same
-- audience as treatment_followups. BHW, midwife and admin get no policy.
--
-- INSERT is a column-level grant that leaves out recorded_by, created_at and
-- the void fields: recorded_by takes its auth.uid() default and cannot be
-- forged, and a row cannot be born voided. No UPDATE or DELETE grant at all.
-- ---------------------------------------------------------------------------
alter table public.case_lab_results enable row level security;
revoke all on public.case_lab_results from anon, authenticated;
grant select on public.case_lab_results to authenticated;
grant insert (lab_result_id, case_id, test_type, purpose, result_date,
              result_outcome, lab_sample_id, notes)
  on public.case_lab_results to authenticated;

drop policy if exists case_lab_results_tbdots_read on public.case_lab_results;
create policy case_lab_results_tbdots_read on public.case_lab_results
  for select to authenticated
  using (
    public.current_user_active_role() = 'tb_dots'
    and case_id in (select app_private.own_facility_case_ids())
  );

drop policy if exists case_lab_results_tbdots_insert on public.case_lab_results;
create policy case_lab_results_tbdots_insert on public.case_lab_results
  for insert to authenticated
  with check (
    public.current_user_active_role() = 'tb_dots'
    and case_id in (select app_private.own_facility_case_ids())
    and recorded_by = auth.uid()
  );

alter table public.case_vitals enable row level security;
revoke all on public.case_vitals from anon, authenticated;
grant select on public.case_vitals to authenticated;
grant insert (vitals_id, case_id, measured_on, height_cm, weight_kg,
              temperature_c, systolic_bp, diastolic_bp, pulse_rate, spo2_percent)
  on public.case_vitals to authenticated;

drop policy if exists case_vitals_tbdots_read on public.case_vitals;
create policy case_vitals_tbdots_read on public.case_vitals
  for select to authenticated
  using (
    public.current_user_active_role() = 'tb_dots'
    and case_id in (select app_private.own_facility_case_ids())
  );

drop policy if exists case_vitals_tbdots_insert on public.case_vitals;
create policy case_vitals_tbdots_insert on public.case_vitals
  for insert to authenticated
  with check (
    public.current_user_active_role() = 'tb_dots'
    and case_id in (select app_private.own_facility_case_ids())
    and recorded_by = auth.uid()
  );


-- ---------------------------------------------------------------------------
-- 5. Voiding — the only write after insert.
-- ---------------------------------------------------------------------------
create or replace function public.void_case_lab_result(
  p_lab_result_id uuid,
  p_reason        text
) returns public.case_lab_results
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_caller record;
  v_row    public.case_lab_results;
begin
  select * into v_caller from app_private.tbdots_caller();

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'void_case_lab_result: a reason is required' using errcode = '22004';
  end if;

  select r.* into v_row
    from public.case_lab_results r
    join public.tb_cases c on c.case_id = r.case_id
   where r.lab_result_id = p_lab_result_id
     and c.facility_id = v_caller.caller_facility_id
     for update of r;
  if not found then
    perform app_private.deny();
  end if;

  if v_row.voided_at is not null then
    raise exception 'void_case_lab_result: this record is already voided'
      using errcode = '22023';
  end if;

  update public.case_lab_results
     set voided_at = now(), voided_by = v_caller.caller_user_id, void_reason = btrim(p_reason)
   where lab_result_id = p_lab_result_id
  returning * into v_row;

  return v_row;
end;
$fn$;

create or replace function public.void_case_vitals(
  p_vitals_id uuid,
  p_reason    text
) returns public.case_vitals
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_caller record;
  v_row    public.case_vitals;
begin
  select * into v_caller from app_private.tbdots_caller();

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'void_case_vitals: a reason is required' using errcode = '22004';
  end if;

  select v.* into v_row
    from public.case_vitals v
    join public.tb_cases c on c.case_id = v.case_id
   where v.vitals_id = p_vitals_id
     and c.facility_id = v_caller.caller_facility_id
     for update of v;
  if not found then
    perform app_private.deny();
  end if;

  if v_row.voided_at is not null then
    raise exception 'void_case_vitals: this record is already voided'
      using errcode = '22023';
  end if;

  update public.case_vitals
     set voided_at = now(), voided_by = v_caller.caller_user_id, void_reason = btrim(p_reason)
   where vitals_id = p_vitals_id
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.void_case_lab_result(uuid, text) from public, anon, service_role;
grant execute on function public.void_case_lab_result(uuid, text) to authenticated;
revoke all on function public.void_case_vitals(uuid, text) from public, anon, service_role;
grant execute on function public.void_case_vitals(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Audit. Admit the two tables, then one trigger each as the single writer.
--
-- The whitelist below is 0035's text with two arms added and nothing else.
-- ---------------------------------------------------------------------------
alter table public.audit_logs drop constraint if exists audit_logs_entity_table_check;
alter table public.audit_logs
  add constraint audit_logs_entity_table_check
  check (entity_table in ('tb_cases','treatment_followups','appointments','referrals',
                          'case_lab_results','case_vitals'));

create or replace function public.enforce_audit_changes_whitelist()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  allowed text[];
  k       text;
begin
  if new.changes is null then
    new.changes := '{}'::jsonb;
  end if;

  if jsonb_typeof(new.changes) <> 'object' then
    raise exception 'audit_logs.changes must be a JSON object, got %',
      jsonb_typeof(new.changes)
      using errcode = '22023';
  end if;

  allowed := case new.entity_table
    when 'tb_cases' then array[
      'case_status','treatment_start_date','outcome','outcome_date',
      'registration_date','facility_id','case_number']
    when 'treatment_followups' then array[
      'visit_date','voided_at','void_reason']
    when 'appointments' then array[
      'status','scheduled_date','attended_date',
      'facility_id','referral_id','tb_case_id']
    -- 0035. `result` and `result_outcome` are absent on purpose — see this
    -- file's header for why a TB finding must not reach an admin-readable log.
    when 'referrals' then array[
      'status','presented','result_date','facility_id','lab_sample_id']
    -- 0040. Dates and voids only; the finding and the measurements stay out
    -- for the same reason as referrals' result.
    when 'case_lab_results' then array[
      'result_date','voided_at','void_reason']
    when 'case_vitals' then array[
      'measured_on','voided_at','void_reason']
  end;

  -- 0035. Without this, an entity_table the CASE does not name leaves `allowed`
  -- NULL, every `k = any(allowed)` evaluates to NULL, and the loop below raises
  -- nothing — the whitelist silently accepts anything. It was masked only by
  -- the entity_table CHECK, which is not a guarantee this function may rely on:
  -- the CHECK is evaluated AFTER this BEFORE trigger, and widening it (as §1
  -- just did) is exactly when the two disagree.
  if allowed is null then
    raise exception 'audit_logs: no whitelist is defined for entity_table %',
      new.entity_table
      using errcode = '22023',
            hint = 'Add an arm to enforce_audit_changes_whitelist() in the same '
                   'migration that widens the entity_table CHECK.';
  end if;

  for k in select jsonb_object_keys(new.changes) loop
    if not (k = any(allowed)) then
      raise exception
        'audit_logs: column %.% is not on the audit whitelist',
        new.entity_table, k
        using errcode = '42501',
              hint = 'Clinical free text and contact data must never be audited. '
                     'Widening the whitelist takes a migration and a review.';
    end if;
  end loop;

  return new;
end;
$fn$;

-- audit_logs_admin_read is revisited as 0031 requires and LEFT UNCHANGED: the
-- keys added are a result date, a measurement date and the void pair that
-- treatment_followups already audits. None is a finding or a measurement.

create or replace function public.audit_case_lab_result_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_case public.tb_cases;
begin
  select * into v_case from public.tb_cases where case_id = new.case_id;

  if tg_op = 'INSERT' then
    perform app_private.write_audit(
      'case_lab_results', new.lab_result_id, 'created',
      v_case.patient_id, v_case.facility_id,
      jsonb_build_object('result_date', jsonb_build_object('from', null, 'to', new.result_date)));
  elsif new.voided_at is distinct from old.voided_at then
    perform app_private.write_audit(
      'case_lab_results', new.lab_result_id, 'voided',
      v_case.patient_id, v_case.facility_id,
      jsonb_build_object(
        'voided_at',   jsonb_build_object('from', old.voided_at, 'to', new.voided_at),
        'void_reason', jsonb_build_object('from', old.void_reason, 'to', new.void_reason)));
  end if;
  return null;
end;
$fn$;

create or replace function public.audit_case_vitals_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_case public.tb_cases;
begin
  select * into v_case from public.tb_cases where case_id = new.case_id;

  if tg_op = 'INSERT' then
    perform app_private.write_audit(
      'case_vitals', new.vitals_id, 'created',
      v_case.patient_id, v_case.facility_id,
      jsonb_build_object('measured_on', jsonb_build_object('from', null, 'to', new.measured_on)));
  elsif new.voided_at is distinct from old.voided_at then
    perform app_private.write_audit(
      'case_vitals', new.vitals_id, 'voided',
      v_case.patient_id, v_case.facility_id,
      jsonb_build_object(
        'voided_at',   jsonb_build_object('from', old.voided_at, 'to', new.voided_at),
        'void_reason', jsonb_build_object('from', old.void_reason, 'to', new.void_reason)));
  end if;
  return null;
end;
$fn$;

revoke all on function public.audit_case_lab_result_change() from public, anon, authenticated, service_role;
revoke all on function public.audit_case_vitals_change() from public, anon, authenticated, service_role;

drop trigger if exists case_lab_results_audit on public.case_lab_results;
create trigger case_lab_results_audit
  after insert or update on public.case_lab_results
  for each row execute function public.audit_case_lab_result_change();

drop trigger if exists case_vitals_audit on public.case_vitals;
create trigger case_vitals_audit
  after insert or update on public.case_vitals
  for each row execute function public.audit_case_vitals_change();
