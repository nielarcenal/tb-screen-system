-- 0041 patient timeline: case lab result and vitals events.
-- Run only through: node scripts/build-preflight.mjs 0041

create temp table t_ids (k text primary key, v uuid) on commit drop;
insert into t_ids (k, v)
select k, gen_random_uuid() from unnest(array[
  'fac_bhs','fac_a','fac_b','bhw','staff_a','staff_b',
  'pat','screen','ref','case_a','lab_live','lab_void','vitals_live','vitals_void'
]) k;

create or replace function pg_temp.id(p_key text) returns uuid
language sql stable as $$ select v from t_ids where k = p_key $$;

insert into public.facilities (facility_id, name, type, address, short_code)
values
  (pg_temp.id('fac_bhs'), '0041 BHS',    'barangay_health_station', 'test', null),
  (pg_temp.id('fac_a'),   '0041 DOTS A', 'tb_dots', 'test', 'T41A'),
  (pg_temp.id('fac_b'),   '0041 DOTS B', 'tb_dots', 'test', 'T41B');

insert into auth.users (id)
select v from t_ids where k in ('bhw','staff_a','staff_b');

insert into public.users
  (user_id, role, full_name, facility_id, assigned_barangay_code, active)
values
  (pg_temp.id('bhw'), 'bhw', '0041 BHW', pg_temp.id('fac_bhs'),
   (select min(barangay_code) from public.ref_barangays), true),
  (pg_temp.id('staff_a'), 'tb_dots', '0041 Staff A', pg_temp.id('fac_a'), null, true),
  (pg_temp.id('staff_b'), 'tb_dots', '0041 Staff B', pg_temp.id('fac_b'), null, true);

insert into public.patients
  (patient_id, display_code, enrolled_by, full_name, first_name, middle_name,
   last_name, birthdate, age, sex, barangay_code, sms_consent)
values
  (pg_temp.id('pat'), 'T41A-0001', pg_temp.id('bhw'), 'Rosa Lim', 'Rosa', null,
   'Lim', date '1979-07-12', 47, 'female',
   (select min(barangay_code) from public.ref_barangays), false);

insert into public.screenings
  (screening_id, patient_id, symptom_flags, pgis_severity, referred)
values (
  pg_temp.id('screen'), pg_temp.id('pat'),
  '{"cough_2wks":"yes","weight_loss":"no","night_sweats":"no","fever":"no","hemoptysis":"no","chest_pain":"no","fatigue":"no","loss_of_appetite":"no","tb_contact":"no"}',
  'mild', true);

insert into public.referrals
  (referral_id, patient_id, screening_id, facility_id, status, presented,
   result_outcome, result_date)
values (
  pg_temp.id('ref'), pg_temp.id('pat'), pg_temp.id('screen'), pg_temp.id('fac_a'),
  'tested', true, 'positive', now());

insert into public.tb_cases
  (case_id, patient_id, referral_id, facility_id, case_number, registration_date,
   case_status, treatment_start_date, created_by)
values
  (pg_temp.id('case_a'), pg_temp.id('pat'), pg_temp.id('ref'), pg_temp.id('fac_a'),
   'TBC-T41A-2026-99001', public.manila_today(), 'on_treatment', public.manila_today(),
   pg_temp.id('staff_a'));

insert into public.case_lab_results
  (lab_result_id, case_id, test_type, purpose, result_date, result_outcome,
   lab_sample_id, notes, recorded_by, voided_at, voided_by, void_reason)
values
  (pg_temp.id('lab_live'), pg_temp.id('case_a'), 'smear', 'month_2', public.manila_today(),
   'negative', 'LAB-41', 'secret clinical note', pg_temp.id('staff_a'), null, null, null),
  (pg_temp.id('lab_void'), pg_temp.id('case_a'), 'xpert', 'baseline', public.manila_today(),
   'positive', null, null, pg_temp.id('staff_a'), now(), pg_temp.id('staff_a'), 'wrong case');

insert into public.case_vitals
  (vitals_id, case_id, measured_on, weight_kg, recorded_by, voided_at, voided_by, void_reason)
values
  (pg_temp.id('vitals_live'), pg_temp.id('case_a'), public.manila_today(), 51.2,
   pg_temp.id('staff_a'), null, null, null),
  (pg_temp.id('vitals_void'), pg_temp.id('case_a'), public.manila_today(), 99.9,
   pg_temp.id('staff_a'), now(), pg_temp.id('staff_a'), 'typo');

create temp table t_result (
  check_kind text, expected text, actual text, verdict text
) on commit drop;

create temp table t_events on commit drop as
select * from public.patient_timeline(null::uuid, 1) where false;

do $temp_grants$
declare s text := pg_my_temp_schema()::regnamespace::text;
begin
  execute format('grant usage on schema %s to authenticated', s);
  execute format('grant select on %s.t_ids to authenticated', s);
  execute format('grant insert on %s.t_events to authenticated', s);
end;
$temp_grants$;

