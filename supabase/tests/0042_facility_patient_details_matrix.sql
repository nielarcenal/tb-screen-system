-- Execute via build-preflight.mjs 0042: fixtures and migration always roll back.
create temp table t42_ids (k text primary key,v uuid default gen_random_uuid());
insert into t42_ids(k) values ('fac'),('other_fac'),('staff'),('other'),('inactive'),('admin'),('bhw'),('midwife'),('p'),('foreign'),('duplicate');
grant select on t42_ids to authenticated;
insert into public.facilities(facility_id,name,type,address,short_code)
select v,'0042 test '||k,'tb_dots','test',case when k='fac' then 'T42A' else 'T42B' end from t42_ids where k in ('fac','other_fac');
insert into auth.users(id) select v from t42_ids where k in ('staff','other','inactive','admin','bhw','midwife');
insert into public.users(user_id,role,full_name,facility_id,active,assigned_barangay_code)
select v,case when k in ('admin','bhw','midwife') then k else 'tb_dots' end,'0042 '||k,
  (select v from t42_ids where k=case when x.k='other' then 'other_fac' else 'fac' end),k<>'inactive',
  case when k in ('bhw','midwife') then (select barangay_code from public.ref_barangays order by barangay_code limit 1) end
from t42_ids x where k in ('staff','other','inactive','admin','bhw','midwife');
insert into public.patients(patient_id,display_code,enrolled_by,first_name,last_name,full_name,birthdate,age,sex,barangay_code,updated_at)
select v,'T42-'||k,(select v from t42_ids where k=case when x.k='foreign' then 'other' else 'staff' end),
  case when k='duplicate' then 'Duplicate' else 'Original' end,'Patient',
  case when k='duplicate' then 'Duplicate Patient' else 'Original Patient' end,'1990-01-01',36,'female',
  (select barangay_code from public.ref_barangays order by barangay_code limit 1),'2026-01-01'
from t42_ids x where k in ('p','foreign','duplicate');

-- Helper uses known fixture values, not privileged reads: caller is authenticated.
create function pg_temp.edit42(p_key text,p_first text,p_version timestamptz default '2026-01-01',p_sms boolean default false,p_phone text default null,p_lang text default null)
returns public.patients language sql as $f$
  select public.update_facility_patient((select v from t42_ids where k=p_key),p_version,p_first,null,'Patient','1990-01-01','female',
    (select barangay_code from public.ref_barangays order by barangay_code limit 1),null,p_sms,p_phone,p_lang);
$f$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select v from t42_ids where k='staff'),'role','authenticated')::text,true);
do $test$
declare p public.patients; a jsonb;
begin
  if (select count(*) from public.patients where patient_id in (select v from t42_ids where k in ('p','foreign','duplicate'))) <> 2 then
    raise exception 'FAIL: facility patient read scope';
  end if;
  begin perform pg_temp.edit42('foreign','Wrong'); raise exception 'FAIL: foreign update accepted'; exception when insufficient_privilege then null; end;
  begin perform pg_temp.edit42('p','Duplicate'); raise exception 'FAIL: duplicate accepted'; exception when unique_violation then null; end;
  begin perform pg_temp.edit42('p','Corrected','2026-01-01',true,'123','en'); raise exception 'FAIL: invalid SMS accepted'; exception when invalid_parameter_value then null; end;
  select * into p from pg_temp.edit42('p','Corrected','2026-01-01',true,'09171234567','ceb');
  if p.full_name <> 'Corrected Patient' or p.consent_date is null or p.preferred_language <> 'ceb' then raise exception 'FAIL: update or consent'; end if;
  begin perform pg_temp.edit42('p','Stale'); raise exception 'FAIL: stale update accepted'; exception when serialization_failure then null; end;
  select * into p from pg_temp.edit42('p','Corrected',p.updated_at,false,'09171234567','ceb');
  if p.contact_number is not null or p.consent_date is not null or p.preferred_language is not null then raise exception 'FAIL: consent withdrawal retains SMS data'; end if;
  if (select count(*) from public.audit_logs where entity_table='patients' and patient_id=p.patient_id) <> 2 then raise exception 'FAIL: audit count'; end if;
  for a in select changes from public.audit_logs where entity_table='patients' and patient_id=p.patient_id loop
    if a::text like '%Corrected%' or a::text like '%0917%' then raise exception 'FAIL: audit leaks demographics'; end if;
  end loop;
  -- No-op does not create another audit event.
  perform pg_temp.edit42('p','Corrected',p.updated_at);
  if (select count(*) from public.audit_logs where entity_table='patients' and patient_id=p.patient_id) <> 2 then raise exception 'FAIL: no-op audited'; end if;
  raise notice 'PASS: scope, duplicate, SMS validation, stale edits, consent withdrawal, safe audit and no-op';
end;
$test$;
do $roles$
declare v_role_key text;
begin
  foreach v_role_key in array array['other','inactive','admin','bhw','midwife'] loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',(select v from t42_ids x where x.k=v_role_key),'role','authenticated')::text,true);
    begin perform pg_temp.edit42('p','Denied'); raise exception 'FAIL: unauthorized role %',v_role_key; exception when insufficient_privilege then null; end;
  end loop;
  raise notice 'PASS: unrelated facility, inactive staff, admin, BHW and midwife denied';
end;
$roles$;
reset role;
select set_config('request.jwt.claims','{}',true);
do $privileges$
begin
  if has_function_privilege('anon','public.update_facility_patient(uuid,timestamptz,text,text,text,date,text,text,text,boolean,text,text)','execute') then
    raise exception 'FAIL: anon execute privilege';
  end if;
  raise notice 'PASS: anonymous execute revoked';
end;
$privileges$;
select '0042 patient detail matrix PASS' as result;
