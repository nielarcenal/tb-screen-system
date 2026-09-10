-- Behaviour/security matrix for 0037_facility_attention_dashboard.sql.
-- Run only through: node scripts/build-preflight.mjs 0037

create temp table t_ids (k text primary key, v uuid) on commit drop;
insert into t_ids (k, v)
select k, gen_random_uuid() from unnest(array[
  'fac_a','fac_b','fac_empty','bhs','staff_a','staff_b','staff_empty','bhw','admin','inactive',
  'pat_ref_1','pat_ref_2','pat_ref_3','pat_ref_4','pat_ref_5','pat_ref_b',
  'pat_overdue','pat_today','pat_soon','pat_stale','pat_boundary','pat_missed',
  'pat_resolved','pat_closed','pat_cancelled',
  'scr_1','scr_2','scr_3','scr_4','scr_5','scr_b',
  'ref_1','ref_2','ref_3','ref_4','ref_5','ref_b',
  'case_overdue','case_today','case_soon','case_stale','case_boundary','case_missed',
  'case_resolved','case_closed','case_cancelled',
  'appt_overdue','appt_overdue_2','appt_today','appt_soon_7','appt_stale_old','appt_boundary_8',
  'appt_missed','appt_missed_resolved','appt_rescheduled','appt_pre_attended','appt_pre_missed',
  'follow_overdue_recent','follow_soon_recent','follow_stale_old','follow_boundary_recent'
]) k;

create temp table t_brgy (code text) on commit drop;
insert into t_brgy select barangay_code from public.ref_barangays order by barangay_code limit 1;

insert into public.facilities (facility_id, name, type, address, short_code)
values
  ((select v from t_ids where k='fac_a'), 'Dashboard DOTS A', 'tb_dots', 'test', 'D7A'),
  ((select v from t_ids where k='fac_b'), 'Dashboard DOTS B', 'tb_dots', 'test', 'D7B'),
  ((select v from t_ids where k='fac_empty'), 'Dashboard Empty', 'tb_dots', 'test', 'D7E'),
  ((select v from t_ids where k='bhs'), 'Dashboard BHS', 'barangay_health_station', 'test', null);

insert into auth.users (id)
select v from t_ids where k in ('staff_a','staff_b','staff_empty','bhw','admin','inactive');

insert into public.users
  (user_id, role, full_name, facility_id, assigned_barangay_code, active)
values
  ((select v from t_ids where k='staff_a'), 'tb_dots', 'Dashboard Staff A',
   (select v from t_ids where k='fac_a'), null, true),
  ((select v from t_ids where k='staff_b'), 'tb_dots', 'Dashboard Staff B',
   (select v from t_ids where k='fac_b'), null, true),
  ((select v from t_ids where k='staff_empty'), 'tb_dots', 'Dashboard Empty Staff',
   (select v from t_ids where k='fac_empty'), null, true),
  ((select v from t_ids where k='bhw'), 'bhw', 'Dashboard BHW',
   (select v from t_ids where k='bhs'), (select code from t_brgy), true),
  ((select v from t_ids where k='admin'), 'admin', 'Dashboard Admin',
   (select v from t_ids where k='fac_a'), null, true),
  ((select v from t_ids where k='inactive'), 'tb_dots', 'Dashboard Inactive',
   (select v from t_ids where k='fac_a'), null, false);

insert into public.patients
  (patient_id, display_code, enrolled_by, age, sex, barangay_code, sms_consent, created_at)
select v,
       'D7-' || lpad(row_number() over (order by k)::text, 4, '0'),
       (select v from t_ids where k='bhw'), 40, 'female', (select code from t_brgy), false,
       public.manila_day_start(public.manila_today() - 60)
  from t_ids
 where k like 'pat_%';

insert into public.screenings (screening_id, patient_id, referred, created_at)
values
  ((select v from t_ids where k='scr_1'), (select v from t_ids where k='pat_ref_1'), true,
   public.manila_day_start(public.manila_today())),
  ((select v from t_ids where k='scr_2'), (select v from t_ids where k='pat_ref_2'), true,
   public.manila_day_start(public.manila_today() - 10)),
  ((select v from t_ids where k='scr_3'), (select v from t_ids where k='pat_ref_3'), true,
   public.manila_day_start(public.manila_today() - 9)),
  ((select v from t_ids where k='scr_4'), (select v from t_ids where k='pat_ref_4'), true,
   public.manila_day_start(public.manila_today() - 8)),
  -- Exact upper boundary: belongs to tomorrow, not today's count.
  ((select v from t_ids where k='scr_5'), (select v from t_ids where k='pat_ref_5'), true,
   public.manila_day_start(public.manila_today() + 1)),
  ((select v from t_ids where k='scr_b'), (select v from t_ids where k='pat_ref_b'), true,
   public.manila_day_start(public.manila_today()));

