-- 0040 case laboratory results and vitals behaviour matrix.
-- Run only through: node scripts/build-preflight.mjs 0040

create temp table t_ids (k text primary key, v uuid) on commit drop;
insert into t_ids (k, v)
select k, gen_random_uuid() from unnest(array[
  'fac_bhs','fac_a','fac_b','bhw','staff_a','staff_b','inactive_a',
  'pat','screen','ref','case_a','case_cancelled','lab_a','vitals_a'
]) k;

create or replace function pg_temp.id(p_key text) returns uuid
language sql stable as $$ select v from t_ids where k = p_key $$;

insert into public.facilities (facility_id, name, type, address, short_code)
values
  (pg_temp.id('fac_bhs'), '0040 BHS',    'barangay_health_station', 'test', null),
  (pg_temp.id('fac_a'),   '0040 DOTS A', 'tb_dots', 'test', 'T40A'),
  (pg_temp.id('fac_b'),   '0040 DOTS B', 'tb_dots', 'test', 'T40B');

insert into auth.users (id)
select v from t_ids where k in ('bhw','staff_a','staff_b','inactive_a');

insert into public.users
  (user_id, role, full_name, facility_id, assigned_barangay_code, active)
values
  (pg_temp.id('bhw'), 'bhw', '0040 BHW', pg_temp.id('fac_bhs'),
   (select min(barangay_code) from public.ref_barangays), true),
  (pg_temp.id('staff_a'), 'tb_dots', '0040 Staff A', pg_temp.id('fac_a'), null, true),
  (pg_temp.id('staff_b'), 'tb_dots', '0040 Staff B', pg_temp.id('fac_b'), null, true),
  (pg_temp.id('inactive_a'), 'tb_dots', '0040 Inactive A', pg_temp.id('fac_a'), null, false);

insert into public.patients
  (patient_id, display_code, enrolled_by, full_name, first_name, middle_name,
   last_name, birthdate, age, sex, barangay_code, sms_consent)
values
  (pg_temp.id('pat'), 'T40A-0001', pg_temp.id('bhw'), 'Ana Reyes', 'Ana', null,
   'Reyes', date '1985-03-02', 41, 'female',
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
   'TBC-T40A-2026-99001', public.manila_today(), 'on_treatment', public.manila_today(),
   pg_temp.id('staff_a')),
  (pg_temp.id('case_cancelled'), pg_temp.id('pat'), null, pg_temp.id('fac_a'),
   'TBC-T40A-2026-99002', public.manila_today(), 'cancelled', null,
   pg_temp.id('staff_a'));

create temp table t_result (
  check_kind text, expected text, actual text, verdict text
) on commit drop;

do $temp_grants$
declare s text := pg_my_temp_schema()::regnamespace::text;
begin
  execute format('grant usage on schema %s to authenticated', s);
  execute format('grant select on %s.t_ids to authenticated', s);
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

-- Runs one statement as a user and reports 'ok' or the SQLSTATE it raised.
-- The subtransaction rollback on error also restores the role.
create or replace function pg_temp.attempt(p_uid uuid, p_sql text) returns text
language plpgsql as $$
begin
  perform pg_temp.as_user(p_uid);
  execute p_sql;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return 'ok';
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return sqlstate;
end;
$$;

-- Reads a count as a user.
create or replace function pg_temp.count_as(p_uid uuid, p_sql text) returns integer
language plpgsql as $$
declare n integer;
begin
  perform pg_temp.as_user(p_uid);
  execute p_sql into n;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return n;
end;
$$;

create or replace function pg_temp.expect(p_kind text, p_expected text, p_actual text)
returns void language sql as $$
  insert into t_result values (p_kind, p_expected, coalesce(p_actual, 'null'),
    case when p_expected = p_actual then 'PASS' else 'FAIL' end);
$$;

-- ---------------------------------------------------------------------------
-- Owning facility can write and read.
-- ---------------------------------------------------------------------------
select pg_temp.expect('lab: owning staff inserts a result', 'ok',
  pg_temp.attempt(pg_temp.id('staff_a'), format(
    $q$insert into public.case_lab_results
         (lab_result_id, case_id, test_type, purpose, result_date, result_outcome, lab_sample_id, notes)
       values (%L, %L, 'smear', 'month_2', public.manila_today(), 'negative', 'LAB-0040', 'Scanty none')$q$,
    pg_temp.id('lab_a'), pg_temp.id('case_a'))));

