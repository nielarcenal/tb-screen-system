-- ============================================================================
-- 0032_atomic_walkin_matrix.sql — BASE-03 transaction, retry and ACL matrix.
-- Run only through: node scripts/build-preflight.mjs 0032
-- ============================================================================

create temp table t32_ids (k text primary key, v uuid) on commit drop;
insert into t32_ids select k, gen_random_uuid() from unnest(array[
  'fac_a','fac_b','dots_a','dots_a2','bhw','inactive','no_profile',
  'req_ok','pat_ok','scr_ok','ref_ok'
]) k;
create or replace function pg_temp.id32(text) returns uuid
language sql stable security definer set search_path=pg_temp
as $$ select v from t32_ids where k = $1 $$;

create temp table t32_result (
  check_kind text, subject text, expected text, actual text, verdict text
) on commit drop;
create or replace function pg_temp.check32(
  p_kind text, p_subject text, p_expected text, p_actual text, p_ok boolean
) returns void language sql as $$
  insert into t32_result values ($1,$2,$3,$4,case when $5 then 'PASS' else 'FAIL' end)
$$;

create temp table t32_brgy as
select barangay_code from public.ref_barangays order by barangay_code limit 1;

insert into public.facilities (facility_id,name,type,address,short_code) values
  (pg_temp.id32('fac_a'),'0032 DOTS A','tb_dots','test','M32A'),
  (pg_temp.id32('fac_b'),'0032 DOTS B','tb_dots','test','M32B');
insert into auth.users (id) select v from t32_ids
 where k in ('dots_a','dots_a2','bhw','inactive','no_profile');
insert into public.users (user_id,role,full_name,facility_id,assigned_barangay_code,active) values
  (pg_temp.id32('dots_a'),'tb_dots','0032 DOTS A',pg_temp.id32('fac_a'),null,true),
  (pg_temp.id32('dots_a2'),'tb_dots','0032 DOTS A2',pg_temp.id32('fac_a'),null,true),
  (pg_temp.id32('bhw'),'bhw','0032 BHW',pg_temp.id32('fac_a'),(select barangay_code from t32_brgy),true),
  (pg_temp.id32('inactive'),'tb_dots','0032 inactive',pg_temp.id32('fac_a'),null,false);

create temp table t32_persona (persona text primary key, uid uuid, jwt_role text) on commit drop;
insert into t32_persona values
  ('anon','00000000-0000-4000-8000-000000000000','anon'),
  ('no_profile',pg_temp.id32('no_profile'),'authenticated'),
  ('bhw',pg_temp.id32('bhw'),'authenticated'),
  ('inactive',pg_temp.id32('inactive'),'authenticated'),
  ('dots_a',pg_temp.id32('dots_a'),'authenticated'),
  ('dots_a2',pg_temp.id32('dots_a2'),'authenticated');
create or replace function pg_temp.become32(p text) returns void language plpgsql as $$
declare r record;
begin
  select * into r from t32_persona where persona=p;
  execute format('set local role %I',r.jwt_role);
  if p='anon' then perform set_config('request.jwt.claims','',true);
  else perform set_config('request.jwt.claims',json_build_object('sub',r.uid,'role',r.jwt_role)::text,true);
  end if;
end $$;

create or replace function pg_temp.flags32(p_flag boolean default false) returns jsonb
language sql immutable as $$ select jsonb_build_object(
  'cough_2wks',case when $1 then 'yes' else 'no' end,
  'weight_loss','no','night_sweats','no','fever','no','hemoptysis','no',
  'chest_pain','no','fatigue','no','loss_of_appetite','no','tb_contact','no') $$;

create or replace function pg_temp.call32(
  req uuid, pat uuid, scr uuid, ref uuid, first_name text default 'Juan',
  flags jsonb default pg_temp.flags32(false)
) returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select public.register_walkin(
    req,pat,scr,ref,first_name,null,'Dela Cruz',date '1990-01-01','male',
    (select barangay_code from t32_brgy),null,false,null,null,flags,'mild',
    null,null,null,null,null,null,null)
$$;

