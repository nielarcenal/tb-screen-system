-- Behaviour/security matrix for 0036_patient_timeline.sql.
-- Run only through: node scripts/build-preflight.mjs 0036

create temp table t_ids (k text primary key, v uuid) on commit drop;
insert into t_ids (k, v)
select k, gen_random_uuid() from unnest(array[
  'fac_a','fac_b','bhs','staff_a','staff_b','bhw','admin','inactive',
  'pat_a','pat_b','pat_transfer','scr_a','scr_hist','scr_b','ref_a','ref_hist','ref_b',
  'case_a','case_transfer','appt_case','appt_void','appt_overdue','appt_missed','appt_cancelled',
  'follow_live','follow_void','sms_a'
]) k;

create temp table t_brgy (code text) on commit drop;
insert into t_brgy
select barangay_code from public.ref_barangays order by barangay_code limit 1;

insert into public.facilities (facility_id, name, type, address, short_code)
values
  ((select v from t_ids where k='fac_a'), 'Timeline DOTS A', 'tb_dots', 'test', 'TLA'),
  ((select v from t_ids where k='fac_b'), 'Timeline DOTS B', 'tb_dots', 'test', 'TLB'),
  ((select v from t_ids where k='bhs'), 'Timeline BHS', 'barangay_health_station', 'test', null);

insert into auth.users (id)
select v from t_ids where k in ('staff_a','staff_b','bhw','admin','inactive');

insert into public.users
  (user_id, role, full_name, facility_id, assigned_barangay_code, active)
values
  ((select v from t_ids where k='staff_a'), 'tb_dots', 'Timeline Staff A',
   (select v from t_ids where k='fac_a'), null, true),
  ((select v from t_ids where k='staff_b'), 'tb_dots', 'Timeline Staff B',
   (select v from t_ids where k='fac_b'), null, true),
  ((select v from t_ids where k='bhw'), 'bhw', 'Timeline BHW',
   (select v from t_ids where k='bhs'), (select code from t_brgy), true),
  ((select v from t_ids where k='admin'), 'admin', 'Timeline Admin',
   (select v from t_ids where k='fac_a'), null, true),
  ((select v from t_ids where k='inactive'), 'tb_dots', 'Timeline Inactive',
   (select v from t_ids where k='fac_a'), null, false);

insert into public.patients
  (patient_id, display_code, enrolled_by, age, sex, barangay_code, sms_consent, created_at)
values
  ((select v from t_ids where k='pat_a'), 'TML-0001', (select v from t_ids where k='bhw'),
   41, 'female', (select code from t_brgy), false, now() - interval '12 days'),
  ((select v from t_ids where k='pat_b'), 'TML-0002', (select v from t_ids where k='bhw'),
   39, 'male', (select code from t_brgy), false, now() - interval '12 days'),
  ((select v from t_ids where k='pat_transfer'), 'TML-0003', (select v from t_ids where k='bhw'),
   55, 'female', (select code from t_brgy), false, now() - interval '20 days');

insert into public.screenings (screening_id, patient_id, referred, created_at)
values
  ((select v from t_ids where k='scr_a'), (select v from t_ids where k='pat_a'), true, now() - interval '11 days'),
  ((select v from t_ids where k='scr_hist'), (select v from t_ids where k='pat_a'), true, now() - interval '10 days'),
  ((select v from t_ids where k='scr_b'), (select v from t_ids where k='pat_b'), true, now() - interval '11 days');

insert into public.referrals
  (referral_id, patient_id, screening_id, facility_id, status, presented, created_at)
values
  ((select v from t_ids where k='ref_a'), (select v from t_ids where k='pat_a'),
   (select v from t_ids where k='scr_a'), (select v from t_ids where k='fac_a'),
   'submitted', null, now() - interval '10 days'),
  -- A pre-0035 shape: current state exists, but INSERT creates no audit event.
  ((select v from t_ids where k='ref_hist'), (select v from t_ids where k='pat_a'),
   (select v from t_ids where k='scr_hist'), (select v from t_ids where k='fac_a'),
   'closed', null, now() - interval '9 days'),
  ((select v from t_ids where k='ref_b'), (select v from t_ids where k='pat_b'),
   (select v from t_ids where k='scr_b'), (select v from t_ids where k='fac_b'),
   'received', null, now() - interval '10 days');

