-- Day 7 capstone story: synthetic data only. Not a migration.
-- Idempotent PAT-CAP-* rows; no consent/contact, so SMS cannot select them.
begin;

create temp table cap_ctx on commit drop as
select u.user_id staff_id, u.facility_id, f.name facility_name,
       (select barangay_code from public.ref_barangays order by barangay_code limit 1) barangay_code
  from public.users u join public.facilities f using (facility_id)
 where u.role = 'tb_dots' and u.active
 order by f.name, u.user_id limit 1;

do $guard$ begin
  if not exists (select 1 from cap_ctx where barangay_code is not null) then
    raise exception 'Day 7 seed needs an active TB-DOTS user and a barangay row';
  end if;
end $guard$;

delete from public.audit_logs where patient_id in
  (select patient_id from public.patients where display_code like 'PAT-CAP-%');
delete from public.treatment_followups where case_id in
  (select c.case_id from public.tb_cases c join public.patients p using (patient_id)
    where p.display_code like 'PAT-CAP-%');
delete from public.appointments where patient_id in
  (select patient_id from public.patients where display_code like 'PAT-CAP-%');
delete from public.tb_cases where patient_id in
  (select patient_id from public.patients where display_code like 'PAT-CAP-%');
delete from public.referrals where patient_id in
  (select patient_id from public.patients where display_code like 'PAT-CAP-%');
delete from public.screenings where patient_id in
  (select patient_id from public.patients where display_code like 'PAT-CAP-%');
delete from public.patients where display_code like 'PAT-CAP-%';

insert into public.patients
  (patient_id,display_code,enrolled_by,full_name,first_name,last_name,birthdate,age,sex,barangay_code,sms_consent,contact_number)