-- Effective function ACL: only authenticated receives execute.
select pg_temp.check32('ACL','anon execute','false',
  has_function_privilege('anon','public.register_walkin(uuid,uuid,uuid,uuid,text,text,text,date,text,text,text,boolean,text,text,jsonb,text,numeric,numeric,numeric,integer,integer,integer,integer)','EXECUTE')::text,
  not has_function_privilege('anon','public.register_walkin(uuid,uuid,uuid,uuid,text,text,text,date,text,text,text,boolean,text,text,jsonb,text,numeric,numeric,numeric,integer,integer,integer,integer)','EXECUTE'));
select pg_temp.check32('ACL','authenticated execute','true',
  has_function_privilege('authenticated','public.register_walkin(uuid,uuid,uuid,uuid,text,text,text,date,text,text,text,boolean,text,text,jsonb,text,numeric,numeric,numeric,integer,integer,integer,integer)','EXECUTE')::text,
  has_function_privilege('authenticated','public.register_walkin(uuid,uuid,uuid,uuid,text,text,text,date,text,text,text,boolean,text,text,jsonb,text,numeric,numeric,numeric,integer,integer,integer,integer)','EXECUTE'));
select pg_temp.check32('ACL','service_role execute','false',
  has_function_privilege('service_role','public.register_walkin(uuid,uuid,uuid,uuid,text,text,text,date,text,text,text,boolean,text,text,jsonb,text,numeric,numeric,numeric,integer,integer,integer,integer)','EXECUTE')::text,
  not has_function_privilege('service_role','public.register_walkin(uuid,uuid,uuid,uuid,text,text,text,date,text,text,text,boolean,text,text,jsonb,text,numeric,numeric,numeric,integer,integer,integer,integer)','EXECUTE'));

-- Wrong callers all reach the active TB-DOTS gate and are denied.
do $acl$
declare p text; ok boolean; msg text;
begin
  foreach p in array array['no_profile','bhw','inactive'] loop
    perform pg_temp.become32(p);
    begin perform pg_temp.call32(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()); ok:=true; msg:='allowed';
    exception when others then ok:=false; msg:=left(sqlerrm,60); end;
    reset role;
    perform pg_temp.check32('caller gate',p,'denied',msg,not ok);
  end loop;
end $acl$;

-- Successful call: all three rows agree and server-derived values are pinned.
do $success$
declare result jsonb; n int; actual text; expected text;
begin
  perform pg_temp.become32('dots_a');
  result:=pg_temp.call32(pg_temp.id32('req_ok'),pg_temp.id32('pat_ok'),pg_temp.id32('scr_ok'),pg_temp.id32('ref_ok'),'  Juan  ',pg_temp.flags32(true));
  reset role;
  select count(*) into n from public.patients where patient_id=pg_temp.id32('pat_ok');
  perform pg_temp.check32('atomic success','patient count','1',n::text,n=1);
  select count(*) into n from public.screenings where screening_id=pg_temp.id32('scr_ok') and patient_id=pg_temp.id32('pat_ok') and referred;
  perform pg_temp.check32('atomic success','screening linked + server decision','1',n::text,n=1);
  select count(*) into n from public.referrals where referral_id=pg_temp.id32('ref_ok') and patient_id=pg_temp.id32('pat_ok') and screening_id=pg_temp.id32('scr_ok') and facility_id=pg_temp.id32('fac_a') and status='received';
  perform pg_temp.check32('atomic success','received referral linked + scoped','1',n::text,n=1);
  select full_name||'/'||age||'/'||coalesce(contact_number,'null') into actual from public.patients where patient_id=pg_temp.id32('pat_ok');
  expected:='Juan Dela Cruz/'||extract(year from age(public.manila_today(),date '1990-01-01'))::integer||'/null';
  perform pg_temp.check32('server derivation','normalized name, age, no contact',expected,actual,actual=expected);
  perform pg_temp.check32('response','all identifiers returned','true',
    ((result->>'patient_id')::uuid=pg_temp.id32('pat_ok') and (result->>'screening_id')::uuid=pg_temp.id32('scr_ok') and (result->>'referral_id')::uuid=pg_temp.id32('ref_ok') and (result->>'referred')::boolean)::text,
    (result->>'patient_id')::uuid=pg_temp.id32('pat_ok') and (result->>'screening_id')::uuid=pg_temp.id32('scr_ok') and (result->>'referral_id')::uuid=pg_temp.id32('ref_ok') and (result->>'referred')::boolean);
end $success$;