-- Generate forward-only referral timestamps as the real caller.
grant select on t_ids to authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',(select v from t_ids where k='staff_a'),'role','authenticated')::text,
  true
);
set local role authenticated;
update public.referrals set status='received'
 where referral_id=(select v from t_ids where k='ref_a');
update public.referrals set status='tested', result_date=now()
 where referral_id=(select v from t_ids where k='ref_a');
update public.referrals set presented=false
 where referral_id=(select v from t_ids where k='ref_a');
update public.referrals set status='closed'
 where referral_id=(select v from t_ids where k='ref_a');
reset role;

insert into public.tb_cases
  (case_id, patient_id, referral_id, facility_id, case_number, registration_date,
   case_status, treatment_start_date, created_by, created_at)
values
  ((select v from t_ids where k='case_a'), (select v from t_ids where k='pat_a'),
   (select v from t_ids where k='ref_a'), (select v from t_ids where k='fac_a'),
   'TBC-TLA-2099-00001', public.manila_today()-8, 'on_treatment',
   public.manila_today()-7, (select v from t_ids where k='staff_a'), now()-interval '8 days'),
  -- Simulates a case already transferred to B. There is no B referral, so
  -- source-independent authorization must show case events but not pre-case history.
  ((select v from t_ids where k='case_transfer'), (select v from t_ids where k='pat_transfer'),
   null, (select v from t_ids where k='fac_b'), 'TBC-TLB-2099-00001',
   public.manila_today()-15, 'on_treatment', public.manila_today()-14,
   (select v from t_ids where k='staff_a'), now()-interval '15 days');

insert into public.appointments
  (appointment_id, patient_id, scheduled_date, attended_date, status, facility_id, tb_case_id)
values
  ((select v from t_ids where k='appt_case'), (select v from t_ids where k='pat_a'),
   public.manila_today()-1, public.manila_today()-1, 'attended',
   (select v from t_ids where k='fac_a'), (select v from t_ids where k='case_a')),
  ((select v from t_ids where k='appt_void'), (select v from t_ids where k='pat_a'),
   public.manila_today()-2, public.manila_today()-2, 'attended',
   (select v from t_ids where k='fac_a'), (select v from t_ids where k='case_a')),
  ((select v from t_ids where k='appt_overdue'), (select v from t_ids where k='pat_a'),
   public.manila_today()-3, null, 'scheduled',
   (select v from t_ids where k='fac_a'), (select v from t_ids where k='case_a')),
  ((select v from t_ids where k='appt_missed'), (select v from t_ids where k='pat_a'),
   public.manila_today()-4, null, 'missed',
   (select v from t_ids where k='fac_a'), (select v from t_ids where k='case_a')),
  ((select v from t_ids where k='appt_cancelled'), (select v from t_ids where k='pat_a'),
   public.manila_today()+2, null, 'cancelled',
   (select v from t_ids where k='fac_a'), (select v from t_ids where k='case_a'));

insert into public.treatment_followups
  (followup_id, case_id, appointment_id, visit_date, notes, recorded_by,
   voided_at, voided_by, void_reason)
values
  ((select v from t_ids where k='follow_live'), (select v from t_ids where k='case_a'),
   (select v from t_ids where k='appt_case'), public.manila_today()-1,
   'PRIVATE LIVE NOTE MUST NOT LEAK', (select v from t_ids where k='staff_a'), null, null, null),
  ((select v from t_ids where k='follow_void'), (select v from t_ids where k='case_a'),
   (select v from t_ids where k='appt_void'), public.manila_today()-2,
   'PRIVATE VOID NOTE MUST NOT LEAK', (select v from t_ids where k='staff_a'),
   now(), (select v from t_ids where k='staff_a'), 'wrong record');

insert into public.sms_log (sms_id, appointment_id, delivery_status, message_kind, sent_at)
values ((select v from t_ids where k='sms_a'), (select v from t_ids where k='appt_overdue'),
        'sent', 'reminder', now()-interval '3 days');

