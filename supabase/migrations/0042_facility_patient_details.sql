-- Facility demographic corrections; no broad patient UPDATE policy is added.
-- The directory continues using patients SELECT RLS (0029). Identity is shared,
-- clinical records remain facility-scoped. Audits contain category flags only.
alter table public.audit_logs drop constraint if exists audit_logs_entity_table_check;
alter table public.audit_logs add constraint audit_logs_entity_table_check
  check (entity_table in ('tb_cases','treatment_followups','appointments','referrals','case_lab_results','case_vitals','patients'));

create or replace function public.enforce_audit_changes_whitelist()
returns trigger language plpgsql set search_path = public as $fn$
declare allowed text[]; k text;
begin
  new.changes := coalesce(new.changes, '{}'::jsonb);
  if jsonb_typeof(new.changes) <> 'object' then
    raise exception 'audit changes must be an object' using errcode = '22023';
  end if;
  allowed := case new.entity_table
    when 'tb_cases' then array['case_status','treatment_start_date','outcome','outcome_date','registration_date','facility_id','case_number']
    when 'treatment_followups' then array['visit_date','voided_at','void_reason']
    when 'appointments' then array['status','scheduled_date','attended_date','facility_id','referral_id','tb_case_id']
    when 'referrals' then array['status','presented','result_date','facility_id','lab_sample_id']
    when 'case_lab_results' then array['result_date','voided_at','void_reason']
    when 'case_vitals' then array['measured_on','voided_at','void_reason']
    when 'patients' then array['identity_changed','address_changed','sms_changed']
  end;
  if allowed is null then
    raise exception 'unknown audit entity' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(new.changes) loop
    if not (k = any(allowed)) then
      raise exception 'audit field is not permitted' using errcode = '42501';
    end if;
    -- No demographic values, phone numbers or free text in admin-readable logs.
    if new.entity_table = 'patients' and new.changes->k <> '{"from":false,"to":true}'::jsonb then
      raise exception 'patient audits accept category flags only' using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$fn$;

create or replace function public.update_facility_patient(
  p_patient_id uuid, p_expected_updated_at timestamptz,
  p_first_name text, p_middle_name text, p_last_name text, p_birthdate date,
  p_sex text, p_barangay_code text, p_sitio text,
  p_sms_consent boolean, p_contact_number text, p_preferred_language text
) returns public.patients
language plpgsql security definer set search_path = public as $fn$
declare
  v_caller record; v_old public.patients; v_new public.patients;
  v_first text := regexp_replace(btrim(p_first_name), '\s+', ' ', 'g');
  v_middle text := nullif(regexp_replace(btrim(p_middle_name), '\s+', ' ', 'g'), '');
  v_last text := regexp_replace(btrim(p_last_name), '\s+', ' ', 'g');
  v_age integer; v_identity boolean; v_address boolean; v_sms boolean;