select ('d7000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
       'PAT-CAP-'||lpad(i::text,2,'0'), c.staff_id,
       'Capstone Synthetic '||i, 'Capstone', 'Synthetic '||i,
       date '1990-01-01', 36, case when i%2=0 then 'male' else 'female' end,
       c.barangay_code, false, null
  from cap_ctx c cross join generate_series(1,7) i;

insert into public.screenings
  (screening_id,patient_id,symptom_flags,pgis_severity,referred,created_at)
select ('d7100000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
       ('d7000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
       case when i=1 then
         '{"cough_2wks":"no","weight_loss":"no","night_sweats":"no","fever":"no","hemoptysis":"no","chest_pain":"no","fatigue":"no","loss_of_appetite":"no","tb_contact":"no"}'::jsonb
       else
         '{"cough_2wks":"yes","weight_loss":"no","night_sweats":"no","fever":"no","hemoptysis":"no","chest_pain":"no","fatigue":"no","loss_of_appetite":"no","tb_contact":"no"}'::jsonb end,
       case when i=1 then 'none' else 'mild' end, i<>1, now()-make_interval(days=>100-i)
  from generate_series(1,7) i;

insert into public.referrals
  (referral_id,patient_id,screening_id,facility_id,status,presented,result_outcome,result_date,created_at)
select ('d7200000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
       ('d7000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
       ('d7100000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
       c.facility_id, case when i=2 then 'submitted' else 'tested' end,
       case when i=2 then null else true end,
       case when i=2 then null else 'positive' end,
       case when i=2 then null else now()-make_interval(days=>90-i) end,
       now()-make_interval(days=>95-i)
  from cap_ctx c cross join generate_series(2,7) i;

insert into public.tb_cases
  (case_id,patient_id,referral_id,facility_id,case_number,registration_date,case_status,treatment_start_date,outcome,outcome_date,created_by)
select ('d7300000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
       ('d7000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
       ('d7200000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
       c.facility_id, 'CAP-'||lpad(i::text,2,'0'),
       public.manila_today()-(case when i=7 then 180 else 70 end),
       case when i=3 then 'registered' else 'on_treatment' end,
       case when i=3 then null else public.manila_today()-(case when i=7 then 175 else 65 end) end,
       null, null, c.staff_id
  from cap_ctx c cross join generate_series(3,7) i;

insert into public.appointments
  (appointment_id,patient_id,scheduled_date,attended_date,status,facility_id,tb_case_id)
select v.appointment_id,v.patient_id,v.scheduled_date,v.attended_date,v.status,c.facility_id,v.case_id
  from cap_ctx c cross join (values
  ('d7400000-0000-0000-0000-000000000041'::uuid,'d7000000-0000-0000-0000-000000000004'::uuid,public.manila_today()-30,public.manila_today()-30,'attended','d7300000-0000-0000-0000-000000000004'::uuid),
  ('d7400000-0000-0000-0000-000000000042'::uuid,'d7000000-0000-0000-0000-000000000004'::uuid,public.manila_today()-3,null,'missed','d7300000-0000-0000-0000-000000000004'::uuid),
  ('d7400000-0000-0000-0000-000000000050'::uuid,'d7000000-0000-0000-0000-000000000005'::uuid,public.manila_today()-7,public.manila_today()-7,'attended','d7300000-0000-0000-0000-000000000005'::uuid),
  ('d7400000-0000-0000-0000-000000000060'::uuid,'d7000000-0000-0000-0000-000000000006'::uuid,public.manila_today()-8,null,'missed','d7300000-0000-0000-0000-000000000006'::uuid),
  ('d7400000-0000-0000-0000-000000000070'::uuid,'d7000000-0000-0000-0000-000000000007'::uuid,public.manila_today()-20,public.manila_today()-20,'attended','d7300000-0000-0000-0000-000000000007'::uuid)
  ) v(appointment_id,patient_id,scheduled_date,attended_date,status,case_id);

insert into public.treatment_followups (followup_id,case_id,appointment_id,visit_date,recorded_by)
select v.followup_id,v.case_id,v.appointment_id,v.visit_date,c.staff_id
  from cap_ctx c cross join (values
  ('d7500000-0000-0000-0000-000000000041'::uuid,'d7300000-0000-0000-0000-000000000004'::uuid,'d7400000-0000-0000-0000-000000000041'::uuid,public.manila_today()-30),
  ('d7500000-0000-0000-0000-000000000050'::uuid,'d7300000-0000-0000-0000-000000000005'::uuid,'d7400000-0000-0000-0000-000000000050'::uuid,public.manila_today()-7),
  ('d7500000-0000-0000-0000-000000000070'::uuid,'d7300000-0000-0000-0000-000000000007'::uuid,'d7400000-0000-0000-0000-000000000070'::uuid,public.manila_today()-20)
  ) v(followup_id,case_id,appointment_id,visit_date);

-- Construct the completed story in lifecycle order: the case is active while
-- its historical visit is attached, then closes after that visit.
update public.tb_cases
   set case_status='closed', outcome='treatment_completed',
       outcome_date=public.manila_today()-10
 where case_id='d7300000-0000-0000-0000-000000000007'::uuid;

do $verify$ declare p int; safe int; c int; a int; m int; closed int; begin
  select count(*),count(*) filter(where not sms_consent and contact_number is null)
    into p,safe from public.patients where display_code like 'PAT-CAP-%';
  select count(*),count(*) filter(where case_status='closed') into c,closed from public.tb_cases
    where patient_id in(select patient_id from public.patients where display_code like 'PAT-CAP-%');
  select count(*) filter(where status='attended'),count(*) filter(where status='missed') into a,m
    from public.appointments where patient_id in(select patient_id from public.patients where display_code like 'PAT-CAP-%');
  if (p,safe,c,a,m,closed)<>(7,7,5,3,2,1) then
    raise exception 'Day 7 seed verification failed';
  end if;
end $verify$;

select facility_name, 7 synthetic_patients,
       'PAT-CAP-*; no SMS consent or contact numbers' safety from cap_ctx;

-- Change only this ROLLBACK to COMMIT after reviewing the selected facility
-- printed above. The repository-safe default proves the dataset without
-- leaving records in a linked database.
rollback;