create temp table t_result (
  check_kind text,
  persona text,
  expected text,
  actual text,
  verdict text
) on commit drop;
grant insert, select on t_result to authenticated;

-- Active owning facility: exact event distinctions and privacy.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub',(select v from t_ids where k='staff_a'),'role','authenticated')::text,
  true
);
set local role authenticated;

insert into t_result
select 'required event catalogue','tb_dots A','all core types present',
       count(*)::text || ' of 12', case when count(*)=12 then 'PASS' else 'FAIL' end
  from (
    select distinct event_type from public.patient_timeline((select v from t_ids where k='pat_a'))
     where event_type in (
       'patient_enrolled','screening_recorded','referral_submitted','referral_received',
       'lab_result_recorded','patient_did_not_present','referral_closed','case_registered',
       'treatment_started','appointment_scheduled','appointment_attended','followup_recorded'
     )
  ) q;

insert into t_result
select 'overdue is not missed','tb_dots A','one of each',
       count(*) filter (where event_type='appointment_overdue') || ' overdue / '
       || count(*) filter (where event_type='appointment_missed') || ' missed',
       case when count(*) filter (where event_type='appointment_overdue')=1
                  and count(*) filter (where event_type='appointment_missed')=1
            then 'PASS' else 'FAIL' end
  from public.patient_timeline((select v from t_ids where k='pat_a'));

insert into t_result
select 'forward audit dates','tb_dots A','dated received/no-show/closed',
       count(*) filter (where event_type in ('referral_received','patient_did_not_present','referral_closed')
                         and occurred_at is not null)::text || ' dated',
       case when count(*) filter (
              where event_type in ('referral_received','patient_did_not_present','referral_closed')
                and occurred_at is not null)=3 then 'PASS' else 'FAIL' end
  from public.patient_timeline((select v from t_ids where k='pat_a'));

insert into t_result
select 'historical honesty','tb_dots A','received and closed undated',
       count(*)::text || ' undated', case when count(*)=2 then 'PASS' else 'FAIL' end
  from public.patient_timeline((select v from t_ids where k='pat_a'))
 where event_id in (
   'referral_received:' || (select v::text from t_ids where k='ref_hist'),
   'referral_closed:' || (select v::text from t_ids where k='ref_hist')
 ) and is_undated and occurred_on is null and occurred_at is null;

insert into t_result
select 'voided follow-up omitted','tb_dots A','live only',
       string_agg(event_id, ',' order by event_id),
       case when count(*)=1 and min(event_id)='followup_recorded:' || (select v::text from t_ids where k='follow_live')
            then 'PASS' else 'FAIL' end
  from public.patient_timeline((select v from t_ids where k='pat_a'))
 where event_type='followup_recorded';

insert into t_result
select 'detail whitelist','tb_dots A','approved keys only',
       coalesce(string_agg(distinct key, ',' order by key), '(none)'),
       case when coalesce(array_agg(distinct key order by key) filter (where key is not null), array[]::text[])
                    <@ array['case_number','delivery_status','facility_short_code','message_kind',
                              'referred','scheduled_date','from_status','to_status']::text[]
            then 'PASS' else 'FAIL' end
  from public.patient_timeline((select v from t_ids where k='pat_a')) t
  left join lateral jsonb_object_keys(t.detail) key on true;

insert into t_result
select 'clinical text absent','tb_dots A','no private text/result values',
       case when string_agg(detail::text,' ') ilike '%PRIVATE%'
                  or string_agg(detail::text,' ') ilike '%positive%'
            then 'found' else 'absent' end,
       case when string_agg(detail::text,' ') ilike '%PRIVATE%'
                  or string_agg(detail::text,' ') ilike '%positive%'
            then 'FAIL' else 'PASS' end
  from public.patient_timeline((select v from t_ids where k='pat_a'));

insert into t_result
select 'stable order','tb_dots A','nondecreasing sort key','checked',
       case when array_agg(event_id order by ordinality)
                      = array_agg(event_id order by is_undated, occurred_on nulls last,
                                  rank, occurred_at nulls last, event_id)
            then 'PASS' else 'FAIL' end
  from public.patient_timeline((select v from t_ids where k='pat_a')) with ordinality;

