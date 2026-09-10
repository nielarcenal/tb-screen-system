-- 0039 shared patient registry and Barangay Report v2 behaviour matrix.
-- Run only through: node scripts/build-preflight.mjs 0039

create temp table t_ids (k text primary key, v uuid) on commit drop;
insert into t_ids (k, v)
select k, gen_random_uuid() from unnest(array[
  'fac_bhs_a','fac_bhs_b','fac_dots','bhw_a','bhw_b','staff','inactive',
  'pat_a','pat_b','screen_a','ref_a','case_a','request_b','screen_b','ref_b'
]) k;

create temp table t_brgy (n integer primary key, code text not null) on commit drop;
insert into t_brgy
select row_number() over (order by b.barangay_code), b.barangay_code
from public.ref_barangays b
order by b.barangay_code
limit 2;

do $guard$
begin
  if (select count(*) from t_brgy) <> 2 then
    raise exception '0039 matrix needs two seeded barangays';
  end if;
end;
$guard$;

insert into public.facilities (facility_id, name, type, address, short_code)
values
  ((select v from t_ids where k='fac_bhs_a'), '0039 BHS A', 'barangay_health_station', 'test', null),
  ((select v from t_ids where k='fac_bhs_b'), '0039 BHS B', 'barangay_health_station', 'test', null),
  ((select v from t_ids where k='fac_dots'),  '0039 DOTS',  'tb_dots', 'test', 'T39D');

insert into auth.users (id)
select v from t_ids where k in ('bhw_a','bhw_b','staff','inactive');

insert into public.users
  (user_id, role, full_name, facility_id, assigned_barangay_code, active)
values
  ((select v from t_ids where k='bhw_a'), 'bhw', '0039 BHW A',
   (select v from t_ids where k='fac_bhs_a'), (select code from t_brgy where n=1), true),
  ((select v from t_ids where k='bhw_b'), 'bhw', '0039 BHW B',
   (select v from t_ids where k='fac_bhs_b'), (select code from t_brgy where n=2), true),
  ((select v from t_ids where k='staff'), 'tb_dots', '0039 DOTS Staff',
   (select v from t_ids where k='fac_dots'), null, true),
  ((select v from t_ids where k='inactive'), 'tb_dots', '0039 Inactive Staff',
   (select v from t_ids where k='fac_dots'), null, false);

insert into public.patients
  (patient_id, display_code, enrolled_by, full_name, first_name, middle_name,
   last_name, birthdate, age, sex, barangay_code, contact_number, sms_consent,
   consent_date, preferred_language)
values
  ((select v from t_ids where k='pat_a'), 'T39A-0001',
   (select v from t_ids where k='bhw_a'), 'Maria Luz Santos', 'Maria', 'Luz',
   'Santos', date '1988-05-04', 38, 'female', (select code from t_brgy where n=1),
   '09171234567', true, now(), 'en'),
  ((select v from t_ids where k='pat_b'), 'T39B-0001',
   (select v from t_ids where k='bhw_b'), 'Juan Dela Cruz', 'Juan', 'Dela',
   'Cruz', date '1990-01-01', 36, 'male', (select code from t_brgy where n=2),
   null, false, null, null);

insert into public.screenings
  (screening_id, patient_id, symptom_flags, pgis_severity, referred)
values (
  (select v from t_ids where k='screen_a'), (select v from t_ids where k='pat_a'),
  '{"cough_2wks":"yes","weight_loss":"no","night_sweats":"no","fever":"no","hemoptysis":"no","chest_pain":"no","fatigue":"no","loss_of_appetite":"no","tb_contact":"no"}',
  'mild', true
);

insert into public.referrals
  (referral_id, patient_id, screening_id, facility_id, status, presented,
   result_outcome, result_date)
values (
  (select v from t_ids where k='ref_a'), (select v from t_ids where k='pat_a'),
  (select v from t_ids where k='screen_a'), (select v from t_ids where k='fac_dots'),
  'tested', true, 'positive', public.manila_today()
);

insert into public.tb_cases
  (case_id, patient_id, referral_id, facility_id, case_number, registration_date,
   case_status, treatment_start_date, outcome, outcome_date, created_by)