insert into public.referrals
  (referral_id, patient_id, screening_id, facility_id, status, result_outcome, result_date,
   presented, created_at)
values
  ((select v from t_ids where k='ref_1'), (select v from t_ids where k='pat_ref_1'),
   (select v from t_ids where k='scr_1'), (select v from t_ids where k='fac_a'),
   'submitted', null, null, null, public.manila_day_start(public.manila_today())),
  ((select v from t_ids where k='ref_2'), (select v from t_ids where k='pat_ref_2'),
   (select v from t_ids where k='scr_2'), (select v from t_ids where k='fac_a'),
   'received', null, null, true, public.manila_day_start(public.manila_today() - 10)),
  ((select v from t_ids where k='ref_3'), (select v from t_ids where k='pat_ref_3'),
   (select v from t_ids where k='scr_3'), (select v from t_ids where k='fac_a'),
   'tested', 'positive', public.manila_day_start(public.manila_today()), true,
   public.manila_day_start(public.manila_today() - 9)),
  ((select v from t_ids where k='ref_4'), (select v from t_ids where k='pat_ref_4'),
   (select v from t_ids where k='scr_4'), (select v from t_ids where k='fac_a'),
   'closed', 'negative', public.manila_day_start(public.manila_today()), true,
   public.manila_day_start(public.manila_today() - 8)),
  ((select v from t_ids where k='ref_5'), (select v from t_ids where k='pat_ref_5'),
   (select v from t_ids where k='scr_5'), (select v from t_ids where k='fac_a'),
   'tested', 'positive', public.manila_day_start(public.manila_today() + 1), true,
   public.manila_day_start(public.manila_today() + 1)),
  ((select v from t_ids where k='ref_b'), (select v from t_ids where k='pat_ref_b'),
   (select v from t_ids where k='scr_b'), (select v from t_ids where k='fac_b'),
   'submitted', null, null, null, public.manila_day_start(public.manila_today()));

insert into public.tb_cases
  (case_id, patient_id, facility_id, case_number, registration_date, case_status,
   treatment_start_date, outcome, outcome_date, created_by, created_at)
values
  ((select v from t_ids where k='case_overdue'), (select v from t_ids where k='pat_overdue'),
   (select v from t_ids where k='fac_a'), 'TBC-D7A-2099-00001', public.manila_today()-40,
   'on_treatment', public.manila_today()-39, null, null, (select v from t_ids where k='staff_a'), now()),
  ((select v from t_ids where k='case_today'), (select v from t_ids where k='pat_today'),
   (select v from t_ids where k='fac_a'), 'TBC-D7A-2099-00002', public.manila_today()-5,
   'registered', null, null, null, (select v from t_ids where k='staff_a'), now()),
  ((select v from t_ids where k='case_soon'), (select v from t_ids where k='pat_soon'),
   (select v from t_ids where k='fac_a'), 'TBC-D7A-2099-00003', public.manila_today()-40,
   'interrupted', public.manila_today()-39, null, null, (select v from t_ids where k='staff_a'), now()),
  ((select v from t_ids where k='case_stale'), (select v from t_ids where k='pat_stale'),
   (select v from t_ids where k='fac_a'), 'TBC-D7A-2099-00004', public.manila_today()-31,
   'on_treatment', public.manila_today()-30, null, null, (select v from t_ids where k='staff_a'), now()),
  ((select v from t_ids where k='case_boundary'), (select v from t_ids where k='pat_boundary'),
   (select v from t_ids where k='fac_a'), 'TBC-D7A-2099-00005', public.manila_today()-30,
   'registered', null, null, null, (select v from t_ids where k='staff_a'), now()),
  ((select v from t_ids where k='case_missed'), (select v from t_ids where k='pat_missed'),
   (select v from t_ids where k='fac_a'), 'TBC-D7A-2099-00006', public.manila_today()-20,
   'registered', null, null, null, (select v from t_ids where k='staff_a'), now()),
  ((select v from t_ids where k='case_resolved'), (select v from t_ids where k='pat_resolved'),
   (select v from t_ids where k='fac_a'), 'TBC-D7A-2099-00007', public.manila_today()-20,
   'on_treatment', public.manila_today()-19, null, null, (select v from t_ids where k='staff_a'), now()),
  ((select v from t_ids where k='case_closed'), (select v from t_ids where k='pat_closed'),
   (select v from t_ids where k='fac_a'), 'TBC-D7A-2099-00008', public.manila_today()-50,
   'closed', public.manila_today()-49, 'cured', public.manila_today()-1,
   (select v from t_ids where k='staff_a'), now()),
  ((select v from t_ids where k='case_cancelled'), (select v from t_ids where k='pat_cancelled'),
   (select v from t_ids where k='fac_a'), 'TBC-D7A-2099-00009', public.manila_today()-2,
   'cancelled', null, null, null, (select v from t_ids where k='staff_a'), now());

