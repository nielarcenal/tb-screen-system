-- TB-Screen — shared patient identity and barangay report v2
--
-- Patient demographics are province-wide identity data, while clinical episodes
-- remain scoped through referrals/cases. Exact-name + birthdate lookup avoids a
-- browseable patient directory and lets a receiving facility reuse one identity.

do $guard$
begin
  if to_regprocedure('public.current_user_active_role()') is null
     or to_regprocedure('public.manila_day_start(date)') is null
     or to_regprocedure('app_private.tbdots_caller()') is null
     or to_regprocedure('app_private.payload_fingerprint(jsonb)') is null
     or to_regprocedure('app_private.replayed_result(text,uuid,uuid,uuid,text)') is null then
    raise exception '0039 requires migrations 0028, 0031 and 0032';
  end if;
end;
$guard$;

create or replace function public.search_patient_registry(
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_birthdate date,
  p_contact_number text
) returns table (
  patient_id uuid,
  display_code text,
  full_name text,
  first_name text,
  middle_name text,
  last_name text,
  birthdate date,
  barangay_code text,
  phone_last4 text,
  can_reuse boolean
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_role text := public.current_user_active_role();
  v_first text := regexp_replace(lower(btrim(coalesce(p_first_name, ''))), '\s+', ' ', 'g');
  v_middle text := regexp_replace(lower(btrim(coalesce(p_middle_name, ''))), '\s+', ' ', 'g');
  v_last text := regexp_replace(lower(btrim(coalesce(p_last_name, ''))), '\s+', ' ', 'g');
  v_phone text := regexp_replace(coalesce(p_contact_number, ''), '[^0-9]', '', 'g');
begin
  if v_role is null or v_role not in ('bhw', 'tb_dots') then
    raise exception 'patient registry lookup requires an active BHW or TB-DOTS account'
      using errcode = '42501';
  end if;
  if v_first = '' or v_last = '' or p_birthdate is null then
    raise exception 'first name, last name and birthdate are required'
      using errcode = '22023';
  end if;
  if v_phone <> '' and v_phone !~ '^09[0-9]{9}$' then
    raise exception 'phone number must be blank or a valid PH mobile number'
      using errcode = '22023';
  end if;

  return query
  select p.patient_id,
         p.display_code,
         p.full_name,
         p.first_name,
         p.middle_name,
         p.last_name,
         p.birthdate,
         p.barangay_code,
         case when p.contact_number is null then null else right(p.contact_number, 4) end,
         (v_role = 'tb_dots'
           or p.barangay_code = public.current_user_barangay()
           or p.enrolled_by = auth.uid())
  from public.patients p
  where regexp_replace(lower(btrim(coalesce(p.first_name, ''))), '\s+', ' ', 'g') = v_first
    and regexp_replace(lower(btrim(coalesce(p.middle_name, ''))), '\s+', ' ', 'g') = v_middle
    and regexp_replace(lower(btrim(coalesce(p.last_name, ''))), '\s+', ' ', 'g') = v_last
    and p.birthdate = p_birthdate
    and (v_phone = '' or regexp_replace(coalesce(p.contact_number, ''), '[^0-9]', '', 'g') = v_phone)
  order by p.created_at, p.patient_id
  limit 5;
end;
$fn$;

comment on function public.search_patient_registry(text,text,text,date,text) is
  'Exact demographic lookup into the shared Bukidnon patient identity registry. '
  'Returns at most five minimal matches; it does not enumerate clinical records.';

revoke all on function public.search_patient_registry(text,text,text,date,text)
  from public, anon, service_role;
grant execute on function public.search_patient_registry(text,text,text,date,text)
  to authenticated;

create or replace function public.register_existing_patient_walkin(
  p_request_id uuid,
  p_patient_id uuid,
  p_screening_id uuid,
  p_referral_id uuid,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_birthdate date,
  p_symptom_flags jsonb,
  p_pgis_severity text,
  p_height_cm numeric,
  p_weight_kg numeric,
  p_temperature_c numeric,
  p_systolic_bp integer,
  p_diastolic_bp integer,
  p_pulse_rate integer,
  p_spo2_percent integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_caller record;
  v_patient public.patients%rowtype;
  v_referred boolean;
  v_fingerprint text;
  v_replayed uuid;
  v_result jsonb;
  v_key_count integer;
  v_first text := regexp_replace(lower(btrim(coalesce(p_first_name, ''))), '\s+', ' ', 'g');
  v_middle text := regexp_replace(lower(btrim(coalesce(p_middle_name, ''))), '\s+', ' ', 'g');
  v_last text := regexp_replace(lower(btrim(coalesce(p_last_name, ''))), '\s+', ' ', 'g');
begin
  select * into v_caller from app_private.tbdots_caller();
  if p_request_id is null or p_patient_id is null or p_screening_id is null
     or p_referral_id is null then
    raise exception 'registration and row ids are required' using errcode = '22023';
  end if;

  select * into v_patient from public.patients where patient_id = p_patient_id;
  if not found
     or regexp_replace(lower(btrim(coalesce(v_patient.first_name, ''))), '\s+', ' ', 'g') <> v_first
     or regexp_replace(lower(btrim(coalesce(v_patient.middle_name, ''))), '\s+', ' ', 'g') <> v_middle
     or regexp_replace(lower(btrim(coalesce(v_patient.last_name, ''))), '\s+', ' ', 'g') <> v_last
     or v_patient.birthdate is distinct from p_birthdate then
    raise exception 'selected patient no longer matches the searched identity'
      using errcode = '22023';
  end if;

  if p_symptom_flags is null or jsonb_typeof(p_symptom_flags) <> 'object' then
    raise exception 'symptom_flags must be a complete object' using errcode = '22023';
  end if;
  select count(*) into v_key_count from jsonb_object_keys(p_symptom_flags);
  if v_key_count <> 9
     or exists (select 1 from jsonb_object_keys(p_symptom_flags) k
                where k not in ('cough_2wks','weight_loss','night_sweats','fever',
                                'hemoptysis','chest_pain','fatigue','loss_of_appetite','tb_contact'))
     or exists (select 1 from jsonb_each_text(p_symptom_flags) e
                where e.value not in ('yes','no','unsure')) then
    raise exception 'symptom_flags must contain exactly the nine checklist answers'
      using errcode = '22023';
  end if;
  if p_pgis_severity is null or p_pgis_severity not in ('none','mild','moderate','severe') then
    raise exception 'PGI-S severity is required' using errcode = '22023';
  end if;

  v_referred := coalesce((p_symptom_flags->>'cough_2wks') = 'yes', false)
             or coalesce((p_symptom_flags->>'weight_loss') = 'yes', false)
             or coalesce((p_symptom_flags->>'night_sweats') = 'yes', false)
             or coalesce((p_symptom_flags->>'fever') = 'yes', false)
             or coalesce((p_symptom_flags->>'hemoptysis') = 'yes', false)
             or (coalesce((p_symptom_flags->>'tb_contact') = 'yes', false)
                 and exists (select 1 from jsonb_each_text(p_symptom_flags) e
                             where e.key <> 'tb_contact' and e.value = 'yes'));

  v_fingerprint := app_private.payload_fingerprint(jsonb_build_object(
    'patient_id', p_patient_id, 'screening_id', p_screening_id,
    'referral_id', p_referral_id, 'symptom_flags', p_symptom_flags,
    'pgis_severity', p_pgis_severity, 'height_cm', p_height_cm,
    'weight_kg', p_weight_kg, 'temperature_c', p_temperature_c,
    'systolic_bp', p_systolic_bp, 'diastolic_bp', p_diastolic_bp,
    'pulse_rate', p_pulse_rate, 'spo2_percent', p_spo2_percent));

  perform pg_advisory_xact_lock(hashtextextended('register_walkin:' || p_request_id::text, 0));
  v_replayed := app_private.replayed_result(
    'register_walkin', p_request_id, v_caller.caller_user_id,
    v_caller.caller_facility_id, v_fingerprint);
  if v_replayed is not null then
    select jsonb_build_object(
      'patient_id', p.patient_id, 'screening_id', s.screening_id,
      'referral_id', r.referral_id, 'display_code', p.display_code,
      'full_name', p.full_name, 'referred', s.referred, 'existing_patient', true)
    into v_result
    from public.patients p
    join public.screenings s on s.screening_id = p_screening_id and s.patient_id = p.patient_id
    join public.referrals r on r.referral_id = p_referral_id and r.patient_id = p.patient_id
      and r.screening_id = s.screening_id and r.facility_id = v_caller.caller_facility_id
    where p.patient_id = v_replayed and p.patient_id = p_patient_id;
    if v_result is null then perform app_private.deny(); end if;
    return v_result;
  end if;

  insert into public.screenings (
    screening_id, patient_id, symptom_flags, pgis_severity, referred,
    height_cm, weight_kg, temperature_c, systolic_bp, diastolic_bp,
    pulse_rate, spo2_percent
  ) values (
    p_screening_id, p_patient_id, p_symptom_flags, p_pgis_severity, v_referred,
    p_height_cm, p_weight_kg, p_temperature_c, p_systolic_bp, p_diastolic_bp,
    p_pulse_rate, p_spo2_percent);

  insert into public.referrals (
    referral_id, patient_id, screening_id, facility_id, status
  ) values (
    p_referral_id, p_patient_id, p_screening_id,
    v_caller.caller_facility_id, 'received');

  insert into public.rpc_requests (
    operation, request_id, actor_user_id, facility_id,
    payload_fingerprint, result_kind, result_id
  ) values (
    'register_walkin', p_request_id, v_caller.caller_user_id,
    v_caller.caller_facility_id, v_fingerprint, 'patient', p_patient_id);

  return jsonb_build_object(
    'patient_id', p_patient_id, 'screening_id', p_screening_id,
    'referral_id', p_referral_id, 'display_code', v_patient.display_code,
    'full_name', v_patient.full_name, 'referred', v_referred,
    'existing_patient', true);
end;
$fn$;

revoke all on function public.register_existing_patient_walkin(
  uuid,uuid,uuid,uuid,text,text,text,date,jsonb,text,numeric,numeric,numeric,
  integer,integer,integer,integer) from public, anon, service_role;
grant execute on function public.register_existing_patient_walkin(
  uuid,uuid,uuid,uuid,text,text,text,date,jsonb,text,numeric,numeric,numeric,
  integer,integer,integer,integer) to authenticated;

comment on function public.register_existing_patient_walkin(
  uuid,uuid,uuid,uuid,text,text,text,date,jsonb,text,numeric,numeric,numeric,
  integer,integer,integer,integer) is
  'Creates a facility screening and received referral for an exact-matched shared patient identity.';

create or replace function public.barangay_report_v2(from_date date, to_date date)
returns table (
  barangay_code text,
  barangay_name text,
  city_name text,
  screened_count bigint,
  referred_count bigint,
  case_count bigint,
  successful_outcome_count bigint,
  lost_to_follow_up_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_role text := public.current_user_active_role();
begin
  if v_role is null or v_role not in ('tb_dots', 'admin') then
    raise exception 'barangay_report_v2: TB-DOTS or admin role required'
      using errcode = '42501';
  end if;
  if from_date is null or to_date is null or from_date > to_date then
    raise exception 'a valid report period is required' using errcode = '22023';
  end if;

  return query
  with base as (
    select distinct p.barangay_code, b.name bname, c.name cname
    from public.patients p
    join public.ref_barangays b on b.barangay_code = p.barangay_code
    join public.ref_cities c on c.city_code = b.city_code
  ), scr as (
    select p.barangay_code,
           count(distinct s.patient_id) as screened,
           count(distinct s.patient_id) filter (where s.referred) as referred
    from public.screenings s
    join public.patients p on p.patient_id = s.patient_id
    where s.created_at >= public.manila_day_start(from_date)
      and s.created_at < public.manila_day_start(to_date + 1)
    group by p.barangay_code
  ), cas as (
    select p.barangay_code,
           count(distinct c.case_id) filter (
             where c.registration_date between from_date and to_date) as cases,
           count(distinct c.case_id) filter (
             where c.outcome in ('cured','treatment_completed')
               and c.outcome_date between from_date and to_date) as successful,
           count(distinct c.case_id) filter (
             where c.outcome = 'lost_to_follow_up'
               and c.outcome_date between from_date and to_date) as ltfu
    from public.tb_cases c
    join public.patients p on p.patient_id = c.patient_id
    group by p.barangay_code
  )
  select base.barangay_code, base.bname, base.cname,
         coalesce(scr.screened, 0)::bigint,
         coalesce(scr.referred, 0)::bigint,
         coalesce(cas.cases, 0)::bigint,
         coalesce(cas.successful, 0)::bigint,
         coalesce(cas.ltfu, 0)::bigint
  from base
  left join scr on scr.barangay_code = base.barangay_code
  left join cas on cas.barangay_code = base.barangay_code
  order by coalesce(scr.referred, 0) desc, base.bname;
end;
$fn$;

revoke all on function public.barangay_report_v2(date,date)
  from public, anon, service_role;
grant execute on function public.barangay_report_v2(date,date) to authenticated;

comment on function public.barangay_report_v2(date,date) is
  'Province-wide per-barangay screening, referral, registered case and recorded treatment outcome counts. '
  'Counts only; no patient-level rows. Manila period boundaries are explicit.';