-- Lost response: exact retry returns the same result and creates nothing.
do $retry$
declare result jsonb; n int; ok boolean; msg text;
begin
  perform pg_temp.become32('dots_a');
  result:=pg_temp.call32(pg_temp.id32('req_ok'),pg_temp.id32('pat_ok'),pg_temp.id32('scr_ok'),pg_temp.id32('ref_ok'),'Juan',pg_temp.flags32(true));
  reset role;
  select count(*) into n from public.patients where patient_id=pg_temp.id32('pat_ok');
  perform pg_temp.check32('idempotency','same result id',(pg_temp.id32('pat_ok'))::text,result->>'patient_id',(result->>'patient_id')::uuid=pg_temp.id32('pat_ok'));
  perform pg_temp.check32('idempotency','no duplicate patient','1',n::text,n=1);

  perform pg_temp.become32('dots_a');
  begin perform pg_temp.call32(pg_temp.id32('req_ok'),pg_temp.id32('pat_ok'),pg_temp.id32('scr_ok'),pg_temp.id32('ref_ok'),'Pedro',pg_temp.flags32(true)); ok:=true; msg:='allowed';
  exception when others then ok:=false; msg:=left(sqlerrm,60); end;
  reset role;
  perform pg_temp.check32('idempotency','same key different payload','denied',msg,not ok and msg like 'not authorized%');

  perform pg_temp.become32('dots_a2');
  begin perform pg_temp.call32(pg_temp.id32('req_ok'),pg_temp.id32('pat_ok'),pg_temp.id32('scr_ok'),pg_temp.id32('ref_ok'),'Juan',pg_temp.flags32(true)); ok:=true; msg:='allowed';
  exception when others then ok:=false; msg:=left(sqlerrm,60); end;
  reset role;
  perform pg_temp.check32('idempotency','same key different actor','denied',msg,not ok and msg like 'not authorized%');
end $retry$;

-- Inject a failure after patient insert and after screening insert. Each call is
-- a subtransaction; the preceding rows must disappear with the exception.
create or replace function pg_temp.fail32() returns trigger language plpgsql as $$
begin
  if current_setting('tbscreen.test_fail_at',true)=tg_table_name then
    raise exception '0032 injected failure at %',tg_table_name;
  end if;
  return new;
end $$;
create trigger z_0032_fail_patient before insert on public.patients for each row execute function pg_temp.fail32();
create trigger z_0032_fail_screening before insert on public.screenings for each row execute function pg_temp.fail32();
create trigger z_0032_fail_referral before insert on public.referrals for each row execute function pg_temp.fail32();

do $rollback$
declare target text; req uuid; pat uuid; scr uuid; ref uuid; ok boolean; n int;
begin
  foreach target in array array['patients','screenings','referrals'] loop
    req:=gen_random_uuid(); pat:=gen_random_uuid(); scr:=gen_random_uuid(); ref:=gen_random_uuid();
    perform set_config('tbscreen.test_fail_at',target,true);
    perform pg_temp.become32('dots_a');
    begin perform pg_temp.call32(req,pat,scr,ref); ok:=true;
    exception when others then ok:=false; end;
    reset role;
    perform set_config('tbscreen.test_fail_at','',true);
    select (select count(*) from public.patients where patient_id=pat)
         + (select count(*) from public.screenings where screening_id=scr)
         + (select count(*) from public.referrals where referral_id=ref)
         + (select count(*) from public.rpc_requests where operation='register_walkin' and request_id=req)
      into n;
    perform pg_temp.check32('transaction rollback','failure at '||target,'denied / 0 rows',(case when ok then 'allowed' else 'denied' end)||' / '||n,not ok and n=0);
  end loop;
end $rollback$;

drop trigger z_0032_fail_patient on public.patients;
drop trigger z_0032_fail_screening on public.screenings;
drop trigger z_0032_fail_referral on public.referrals;

select verdict,check_kind,subject,expected,actual from t32_result
order by (verdict='PASS'),check_kind,subject;
do $verdict$
declare failures int; total int;
begin
  select count(*) filter(where verdict='FAIL'),count(*) into failures,total from t32_result;
  if total=0 or failures>0 then
    raise exception '0032 matrix: % of % checks failed',failures,total;
  end if;
  raise notice '0032 matrix: all % checks passed',total;
end $verdict$;