insert into public.appointments
  (appointment_id, patient_id, scheduled_date, attended_date, status, facility_id, referral_id, tb_case_id)
values
  ((select v from t_ids where k='appt_overdue'), (select v from t_ids where k='pat_overdue'),
   public.manila_today()-1, null, 'scheduled', (select v from t_ids where k='fac_a'), null,
   (select v from t_ids where k='case_overdue')),
  ((select v from t_ids where k='appt_overdue_2'), (select v from t_ids where k='pat_overdue'),
   public.manila_today()-2, null, 'scheduled', (select v from t_ids where k='fac_a'), null,
   (select v from t_ids where k='case_overdue')),
  ((select v from t_ids where k='appt_today'), (select v from t_ids where k='pat_today'),
   public.manila_today(), null, 'scheduled', (select v from t_ids where k='fac_a'), null,
   (select v from t_ids where k='case_today')),
  ((select v from t_ids where k='appt_soon_7'), (select v from t_ids where k='pat_soon'),
   public.manila_today()+7, null, 'scheduled', (select v from t_ids where k='fac_a'), null,
   (select v from t_ids where k='case_soon')),
  ((select v from t_ids where k='appt_stale_old'), (select v from t_ids where k='pat_stale'),
   public.manila_today()-31, public.manila_today()-31, 'attended',
   (select v from t_ids where k='fac_a'), null, (select v from t_ids where k='case_stale')),
  ((select v from t_ids where k='appt_boundary_8'), (select v from t_ids where k='pat_boundary'),
   public.manila_today()+8, null, 'scheduled', (select v from t_ids where k='fac_a'), null,
   (select v from t_ids where k='case_boundary')),
  ((select v from t_ids where k='appt_missed'), (select v from t_ids where k='pat_missed'),
   public.manila_today()-5, null, 'missed', (select v from t_ids where k='fac_a'), null,
   (select v from t_ids where k='case_missed')),
  ((select v from t_ids where k='appt_missed_resolved'), (select v from t_ids where k='pat_resolved'),
   public.manila_today()-5, null, 'missed', (select v from t_ids where k='fac_a'), null,
   (select v from t_ids where k='case_resolved')),
  ((select v from t_ids where k='appt_rescheduled'), (select v from t_ids where k='pat_resolved'),
   public.manila_today()+1, null, 'scheduled', (select v from t_ids where k='fac_a'), null,
   (select v from t_ids where k='case_resolved')),
  ((select v from t_ids where k='appt_pre_attended'), (select v from t_ids where k='pat_ref_2'),
   public.manila_today(), public.manila_today(), 'attended',
   (select v from t_ids where k='fac_a'), (select v from t_ids where k='ref_2'), null),
  ((select v from t_ids where k='appt_pre_missed'), (select v from t_ids where k='pat_ref_1'),
   public.manila_today(), null, 'missed',
   (select v from t_ids where k='fac_a'), (select v from t_ids where k='ref_1'), null);

insert into public.treatment_followups
  (followup_id, case_id, appointment_id, visit_date, notes, recorded_by)
values
  ((select v from t_ids where k='follow_overdue_recent'), (select v from t_ids where k='case_overdue'),
   null, public.manila_today()-2, null, (select v from t_ids where k='staff_a')),
  ((select v from t_ids where k='follow_soon_recent'), (select v from t_ids where k='case_soon'),
   null, public.manila_today()-2, null, (select v from t_ids where k='staff_a')),
  ((select v from t_ids where k='follow_stale_old'), (select v from t_ids where k='case_stale'),
   (select v from t_ids where k='appt_stale_old'), public.manila_today()-31, null,
   (select v from t_ids where k='staff_a')),
  ((select v from t_ids where k='follow_boundary_recent'), (select v from t_ids where k='case_boundary'),
   null, public.manila_today()-30, null, (select v from t_ids where k='staff_a'));

create temp table t_result (
  check_kind text, persona text, expected text, actual text, verdict text
) on commit drop;
grant insert, select on t_result to authenticated;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub',(select v from t_ids where k='staff_a'),'role','authenticated')::text, true);
set local role authenticated;

insert into t_result
select 'today and Manila boundaries','tb_dots A','1/1/1/1/1/1/3',
       concat_ws('/',screened_today,referred_today,positive_today,negative_today,
                 attended_today,missed_today,scheduled_today),
       case when (screened_today,referred_today,positive_today,negative_today,
                  attended_today,missed_today,scheduled_today) = (1,1,1,1,1,1,3)
            then 'PASS' else 'FAIL' end
  from public.facility_dashboard_overview();