select pg_temp.expect('lab: recorded_by defaults to the caller', pg_temp.id('staff_a')::text,
  (select recorded_by::text from public.case_lab_results where lab_result_id = pg_temp.id('lab_a')));

select pg_temp.expect('lab: owning staff reads it', '1',
  pg_temp.count_as(pg_temp.id('staff_a'),
    format('select count(*) from public.case_lab_results where case_id = %L', pg_temp.id('case_a')))::text);

select pg_temp.expect('vitals: owning staff inserts a measurement', 'ok',
  pg_temp.attempt(pg_temp.id('staff_a'), format(
    $q$insert into public.case_vitals (vitals_id, case_id, measured_on, weight_kg, temperature_c)
       values (%L, %L, public.manila_today(), 52.4, 36.8)$q$,
    pg_temp.id('vitals_a'), pg_temp.id('case_a'))));

select pg_temp.expect('vitals: owning staff reads it', '1',
  pg_temp.count_as(pg_temp.id('staff_a'),
    format('select count(*) from public.case_vitals where case_id = %L', pg_temp.id('case_a')))::text);

-- ---------------------------------------------------------------------------
-- Validation.
-- ---------------------------------------------------------------------------
select pg_temp.expect('vitals: nothing measured is rejected', '23514',
  pg_temp.attempt(pg_temp.id('staff_a'), format(
    $q$insert into public.case_vitals (case_id, measured_on) values (%L, public.manila_today())$q$,
    pg_temp.id('case_a'))));

select pg_temp.expect('vitals: out-of-range weight is rejected', '23514',
  pg_temp.attempt(pg_temp.id('staff_a'), format(
    $q$insert into public.case_vitals (case_id, measured_on, weight_kg) values (%L, public.manila_today(), 900)$q$,
    pg_temp.id('case_a'))));

select pg_temp.expect('vitals: before case registration is rejected', '22007',
  pg_temp.attempt(pg_temp.id('staff_a'), format(
    $q$insert into public.case_vitals (case_id, measured_on, weight_kg) values (%L, public.manila_today() - 1, 50)$q$,
    pg_temp.id('case_a'))));

select pg_temp.expect('lab: future result date is rejected', '22007',
  pg_temp.attempt(pg_temp.id('staff_a'), format(
    $q$insert into public.case_lab_results (case_id, test_type, purpose, result_date, result_outcome)
       values (%L, 'smear', 'month_5', public.manila_today() + 1, 'negative')$q$,
    pg_temp.id('case_a'))));

select pg_temp.expect('lab: result before the referral is rejected', '22007',
  pg_temp.attempt(pg_temp.id('staff_a'), format(
    $q$insert into public.case_lab_results (case_id, test_type, purpose, result_date, result_outcome)
       values (%L, 'xpert', 'baseline', public.manila_today() - 30, 'positive')$q$,
    pg_temp.id('case_a'))));

select pg_temp.expect('lab: unknown result value is rejected', '23514',
  pg_temp.attempt(pg_temp.id('staff_a'), format(
    $q$insert into public.case_lab_results (case_id, test_type, purpose, result_date, result_outcome)
       values (%L, 'smear', 'month_5', public.manila_today(), 'probable')$q$,
    pg_temp.id('case_a'))));

select pg_temp.expect('lab: cancelled case takes no results', '42501',
  pg_temp.attempt(pg_temp.id('staff_a'), format(
    $q$insert into public.case_lab_results (case_id, test_type, purpose, result_date, result_outcome)
       values (%L, 'smear', 'month_2', public.manila_today(), 'negative')$q$,
    pg_temp.id('case_cancelled'))));

-- ---------------------------------------------------------------------------
-- Write surface: no forged author, no pre-voided row, no edit in place.
-- ---------------------------------------------------------------------------
select pg_temp.expect('lab: client cannot set recorded_by', '42501',
  pg_temp.attempt(pg_temp.id('staff_a'), format(
    $q$insert into public.case_lab_results (case_id, test_type, purpose, result_date, result_outcome, recorded_by)
       values (%L, 'smear', 'month_2', public.manila_today(), 'negative', %L)$q$,
    pg_temp.id('case_a'), pg_temp.id('staff_b'))));

select pg_temp.expect('lab: client cannot insert a voided row', '42501',
  pg_temp.attempt(pg_temp.id('staff_a'), format(
    $q$insert into public.case_lab_results (case_id, test_type, purpose, result_date, result_outcome, voided_at)
       values (%L, 'smear', 'month_2', public.manila_today(), 'negative', now())$q$,
    pg_temp.id('case_a'))));