values (
  (select v from t_ids where k='case_a'), (select v from t_ids where k='pat_a'),
  (select v from t_ids where k='ref_a'), (select v from t_ids where k='fac_dots'),
  'TBC-T39D-2026-99001', public.manila_today(), 'closed', public.manila_today(),
  'cured', public.manila_today(), (select v from t_ids where k='staff')
);

create temp table t_result (
  check_kind text, expected text, actual text, verdict text
) on commit drop;

do $temp_grants$
declare s text := pg_my_temp_schema()::regnamespace::text;
begin
  execute format('grant usage on schema %s to authenticated', s);
  execute format('grant select on %s.t_ids to authenticated', s);
  execute format('grant select on %s.t_brgy to authenticated', s);
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

create or replace function pg_temp.as_direct() returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Exact matching is shared, but only minimal identity data is returned.
do $lookup$
declare n integer; reusable boolean; last4 text;
begin
  perform pg_temp.as_user((select v from t_ids where k='staff'));
  select count(*), bool_and(can_reuse), max(phone_last4)
    into n, reusable, last4
    from public.search_patient_registry(' Maria ', 'Luz', 'SANTOS', date '1988-05-04', '0917 123 4567');
  reset role;
  insert into t_result values ('lookup: DOTS exact normalized match', '1 / true / 4567',
    n::text || ' / ' || reusable::text || ' / ' || coalesce(last4,'null'),
    case when n=1 and reusable and last4='4567' then 'PASS' else 'FAIL' end);

  perform pg_temp.as_user((select v from t_ids where k='bhw_a'));
  select count(*), bool_and(can_reuse) into n, reusable
    from public.search_patient_registry('Juan','Dela','Cruz',date '1990-01-01',null);
  reset role;
  insert into t_result values ('lookup: cross-barangay BHW is notified but restricted', '1 / false',
    n::text || ' / ' || reusable::text,
    case when n=1 and not reusable then 'PASS' else 'FAIL' end);

  perform pg_temp.as_user((select v from t_ids where k='bhw_a'));
  select count(*), bool_and(can_reuse) into n, reusable
    from public.search_patient_registry('Maria','Luz','Santos',date '1988-05-04',null);
  reset role;
  insert into t_result values ('lookup: own-barangay BHW can reuse identity', '1 / true',
    n::text || ' / ' || reusable::text,
    case when n=1 and reusable then 'PASS' else 'FAIL' end);

  perform pg_temp.as_user((select v from t_ids where k='staff'));
  select count(*) into n
    from public.search_patient_registry('Maria','Wrong','Santos',date '1988-05-04',null);
  reset role;
  insert into t_result values ('lookup: wrong middle name does not match', '0', n::text,
    case when n=0 then 'PASS' else 'FAIL' end);
end;
$lookup$;

-- A facility creates a new clinical episode against the canonical patient id.
do $reuse$
declare result1 jsonb; result2 jsonb; n_screen integer; n_ref integer; rejected boolean := false;
begin
  perform pg_temp.as_user((select v from t_ids where k='staff'));
  result1 := public.register_existing_patient_walkin(
    (select v from t_ids where k='request_b'), (select v from t_ids where k='pat_b'),
    (select v from t_ids where k='screen_b'), (select v from t_ids where k='ref_b'),
    'Juan','Dela','Cruz',date '1990-01-01',
    '{"cough_2wks":"no","weight_loss":"no","night_sweats":"no","fever":"no","hemoptysis":"no","chest_pain":"no","fatigue":"no","loss_of_appetite":"no","tb_contact":"no"}',
    'none',null,null,null,null,null,null,null);
  result2 := public.register_existing_patient_walkin(
    (select v from t_ids where k='request_b'), (select v from t_ids where k='pat_b'),
    (select v from t_ids where k='screen_b'), (select v from t_ids where k='ref_b'),
    'Juan','Dela','Cruz',date '1990-01-01',
    '{"cough_2wks":"no","weight_loss":"no","night_sweats":"no","fever":"no","hemoptysis":"no","chest_pain":"no","fatigue":"no","loss_of_appetite":"no","tb_contact":"no"}',
    'none',null,null,null,null,null,null,null);
  reset role;

  select count(*) into n_screen from public.screenings where screening_id=(select v from t_ids where k='screen_b');
  select count(*) into n_ref from public.referrals
   where referral_id=(select v from t_ids where k='ref_b')
     and facility_id=(select v from t_ids where k='fac_dots') and status='received';
  insert into t_result values ('reuse: one patient, one screening and one referral after replay',
    'true / 1 / 1', coalesce((result2->>'existing_patient'),'null') || ' / ' || n_screen || ' / ' || n_ref,
    case when result1=result2 and result2->>'existing_patient'='true' and n_screen=1 and n_ref=1
         then 'PASS' else 'FAIL' end);

  begin
    perform pg_temp.as_user((select v from t_ids where k='staff'));
    perform public.register_existing_patient_walkin(
      gen_random_uuid(), (select v from t_ids where k='pat_b'), gen_random_uuid(), gen_random_uuid(),
      'Not Juan','Dela','Cruz',date '1990-01-01',
      '{"cough_2wks":"no","weight_loss":"no","night_sweats":"no","fever":"no","hemoptysis":"no","chest_pain":"no","fatigue":"no","loss_of_appetite":"no","tb_contact":"no"}',
      'none',null,null,null,null,null,null,null);
  exception when sqlstate '22023' then rejected := true;
  end;
  reset role;
  insert into t_result values ('reuse: stale or altered identity is rejected', 'true', rejected::text,
    case when rejected then 'PASS' else 'FAIL' end);