create or replace function pg_temp.as_user(p_uid uuid) returns void
language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end;
$$;

-- Captures the timeline exactly as a given user receives it.
create or replace function pg_temp.timeline_as(p_uid uuid) returns void
language plpgsql as $$
begin
  delete from t_events;
  perform pg_temp.as_user(p_uid);
  insert into t_events select * from public.patient_timeline(pg_temp.id('pat'), 500);
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.expect(p_kind text, p_expected text, p_actual text)
returns void language sql as $$
  insert into t_result values (p_kind, p_expected, coalesce(p_actual, 'null'),
    case when p_expected = p_actual then 'PASS' else 'FAIL' end);
$$;

-- ---------------------------------------------------------------------------
-- Owning facility.
-- ---------------------------------------------------------------------------
select pg_temp.timeline_as(pg_temp.id('staff_a'));

select pg_temp.expect('owner: live lab result appears once', '1',
  (select count(*)::text from t_events
    where event_id = 'case_lab_result_recorded:' || pg_temp.id('lab_live')));

select pg_temp.expect('owner: live vitals appear once', '1',
  (select count(*)::text from t_events
    where event_id = 'case_vitals_recorded:' || pg_temp.id('vitals_live')));

select pg_temp.expect('owner: voided rows are excluded', '0',
  (select count(*)::text from t_events
    where event_id in ('case_lab_result_recorded:' || pg_temp.id('lab_void'),
                       'case_vitals_recorded:' || pg_temp.id('vitals_void'))));

select pg_temp.expect('lab detail: test and treatment point only', 'purpose,test_type / month_2 / smear',
  (select (select string_agg(k, ',' order by k) from jsonb_object_keys(detail) k)
          || ' / ' || (detail->>'purpose') || ' / ' || (detail->>'test_type')
     from t_events where event_type = 'case_lab_result_recorded'));

select pg_temp.expect('lab detail: no result value, sample id or notes', 'false',
  (select (detail::text ~* 'negative|positive|LAB-41|secret')::text
     from t_events where event_type = 'case_lab_result_recorded'));

select pg_temp.expect('vitals detail: no measurements', '{}',
  (select detail::text from t_events where event_type = 'case_vitals_recorded'));

select pg_temp.expect('new events carry case, facility, recorder and date', 'true',
  (select bool_and(case_id = pg_temp.id('case_a') and facility_id = pg_temp.id('fac_a')
                   and actor_user_id = pg_temp.id('staff_a') and actor_role = 'tb_dots'
                   and occurred_on = public.manila_today() and not is_undated)::text
     from t_events where event_type in ('case_lab_result_recorded','case_vitals_recorded')));

select pg_temp.expect('same-day order: vitals before lab result', 'case_vitals_recorded,case_lab_result_recorded',
  (select string_agg(event_type, ',' order by rank)
     from t_events where event_type in ('case_lab_result_recorded','case_vitals_recorded')));

select pg_temp.expect('regression: existing arms still present', 'true',
  (select (bool_or(event_type = 'case_registered') and bool_or(event_type = 'treatment_started')
           and bool_or(event_type = 'lab_result_recorded') and bool_or(event_type = 'patient_enrolled'))::text
     from t_events));

-- ---------------------------------------------------------------------------
-- Other callers.
-- ---------------------------------------------------------------------------
select pg_temp.timeline_as(pg_temp.id('staff_b'));
select pg_temp.expect('other facility: sees no case lab or vitals events', '0',
  (select count(*)::text from t_events
    where event_type in ('case_lab_result_recorded','case_vitals_recorded')));

select pg_temp.timeline_as(pg_temp.id('bhw'));
select pg_temp.expect('BHW: receives no timeline at all', '0',
  (select count(*)::text from t_events));

-- ---------------------------------------------------------------------------
-- Posture unchanged.
-- ---------------------------------------------------------------------------
insert into t_result
select 'posture: patient_timeline ACL and definer', 'auth=true anon=false svc=false secdef=true',
       'auth=' || has_function_privilege('authenticated',p.oid,'execute') ||
       ' anon=' || has_function_privilege('anon',p.oid,'execute') ||
       ' svc=' || has_function_privilege('service_role',p.oid,'execute') ||
       ' secdef=' || p.prosecdef,
       case when has_function_privilege('authenticated',p.oid,'execute')
                  and not has_function_privilege('anon',p.oid,'execute')
                  and not has_function_privilege('service_role',p.oid,'execute')
                  and p.prosecdef and p.proconfig is not null
            then 'PASS' else 'FAIL' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname = 'patient_timeline';

select verdict, check_kind, expected, actual from t_result
order by (verdict='PASS'), check_kind;

do $verdict$
declare failed integer; total integer;
begin
  select count(*) filter (where verdict='FAIL'), count(*) into failed,total from t_result;
  if total=0 or failed>0 then
    raise exception '0041 matrix: % of % checks FAILED', failed,total;
  end if;
  raise notice '0041 matrix: all % checks PASSED', total;
end;
$verdict$;