select pg_temp.expect('lab: client cannot edit a result in place', '42501',
  pg_temp.attempt(pg_temp.id('staff_a'), format(
    $q$update public.case_lab_results set result_outcome = 'positive' where lab_result_id = %L$q$,
    pg_temp.id('lab_a'))));

select pg_temp.expect('vitals: client cannot delete', '42501',
  pg_temp.attempt(pg_temp.id('staff_a'), format(
    $q$delete from public.case_vitals where vitals_id = %L$q$, pg_temp.id('vitals_a'))));

-- ---------------------------------------------------------------------------
-- Other roles and facilities.
-- ---------------------------------------------------------------------------
select pg_temp.expect('lab: other facility cannot read', '0',
  pg_temp.count_as(pg_temp.id('staff_b'),
    format('select count(*) from public.case_lab_results where case_id = %L', pg_temp.id('case_a')))::text);

select pg_temp.expect('vitals: other facility cannot read', '0',
  pg_temp.count_as(pg_temp.id('staff_b'),
    format('select count(*) from public.case_vitals where case_id = %L', pg_temp.id('case_a')))::text);

select pg_temp.expect('lab: other facility cannot insert', '42501',
  pg_temp.attempt(pg_temp.id('staff_b'), format(
    $q$insert into public.case_lab_results (case_id, test_type, purpose, result_date, result_outcome)
       values (%L, 'smear', 'month_2', public.manila_today(), 'negative')$q$,
    pg_temp.id('case_a'))));

select pg_temp.expect('lab: BHW cannot read', '0',
  pg_temp.count_as(pg_temp.id('bhw'), 'select count(*) from public.case_lab_results')::text);

select pg_temp.expect('vitals: BHW cannot insert', '42501',
  pg_temp.attempt(pg_temp.id('bhw'), format(
    $q$insert into public.case_vitals (case_id, measured_on, weight_kg) values (%L, public.manila_today(), 50)$q$,
    pg_temp.id('case_a'))));

select pg_temp.expect('vitals: deactivated staff cannot insert', '42501',
  pg_temp.attempt(pg_temp.id('inactive_a'), format(
    $q$insert into public.case_vitals (case_id, measured_on, weight_kg) values (%L, public.manila_today(), 50)$q$,
    pg_temp.id('case_a'))));

-- ---------------------------------------------------------------------------
-- Voiding.
-- ---------------------------------------------------------------------------
select pg_temp.expect('void: a reason is required', '22004',
  pg_temp.attempt(pg_temp.id('staff_a'), format(
    $q$select public.void_case_lab_result(%L, '  ')$q$, pg_temp.id('lab_a'))));

select pg_temp.expect('void: other facility is denied', '42501',
  pg_temp.attempt(pg_temp.id('staff_b'), format(
    $q$select public.void_case_lab_result(%L, 'wrong patient')$q$, pg_temp.id('lab_a'))));

select pg_temp.expect('void: owning staff voids a lab result', 'ok',
  pg_temp.attempt(pg_temp.id('staff_a'), format(
    $q$select public.void_case_lab_result(%L, 'Entered on the wrong case')$q$, pg_temp.id('lab_a'))));

select pg_temp.expect('void: voided lab keeps its values', 'negative / Entered on the wrong case / true',
  (select result_outcome || ' / ' || void_reason || ' / ' || (voided_by = pg_temp.id('staff_a'))::text
     from public.case_lab_results where lab_result_id = pg_temp.id('lab_a')));

select pg_temp.expect('void: second void is rejected', '22023',
  pg_temp.attempt(pg_temp.id('staff_a'), format(
    $q$select public.void_case_lab_result(%L, 'again')$q$, pg_temp.id('lab_a'))));

select pg_temp.expect('void: owning staff voids vitals', 'ok',
  pg_temp.attempt(pg_temp.id('staff_a'), format(
    $q$select public.void_case_vitals(%L, 'Scale not calibrated')$q$, pg_temp.id('vitals_a'))));

-- ---------------------------------------------------------------------------
-- Audit: one row per event, dates and voids only.
-- ---------------------------------------------------------------------------
select pg_temp.expect('audit: lab created + voided rows', 'created:result_date | voided:void_reason,voided_at',
  (select string_agg(action || ':' || keys, ' | ' order by occurred_at, action)
     from (select a.action, a.occurred_at,
                  (select string_agg(k, ',' order by k) from jsonb_object_keys(a.changes) k) keys
             from public.audit_logs a
            where a.entity_table = 'case_lab_results' and a.entity_id = pg_temp.id('lab_a')) s));

