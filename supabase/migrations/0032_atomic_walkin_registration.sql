-- ============================================================================
-- TB-Screen — 0032_atomic_walkin_registration.sql
--
-- BASE-03: the facility walk-in screen used three independent PostgREST
-- writes. A failure after the patient or screening insert left a partial
-- registration behind, and a retry minted a second set of ids. This migration
-- replaces that client path with one transaction and binds retries to the
-- caller, facility and complete normalized payload.
--
-- The RPC deliberately computes the display code, age, composed name,
-- referral decision, facility and referral status on the server. Those values
-- describe one registration and must not be independently asserted by a
-- browser. It does not diagnose TB: `referred` is the same transparent
-- checklist rule used by the existing web and mobile clients.
-- ============================================================================

do $guard$
begin
  if to_regclass('public.rpc_requests') is null
     or to_regprocedure('app_private.tbdots_caller()') is null
     or to_regprocedure('app_private.payload_fingerprint(jsonb)') is null
     or to_regprocedure('app_private.replayed_result(text,uuid,uuid,uuid,text)') is null then
    raise exception '0032 requires migration 0031 (case registry idempotency internals)';
  end if;
end;
$guard$;

create or replace function public.register_walkin(
  p_request_id        uuid,
  p_patient_id        uuid,
  p_screening_id      uuid,
  p_referral_id       uuid,
  p_first_name        text,
  p_middle_name       text,
  p_last_name         text,
  p_birthdate         date,
  p_sex               text,
  p_barangay_code     text,
  p_sitio             text,
  p_sms_consent       boolean,
  p_contact_number    text,
  p_preferred_language text,
  p_symptom_flags     jsonb,
  p_pgis_severity     text,
  p_height_cm         numeric,
  p_weight_kg         numeric,
  p_temperature_c     numeric,
  p_systolic_bp       integer,
  p_diastolic_bp      integer,
  p_pulse_rate        integer,
  p_spo2_percent      integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_caller      record;
  v_first       text := nullif(btrim(p_first_name), '');
  v_middle      text := nullif(btrim(p_middle_name), '');
  v_last        text := nullif(btrim(p_last_name), '');
  v_sitio       text := nullif(btrim(p_sitio), '');
  v_contact     text := nullif(btrim(p_contact_number), '');
  v_language    text := nullif(btrim(p_preferred_language), '');
  v_full_name   text;
  v_display     text;
  v_age         integer;
  v_referred    boolean;
  v_fingerprint text;
  v_replayed    uuid;
  v_result      jsonb;
  v_key_count   integer;
begin
  select * into v_caller from app_private.tbdots_caller();

  if p_request_id is null or p_patient_id is null or p_screening_id is null
     or p_referral_id is null then
    raise exception 'registration and row ids are required' using errcode = '22023';
  end if;

  if v_first is null or v_last is null then
    raise exception 'first and last name are required' using errcode = '22023';
  end if;
  v_full_name := concat_ws(' ', v_first, v_middle, v_last);

  if p_birthdate is null or p_birthdate > public.manila_today() then
    raise exception 'birthdate must be on or before today' using errcode = '22023';
  end if;
  v_age := extract(year from age(public.manila_today(), p_birthdate))::integer;
  if v_age < 0 or v_age >= 130 then
    raise exception 'birthdate is outside the supported range' using errcode = '22023';
  end if;

  if p_sex is null or p_sex not in ('male', 'female') then
    raise exception 'sex must be male or female' using errcode = '22023';
  end if;
  if p_barangay_code is null then
    raise exception 'barangay is required' using errcode = '22023';
  end if;
  if p_sms_consent is null then
    raise exception 'SMS consent choice is required' using errcode = '22023';
  end if;
  if p_sms_consent and (v_contact is null or v_contact !~ '^09[0-9]{9}$'
                        or v_language not in ('en', 'tl', 'ceb')) then
    raise exception 'SMS consent requires a valid mobile number and language'
      using errcode = '22023';
  end if;
  if not p_sms_consent and (v_contact is not null or v_language is not null) then
    raise exception 'SMS details require consent' using errcode = '22023';
  end if;

  if p_symptom_flags is null or jsonb_typeof(p_symptom_flags) <> 'object' then
    raise exception 'symptom_flags must be a complete object' using errcode = '22023';
  end if;
  select count(*) into v_key_count from jsonb_object_keys(p_symptom_flags);
  if v_key_count <> 9
     or exists (
       select 1 from jsonb_object_keys(p_symptom_flags) k
        where k not in ('cough_2wks','weight_loss','night_sweats','fever',
                        'hemoptysis','chest_pain','fatigue','loss_of_appetite','tb_contact')
     )
     or exists (
       select 1 from jsonb_each_text(p_symptom_flags) e
        where e.value not in ('yes','no','unsure')
     ) then
    raise exception 'symptom_flags must contain exactly the nine checklist answers'
      using errcode = '22023';
  end if;
  if p_pgis_severity is null
     or p_pgis_severity not in ('none','mild','moderate','severe') then
    raise exception 'PGI-S severity is required' using errcode = '22023';
  end if;

  -- Same rule as screeningRules.ts: any cardinal symptom, or TB contact plus
  -- any symptom. Only an explicit "yes" counts; PGI-S and vitals never do.
  v_referred := coalesce((p_symptom_flags->>'cough_2wks') = 'yes', false)
             or coalesce((p_symptom_flags->>'weight_loss') = 'yes', false)
             or coalesce((p_symptom_flags->>'night_sweats') = 'yes', false)
             or coalesce((p_symptom_flags->>'fever') = 'yes', false)
             or coalesce((p_symptom_flags->>'hemoptysis') = 'yes', false)
             or (
               coalesce((p_symptom_flags->>'tb_contact') = 'yes', false)
               and (
                 coalesce((p_symptom_flags->>'cough_2wks') = 'yes', false)
                 or coalesce((p_symptom_flags->>'weight_loss') = 'yes', false)
                 or coalesce((p_symptom_flags->>'night_sweats') = 'yes', false)
                 or coalesce((p_symptom_flags->>'fever') = 'yes', false)
                 or coalesce((p_symptom_flags->>'hemoptysis') = 'yes', false)
                 or coalesce((p_symptom_flags->>'chest_pain') = 'yes', false)
                 or coalesce((p_symptom_flags->>'fatigue') = 'yes', false)
                 or coalesce((p_symptom_flags->>'loss_of_appetite') = 'yes', false)
               )
             );

  v_fingerprint := app_private.payload_fingerprint(jsonb_build_object(
    'patient_id', p_patient_id, 'screening_id', p_screening_id,
    'referral_id', p_referral_id, 'first_name', v_first,
    'middle_name', v_middle, 'last_name', v_last, 'birthdate', p_birthdate,
    'sex', p_sex, 'barangay_code', p_barangay_code, 'sitio', v_sitio,
    'sms_consent', p_sms_consent,
    'contact_number', case when p_sms_consent then v_contact else null end,
    'preferred_language', case when p_sms_consent then v_language else null end,
    'symptom_flags', p_symptom_flags, 'pgis_severity', p_pgis_severity,
    'height_cm', p_height_cm, 'weight_kg', p_weight_kg,
    'temperature_c', p_temperature_c, 'systolic_bp', p_systolic_bp,
    'diastolic_bp', p_diastolic_bp, 'pulse_rate', p_pulse_rate,
    'spo2_percent', p_spo2_percent
  ));

  -- Two simultaneous first attempts must not both pass the replay lookup.
  perform pg_advisory_xact_lock(hashtextextended('register_walkin:' || p_request_id::text, 0));
  v_replayed := app_private.replayed_result(
    'register_walkin', p_request_id, v_caller.caller_user_id,
    v_caller.caller_facility_id, v_fingerprint);

  if v_replayed is not null then
    select jsonb_build_object(
      'patient_id', p.patient_id, 'screening_id', s.screening_id,
      'referral_id', r.referral_id, 'display_code', p.display_code,
      'full_name', p.full_name, 'referred', s.referred)
      into v_result
      from public.patients p
      join public.screenings s
        on s.screening_id = p_screening_id and s.patient_id = p.patient_id
      join public.referrals r
        on r.referral_id = p_referral_id and r.patient_id = p.patient_id
       and r.screening_id = s.screening_id
     where p.patient_id = v_replayed
       and p.patient_id = p_patient_id
       and p.enrolled_by = v_caller.caller_user_id
       and r.facility_id = v_caller.caller_facility_id;
    if v_result is null then
      perform app_private.deny();
    end if;
    return v_result;
  end if;

  v_display := public.next_facility_patient_code();

  insert into public.patients (
    patient_id, display_code, enrolled_by, full_name, first_name, middle_name,
    last_name, birthdate, age, sex, barangay_code, sitio, contact_number,
    sms_consent, consent_date, preferred_language
  ) values (
    p_patient_id, v_display, v_caller.caller_user_id, v_full_name, v_first,
    v_middle, v_last, p_birthdate, v_age, p_sex, p_barangay_code, v_sitio,
    case when p_sms_consent then v_contact else null end, p_sms_consent,
    case when p_sms_consent then now() else null end,
    case when p_sms_consent then v_language else null end
  );

  insert into public.screenings (
    screening_id, patient_id, symptom_flags, pgis_severity, referred,
    height_cm, weight_kg, temperature_c, systolic_bp, diastolic_bp,
    pulse_rate, spo2_percent
  ) values (
    p_screening_id, p_patient_id, p_symptom_flags, p_pgis_severity, v_referred,
    p_height_cm, p_weight_kg, p_temperature_c, p_systolic_bp, p_diastolic_bp,
    p_pulse_rate, p_spo2_percent
  );

  insert into public.referrals (
    referral_id, patient_id, screening_id, facility_id, status
  ) values (
    p_referral_id, p_patient_id, p_screening_id,
    v_caller.caller_facility_id, 'received'
  );

  insert into public.rpc_requests (
    operation, request_id, actor_user_id, facility_id,
    payload_fingerprint, result_kind, result_id
  ) values (
    'register_walkin', p_request_id, v_caller.caller_user_id,
    v_caller.caller_facility_id, v_fingerprint, 'patient', p_patient_id
  );

  return jsonb_build_object(
    'patient_id', p_patient_id, 'screening_id', p_screening_id,
    'referral_id', p_referral_id, 'display_code', v_display,
    'full_name', v_full_name, 'referred', v_referred);
end;
$fn$;

comment on function public.register_walkin(
  uuid,uuid,uuid,uuid,text,text,text,date,text,text,text,boolean,text,text,
  jsonb,text,numeric,numeric,numeric,integer,integer,integer,integer
) is
  'Atomically registers a TB-DOTS walk-in as patient, screening and received '
  'referral. Idempotent for seven days by request id + actor + facility + payload.';

revoke all on function public.register_walkin(
  uuid,uuid,uuid,uuid,text,text,text,date,text,text,text,boolean,text,text,
  jsonb,text,numeric,numeric,numeric,integer,integer,integer,integer
) from public, anon, service_role;
grant execute on function public.register_walkin(
  uuid,uuid,uuid,uuid,text,text,text,date,text,text,text,boolean,text,text,
  jsonb,text,numeric,numeric,numeric,integer,integer,integer,integer
) to authenticated;