insert into t_result
select 'limit bound','tb_dots A','one row', count(*)::text,
       case when count(*)=1 then 'PASS' else 'FAIL' end
  from public.patient_timeline((select v from t_ids where k='pat_a'), 1);

reset role;

-- Cross-facility, non-clinical roles, inactive users and absence all return no rows.
select set_config('request.jwt.claims',jsonb_build_object('sub',(select v from t_ids where k='staff_b'),'role','authenticated')::text,true);
set local role authenticated;
insert into t_result select 'cross-facility denied','tb_dots B','0 rows',count(*)::text,
  case when count(*)=0 then 'PASS' else 'FAIL' end
  from public.patient_timeline((select v from t_ids where k='pat_a'));
insert into t_result select 'transferred case arm','tb_dots B','case only',
  string_agg(event_type,',' order by rank),
  case when count(*)=2
             and bool_and(event_type in ('case_registered','treatment_started'))
       then 'PASS' else 'FAIL' end
  from public.patient_timeline((select v from t_ids where k='pat_transfer'));
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',(select v from t_ids where k='bhw'),'role','authenticated')::text,true);
set local role authenticated;
insert into t_result select 'BHW boundary','bhw','0 rows',count(*)::text,
  case when count(*)=0 then 'PASS' else 'FAIL' end
  from public.patient_timeline((select v from t_ids where k='pat_a'));
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',(select v from t_ids where k='admin'),'role','authenticated')::text,true);
set local role authenticated;
insert into t_result select 'admin boundary','admin','0 rows',count(*)::text,
  case when count(*)=0 then 'PASS' else 'FAIL' end
  from public.patient_timeline((select v from t_ids where k='pat_a'));
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',(select v from t_ids where k='inactive'),'role','authenticated')::text,true);
set local role authenticated;
insert into t_result select 'inactive boundary','inactive tb_dots','0 rows',count(*)::text,
  case when count(*)=0 then 'PASS' else 'FAIL' end
  from public.patient_timeline((select v from t_ids where k='pat_a'));
reset role;

-- Function posture and timezone stability.
insert into t_result
select 'function posture','catalog','stable definer, authenticated only',
       format('%s/%s/%s/%s/%s', p.provolatile, p.prosecdef,
              has_function_privilege('authenticated',p.oid,'EXECUTE'),
              has_function_privilege('anon',p.oid,'EXECUTE'),
              has_function_privilege('service_role',p.oid,'EXECUTE')),
       case when p.provolatile='s' and p.prosecdef
                  and has_function_privilege('authenticated',p.oid,'EXECUTE')
                  and not has_function_privilege('anon',p.oid,'EXECUTE')
                  and not has_function_privilege('service_role',p.oid,'EXECUTE')
            then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='patient_timeline';

create temp table t_tz (midway jsonb, utc jsonb) on commit drop;
grant insert, update, select on t_tz to authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select v from t_ids where k='staff_a'),'role','authenticated')::text,true);
set local role authenticated;
set local time zone 'Pacific/Midway';
insert into t_tz (midway)
select jsonb_agg(jsonb_build_array(event_id,occurred_on) order by is_undated,occurred_on,rank,occurred_at,event_id)
  from public.patient_timeline((select v from t_ids where k='pat_a'));
set local time zone 'UTC';
update t_tz set utc=(
  select jsonb_agg(jsonb_build_array(event_id,occurred_on) order by is_undated,occurred_on,rank,occurred_at,event_id)
    from public.patient_timeline((select v from t_ids where k='pat_a'))
);
insert into t_result select 'timezone agreement','tb_dots A','identical Manila dates',
  case when midway=utc then 'identical' else 'different' end,
  case when midway=utc then 'PASS' else 'FAIL' end from t_tz;
reset role;

do $gate$
begin
  if exists (select 1 from t_result where verdict <> 'PASS') then
    raise exception '0036 patient timeline matrix failed';
  end if;
end;
$gate$;

select * from t_result order by check_kind, persona;