select pg_temp.expect('audit: vitals created + voided rows', 'created:measured_on | voided:void_reason,voided_at',
  (select string_agg(action || ':' || keys, ' | ' order by occurred_at, action)
     from (select a.action, a.occurred_at,
                  (select string_agg(k, ',' order by k) from jsonb_object_keys(a.changes) k) keys
             from public.audit_logs a
            where a.entity_table = 'case_vitals' and a.entity_id = pg_temp.id('vitals_a')) s));

select pg_temp.expect('audit: rows filed under the case facility and actor', 'true',
  (select bool_and(facility_id = pg_temp.id('fac_a') and actor_user_id = pg_temp.id('staff_a')
                   and patient_id = pg_temp.id('pat'))::text
     from public.audit_logs where entity_table in ('case_lab_results','case_vitals')
      and entity_id in (pg_temp.id('lab_a'), pg_temp.id('vitals_a'))));

do $whitelist$
declare state text := 'ok';
begin
  begin
    perform app_private.write_audit('case_lab_results', gen_random_uuid(), 'updated',
      null, null, '{"result_outcome":{"from":null,"to":"positive"}}'::jsonb);
  exception when others then state := sqlstate;
  end;
  perform pg_temp.expect('audit: a lab finding cannot enter the log', '42501', state);

  state := 'ok';
  begin
    perform app_private.write_audit('case_vitals', gen_random_uuid(), 'updated',
      null, null, '{"weight_kg":{"from":null,"to":52}}'::jsonb);
  exception when others then state := sqlstate;
  end;
  perform pg_temp.expect('audit: a measurement cannot enter the log', '42501', state);

  state := 'ok';
  begin
    perform app_private.write_audit('referrals', gen_random_uuid(), 'updated',
      null, null, '{"status":{"from":"received","to":"tested"}}'::jsonb);
  exception when others then state := sqlstate;
  end;
  perform pg_temp.expect('audit: existing referral arm unchanged', 'ok', state);
end;
$whitelist$;

-- ---------------------------------------------------------------------------
-- Posture.
-- ---------------------------------------------------------------------------
insert into t_result
select 'posture: ' || p.proname || ' ACL', 'auth=true anon=false svc=false',
       'auth=' || has_function_privilege('authenticated',p.oid,'execute') ||
       ' anon=' || has_function_privilege('anon',p.oid,'execute') ||
       ' svc=' || has_function_privilege('service_role',p.oid,'execute'),
       case when has_function_privilege('authenticated',p.oid,'execute')
                  and not has_function_privilege('anon',p.oid,'execute')
                  and not has_function_privilege('service_role',p.oid,'execute')
                  and p.prosecdef and p.proconfig is not null
            then 'PASS' else 'FAIL' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('void_case_lab_result','void_case_vitals');

insert into t_result
select 'posture: ' || p.proname || ' not client-callable', 'auth=false',
       'auth=' || has_function_privilege('authenticated',p.oid,'execute'),
       case when not has_function_privilege('authenticated',p.oid,'execute')
            then 'PASS' else 'FAIL' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'enforce_case_lab_result_bounds','enforce_case_vitals_bounds',
  'audit_case_lab_result_change','audit_case_vitals_change');

insert into t_result
select 'posture: ' || c.relname || ' client grants', 'select+insert only',
       string_agg(distinct privilege_type, '+' order by privilege_type),
       case when string_agg(distinct privilege_type, '+' order by privilege_type) = 'INSERT+SELECT'
            then 'PASS' else 'FAIL' end
from pg_class c
join lateral (
  select 'SELECT' privilege_type where has_table_privilege('authenticated', c.oid, 'select')
  union all select 'UPDATE' where has_table_privilege('authenticated', c.oid, 'update')
  union all select 'DELETE' where has_table_privilege('authenticated', c.oid, 'delete')
  union all select 'INSERT' where has_any_column_privilege('authenticated', c.oid, 'insert')
) pr on true
where c.oid in ('public.case_lab_results'::regclass, 'public.case_vitals'::regclass)
group by c.relname;

select verdict, check_kind, expected, actual from t_result
order by (verdict='PASS'), check_kind;

do $verdict$
declare failed integer; total integer;
begin
  select count(*) filter (where verdict='FAIL'), count(*) into failed,total from t_result;
  if total=0 or failed>0 then
    raise exception '0040 matrix: % of % checks FAILED', failed,total;
  end if;
  raise notice '0040 matrix: all % checks PASSED', total;
end;
$verdict$;
