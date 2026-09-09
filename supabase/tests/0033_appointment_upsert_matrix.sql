-- ============================================================================
-- 0033_appointment_upsert_matrix.sql — effective grants + legacy retry shape.
-- Run only through: node scripts/build-preflight.mjs 0033
-- ============================================================================

create temp table t33_ids (k text primary key, v uuid) on commit drop;
insert into t33_ids select k,gen_random_uuid() from unnest(array[
  'dots_fac','bhs_fac','bhw','patient','screening','referral','appointment'
]) k;
create or replace function pg_temp.id33(text) returns uuid language sql stable
security definer set search_path=pg_temp as $$ select v from t33_ids where k=$1 $$;
create temp table t33_result (kind text,subject text,expected text,actual text,verdict text) on commit drop;
create or replace function pg_temp.check33(k text,s text,e text,a text,ok boolean)
returns void language sql as $$ insert into t33_result values($1,$2,$3,$4,case when $5 then 'PASS' else 'FAIL' end) $$;

create temp table t33_brgy as select barangay_code from public.ref_barangays order by barangay_code limit 1;
insert into public.facilities(facility_id,name,type,address,short_code) values
  (pg_temp.id33('dots_fac'),'0033 DOTS','tb_dots','test','M33A'),
  (pg_temp.id33('bhs_fac'),'0033 BHS','barangay_health_station','test',null);
insert into auth.users(id) values(pg_temp.id33('bhw'));
insert into public.users(user_id,role,full_name,facility_id,assigned_barangay_code,active)
values(pg_temp.id33('bhw'),'bhw','0033 BHW',pg_temp.id33('bhs_fac'),(select barangay_code from t33_brgy),true);
insert into public.patients(patient_id,display_code,enrolled_by,age,sex,barangay_code,sms_consent)
values(pg_temp.id33('patient'),'M33-PAT',pg_temp.id33('bhw'),30,'male',(select barangay_code from t33_brgy),false);
insert into public.screenings(screening_id,patient_id,referred)
values(pg_temp.id33('screening'),pg_temp.id33('patient'),true);
insert into public.referrals(referral_id,patient_id,screening_id,facility_id,status)
values(pg_temp.id33('referral'),pg_temp.id33('patient'),pg_temp.id33('screening'),pg_temp.id33('dots_fac'),'submitted');
insert into public.appointments(
  appointment_id,patient_id,scheduled_date,attended_date,status,facility_id,referral_id
) values(
  pg_temp.id33('appointment'),pg_temp.id33('patient'),public.manila_today(),
  public.manila_today(),'attended',pg_temp.id33('dots_fac'),pg_temp.id33('referral')
);

-- Pin the effective privilege surface, not the GRANT statement.
do $grants$
declare c text; allowed text[]:=array[
  'appointment_id','patient_id','scheduled_date','attended_date','status',
  'created_at','updated_at','facility_id','referral_id'
]; actual boolean;
begin
  foreach c in array allowed loop
    actual:=has_column_privilege('authenticated','public.appointments',c,'UPDATE');
    perform pg_temp.check33('column grant',c,'true',actual::text,actual);
  end loop;
  actual:=has_column_privilege('authenticated','public.appointments','tb_case_id','UPDATE');
  perform pg_temp.check33('column grant','tb_case_id','false',actual::text,not actual);
end $grants$;

-- Become the BHW with a real authenticated JWT claim.
set local role authenticated;
select set_config('request.jwt.claims',json_build_object(
  'sub',pg_temp.id33('bhw'),'role','authenticated')::text,true);

-- Exact legacy whole-row payload: ownership columns are omitted.
insert into public.appointments(
  appointment_id,patient_id,scheduled_date,attended_date,status,created_at,updated_at
)
select appointment_id,patient_id,scheduled_date,attended_date,status,created_at,updated_at
from public.appointments where appointment_id=pg_temp.id33('appointment')
on conflict(appointment_id) do update set
  appointment_id=excluded.appointment_id,
  patient_id=excluded.patient_id,
  scheduled_date=excluded.scheduled_date,
  attended_date=excluded.attended_date,
  status=excluded.status,
  created_at=excluded.created_at,
  updated_at=excluded.updated_at;

-- Exact new-client referral-linked retry: ownership is assigned identically.
insert into public.appointments(
  appointment_id,patient_id,scheduled_date,attended_date,status,created_at,updated_at,
  facility_id,referral_id
)
select appointment_id,patient_id,scheduled_date,attended_date,status,created_at,updated_at,
       facility_id,referral_id
from public.appointments where appointment_id=pg_temp.id33('appointment')
on conflict(appointment_id) do update set
  appointment_id=excluded.appointment_id,
  patient_id=excluded.patient_id,
  scheduled_date=excluded.scheduled_date,
  attended_date=excluded.attended_date,
  status=excluded.status,
  created_at=excluded.created_at,
  updated_at=excluded.updated_at,
  facility_id=excluded.facility_id,
  referral_id=excluded.referral_id;

reset role;
do $results$
declare n int; ok boolean; msg text; before_created timestamptz;
begin
  select count(*) into n from public.appointments
   where appointment_id=pg_temp.id33('appointment')
     and facility_id=pg_temp.id33('dots_fac')
     and referral_id=pg_temp.id33('referral');
  perform pg_temp.check33('legacy upsert','ownership survives','1',n::text,n=1);

  select created_at into before_created from public.appointments where appointment_id=pg_temp.id33('appointment');
  set local role authenticated;
  perform set_config('request.jwt.claims',json_build_object('sub',pg_temp.id33('bhw'),'role','authenticated')::text,true);
  begin
    update public.appointments set created_at=created_at-interval '1 day'
     where appointment_id=pg_temp.id33('appointment');
    ok:=true;msg:='allowed';
  exception when others then ok:=false;msg:=left(sqlerrm,70); end;
  reset role;
  perform pg_temp.check33('immutability','created_at real change','denied',msg,not ok);

  set local role authenticated;
  perform set_config('request.jwt.claims',json_build_object('sub',pg_temp.id33('bhw'),'role','authenticated')::text,true);
  begin
    update public.appointments set appointment_id=gen_random_uuid()
     where appointment_id=pg_temp.id33('appointment');
    ok:=true;msg:='allowed';
  exception when others then ok:=false;msg:=left(sqlerrm,70); end;
  reset role;
  perform pg_temp.check33('immutability','appointment_id real change','denied',msg,not ok);
end $results$;

select verdict,kind,subject,expected,actual from t33_result order by (verdict='PASS'),kind,subject;
do $verdict$
declare failures int; total int;
begin
  select count(*) filter(where verdict='FAIL'),count(*) into failures,total from t33_result;
  if total=0 or failures>0 then raise exception '0033 matrix: % of % checks failed',failures,total; end if;
  raise notice '0033 matrix: all % checks passed',total;
end $verdict$;