end;
$reuse$;

do $report$
declare a record; b record; denied boolean := false;
begin
  perform pg_temp.as_user((select v from t_ids where k='staff'));
  select * into a from public.barangay_report_v2(public.manila_today(), public.manila_today())
   where barangay_code=(select code from t_brgy where n=1);
  select * into b from public.barangay_report_v2(public.manila_today(), public.manila_today())
   where barangay_code=(select code from t_brgy where n=2);
  reset role;

  insert into t_result values ('report: recorded case and outcome counts', '1/1/1/1',
    a.screened_count || '/' || a.referred_count || '/' || a.case_count || '/' || a.successful_outcome_count,
    case when a.screened_count=1 and a.referred_count=1 and a.case_count=1
                   and a.successful_outcome_count=1 and a.lost_to_follow_up_count=0
         then 'PASS' else 'FAIL' end);
  insert into t_result values ('report: reused identity episode counted in home barangay', '1/0',
    b.screened_count || '/' || b.referred_count,
    case when b.screened_count=1 and b.referred_count=0 then 'PASS' else 'FAIL' end);

  begin
    perform pg_temp.as_user((select v from t_ids where k='bhw_a'));
    perform count(*) from public.barangay_report_v2(public.manila_today(), public.manila_today());
  exception when sqlstate '42501' then denied := true;
  end;
  reset role;
  insert into t_result values ('report: BHW denied province aggregates', 'true', denied::text,
    case when denied then 'PASS' else 'FAIL' end);
end;
$report$;

-- Catalogue checks prevent a future default EXECUTE grant from bypassing the role gates.
insert into t_result
select 'posture: ' || p.proname || ' ACL', 'auth=true anon=false svc=false',
       'auth=' || has_function_privilege('authenticated',p.oid,'execute') ||
       ' anon=' || has_function_privilege('anon',p.oid,'execute') ||
       ' svc=' || has_function_privilege('service_role',p.oid,'execute'),
       case when has_function_privilege('authenticated',p.oid,'execute')
                  and not has_function_privilege('anon',p.oid,'execute')
                  and not has_function_privilege('service_role',p.oid,'execute')
            then 'PASS' else 'FAIL' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'search_patient_registry','register_existing_patient_walkin','barangay_report_v2');

insert into t_result
select 'posture: ' || p.proname, 'secdef=true search_path=set',
       'secdef=' || p.prosecdef || ' search_path=' || (p.proconfig is not null),
       case when p.prosecdef and p.proconfig is not null then 'PASS' else 'FAIL' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'search_patient_registry','register_existing_patient_walkin','barangay_report_v2');

select verdict, check_kind, expected, actual from t_result
order by (verdict='PASS'), check_kind;

do $verdict$
declare failed integer; total integer;
begin
  select count(*) filter (where verdict='FAIL'), count(*) into failed,total from t_result;
  if total=0 or failed>0 then
    raise exception '0039 matrix: % of % checks FAILED', failed,total;
  end if;
  raise notice '0039 matrix: all % checks PASSED', total;
end;
$verdict$;