insert into t_result
select 'attention categories','tb_dots A','1/1/2/2/1/1',
       concat_ws('/',attention_overdue_followups,attention_missed_followups,
                 attention_due_soon,attention_referrals_awaiting,
                 attention_stale_cases,attention_appointments_today),
       case when (attention_overdue_followups,attention_missed_followups,
                  attention_due_soon,attention_referrals_awaiting,
                  attention_stale_cases,attention_appointments_today) = (1,1,2,2,1,1)
            then 'PASS' else 'FAIL' end
  from public.facility_dashboard_overview();

insert into t_result
select 'program metrics','tb_dots A','5/5/4/9/4/3/1/1',
       concat_ws('/',metric_screened,metric_referred,metric_referral_received,
                 metric_cases_created,metric_active_treatment_cases,metric_followups_due,
                 metric_missed_followups,metric_closed_cases),
       case when (metric_screened,metric_referred,metric_referral_received,
                  metric_cases_created,metric_active_treatment_cases,metric_followups_due,
                  metric_missed_followups,metric_closed_cases) = (5,5,4,9,4,3,1,1)
            then 'PASS' else 'FAIL' end
  from public.facility_dashboard_overview();
reset role;

-- Facility B sees only its one current referral/screening, not A's queues.
select set_config('request.jwt.claims', jsonb_build_object(
  'sub',(select v from t_ids where k='staff_b'),'role','authenticated')::text, true);
set local role authenticated;
insert into t_result
select 'facility isolation','tb_dots B','today 1/1; totals 1/1; awaiting 1',
       concat_ws('/',screened_today,referred_today,metric_screened,metric_referred,
                 attention_referrals_awaiting),
       case when (screened_today,referred_today,metric_screened,metric_referred,
                  attention_referrals_awaiting) = (1,1,1,1,1)
                 and attention_overdue_followups=0 and metric_cases_created=0
            then 'PASS' else 'FAIL' end
  from public.facility_dashboard_overview();
reset role;

-- An authorized facility with no data gets one useful zero row.
select set_config('request.jwt.claims', jsonb_build_object(
  'sub',(select v from t_ids where k='staff_empty'),'role','authenticated')::text, true);
set local role authenticated;
insert into t_result
select 'empty facility','tb_dots empty','one all-zero row',
       count(*)::text || ' row / sum ' || coalesce(sum(metric_referred),-1)::text,
       case when count(*)=1 and sum(metric_referred)=0 and sum(attention_due_soon)=0
            then 'PASS' else 'FAIL' end
  from public.facility_dashboard_overview();
reset role;

-- Authenticated is only the transport role; other personas receive no row.
select set_config('request.jwt.claims', jsonb_build_object(
  'sub',(select v from t_ids where k='bhw'),'role','authenticated')::text, true);
set local role authenticated;
insert into t_result select 'BHW boundary','bhw','0 rows',count(*)::text,
  case when count(*)=0 then 'PASS' else 'FAIL' end from public.facility_dashboard_overview();
reset role;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub',(select v from t_ids where k='admin'),'role','authenticated')::text, true);
set local role authenticated;
insert into t_result select 'admin boundary','admin','0 rows',count(*)::text,
  case when count(*)=0 then 'PASS' else 'FAIL' end from public.facility_dashboard_overview();
reset role;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub',(select v from t_ids where k='inactive'),'role','authenticated')::text, true);
set local role authenticated;
insert into t_result select 'inactive boundary','inactive tb_dots','0 rows',count(*)::text,
  case when count(*)=0 then 'PASS' else 'FAIL' end from public.facility_dashboard_overview();
reset role;

insert into t_result
select 'function posture','catalogue','stable definer, fixed path','checked',
       case when p.prosecdef and p.provolatile='s'
                  and p.proconfig @> array['search_path=public']::text[]
                  and has_function_privilege('authenticated',p.oid,'EXECUTE')
                  and not has_function_privilege('anon',p.oid,'EXECUTE')
                  and not has_function_privilege('service_role',p.oid,'EXECUTE')
            then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='facility_dashboard_overview'
   and pg_get_function_identity_arguments(p.oid)='';

select * from t_result order by check_kind, persona;

do $assert$
declare failures text;
begin
  select string_agg(check_kind || ' [' || persona || ']: expected ' || expected || ', got ' || actual, E'\n')
    into failures from t_result where verdict <> 'PASS';
  if failures is not null then
    raise exception E'0037 matrix failed:\n%', failures;
  end if;
end;
$assert$;