begin
  select * into v_caller from app_private.tbdots_caller();
  -- Check scope before taking a table lock; foreign/nonexistent IDs are identical.
  if not exists (select 1 from public.patients p where p.patient_id = p_patient_id
    and (p.enrolled_by = v_caller.caller_user_id or exists (
      select 1 from public.referrals r where r.patient_id = p.patient_id and r.facility_id = v_caller.caller_facility_id))) then
    perform app_private.deny();
  end if;
  -- Serialize the identity collision check with ALL patient writers, including
  -- registrations and mobile sync. Short transaction; revisit for large deployments.
  lock table public.patients in share row exclusive mode;
  select * into v_old from public.patients p where p.patient_id = p_patient_id
    and (p.enrolled_by = v_caller.caller_user_id or exists (
      select 1 from public.referrals r where r.patient_id = p.patient_id and r.facility_id = v_caller.caller_facility_id)) for update;
  if not found then perform app_private.deny(); end if;
  if p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'patient was changed; reload before editing' using errcode = '40001';
  end if;
  if p_barangay_code is distinct from v_old.barangay_code then
    raise exception 'barangay reassignment requires a separate access handoff' using errcode = '42501';
  end if;
  v_age := extract(year from age(public.manila_today(), p_birthdate));
  if coalesce(v_first,'') = '' or coalesce(v_last,'') = ''
     or length(v_first) > 100 or length(v_middle) > 100 or length(v_last) > 100
     or p_birthdate is null or p_birthdate > public.manila_today() or v_age < 0 or v_age >= 130
     or p_sex is null or p_sex not in ('male','female')
     or p_barangay_code is null or not exists (select 1 from public.ref_barangays where barangay_code = p_barangay_code)
     or length(p_sitio) > 200 or p_sms_consent is null then
    raise exception 'invalid patient details' using errcode = '22023';
  end if;
  if p_sms_consent and (p_contact_number is null or btrim(p_contact_number) !~ '^09[0-9]{9}$'
     or p_preferred_language is null or p_preferred_language not in ('en','tl','ceb')) then
    raise exception 'SMS consent requires a valid mobile number and language' using errcode = '22023';
  end if;
  v_identity := row(v_old.first_name,v_old.middle_name,v_old.last_name,v_old.birthdate,v_old.sex)
    is distinct from row(v_first,v_middle,v_last,p_birthdate,p_sex);
  -- A correction is not a merge. Do not expose the matching record's identity.
  if v_identity and exists (select 1 from public.patients p where p.patient_id <> p_patient_id
    and lower(regexp_replace(btrim(p.first_name),'\s+',' ','g')) = lower(v_first)
    and lower(regexp_replace(btrim(coalesce(p.middle_name,'')),'\s+',' ','g')) = lower(coalesce(v_middle,''))
    and lower(regexp_replace(btrim(p.last_name),'\s+',' ','g')) = lower(v_last)
    and p.birthdate = p_birthdate) then
    raise exception 'another patient matches this identity' using errcode = '23505';
  end if;
  v_address := row(v_old.barangay_code,v_old.sitio) is distinct from row(p_barangay_code,nullif(btrim(p_sitio),''));
  v_sms := row(v_old.sms_consent,v_old.contact_number,v_old.preferred_language) is distinct from
    row(p_sms_consent,case when p_sms_consent then btrim(p_contact_number) end,case when p_sms_consent then p_preferred_language end);
  if not (v_identity or v_address or v_sms) then return v_old; end if;
  update public.patients set first_name=v_first,middle_name=v_middle,last_name=v_last,
    full_name=concat_ws(' ',v_first,v_middle,v_last),birthdate=p_birthdate,age=v_age,sex=p_sex,
    barangay_code=p_barangay_code,sitio=nullif(btrim(p_sitio),''),sms_consent=p_sms_consent,
    contact_number=case when p_sms_consent then btrim(p_contact_number) end,
    preferred_language=case when p_sms_consent then p_preferred_language end,
    consent_date=case when p_sms_consent then case when v_sms then now() else v_old.consent_date end end
    where patient_id=p_patient_id returning * into v_new;
  perform app_private.write_audit('patients',p_patient_id,'updated',p_patient_id,v_caller.caller_facility_id,
    (case when v_identity then '{"identity_changed":{"from":false,"to":true}}'::jsonb else '{}'::jsonb end) ||
    (case when v_address then '{"address_changed":{"from":false,"to":true}}'::jsonb else '{}'::jsonb end) ||
    (case when v_sms then '{"sms_changed":{"from":false,"to":true}}'::jsonb else '{}'::jsonb end));
  return v_new;
end;
$fn$;
revoke all on function public.update_facility_patient(uuid,timestamptz,text,text,text,date,text,text,text,boolean,text,text) from public,anon,service_role;
grant execute on function public.update_facility_patient(uuid,timestamptz,text,text,text,date,text,text,text,boolean,text,text) to authenticated;
