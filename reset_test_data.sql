-- ============================================================================
-- TB-Screen BHW — reset_test_data.sql
--
-- Wipes ALL patient-derived test data and seeds 5 valid patient records that
-- exercise every path in the system. Run in the Supabase SQL Editor (it runs as
-- postgres and bypasses RLS — there are deliberately no DELETE policies, so no
-- client key can do this).
--
-- WHAT IT DELETES: sms_log, appointments, referrals, screenings, patients —
-- in foreign-key order. Everything, not just rows matching a prefix.
-- WHAT IT KEEPS: users (your accounts), facilities, and all ref_* PSGC data.
--
-- Run this AFTER migration 0010_patient_name_parts.sql.
--
-- POSITIONING (§5): every `referred` value below is the DOH-NTP checklist
-- outcome for that row's symptom_flags — matching evaluateReferral() in
-- mobile/src/domain/screeningRules.ts exactly (any cardinal symptom yes, OR
-- tb_contact yes plus any other symptom yes). No score is stored anywhere.
-- PRIVACY (§4): contact_number + consent_date appear ONLY where sms_consent is
-- true, satisfying the patients_sms_consent_gate CHECK.
-- ============================================================================

begin;

-- --- 1. Wipe, in FK order -------------------------------------------------
delete from public.sms_log;
delete from public.appointments;
delete from public.referrals;
delete from public.screenings;
delete from public.patients;

-- --- 2. Seed 5 valid patients ---------------------------------------------
do $$
declare
  v_bhw       uuid;
  v_dots      uuid;
  v_brgy_home text;
begin
  -- The enrolling BHW: the test account you sign in with on the phone.
  select u.user_id into strict v_bhw
  from public.users u
  join auth.users a on a.id = u.user_id
  where a.email = 'bhw@test.local';

  -- Falls back to Casisang if the account has no assigned barangay, so the
  -- NOT NULL barangay_code can never fail here.
  v_brgy_home := coalesce(
    (select assigned_barangay_code from public.users where user_id = v_bhw),
    '101312012'
  );

  -- Receiving facility for referrals.
  select facility_id into strict v_dots
  from public.facilities
  where name = 'Malaybalay City Health DOTS Center';

  -- Age is derived from birthdate here so it can never drift out of sync with
  -- the birthdate the way a hardcoded integer would.
  insert into public.patients
    (patient_id, display_code, enrolled_by, first_name, middle_name, last_name,
     full_name, birthdate, age, sex, barangay_code, sitio,
     contact_number, sms_consent, consent_date)
  values
    ('5eed0000-0000-0000-0000-000000000001', 'PAT-SEED-0001', v_bhw,
     'Maria', 'Liwayway', 'Bactong', 'Maria Liwayway Bactong',
     date '1989-03-14', extract(year from age(date '1989-03-14'))::int,
     'female', v_brgy_home, 'Purok 3',
     '09171234567', true, now()),

    ('5eed0000-0000-0000-0000-000000000002', 'PAT-SEED-0002', v_bhw,
     'Jose', 'Rizaldy', 'Mangubat', 'Jose Rizaldy Mangubat',
     date '1972-11-02', extract(year from age(date '1972-11-02'))::int,
     'male', v_brgy_home, 'Purok 1',
     null, false, null),

    -- No middle name — the field is optional in the app.
    ('5eed0000-0000-0000-0000-000000000003', 'PAT-SEED-0003', v_bhw,
     'Analyn', null, 'Dagondon', 'Analyn Dagondon',
     date '2001-06-25', extract(year from age(date '2001-06-25'))::int,
     'female', '101321021', null,
     '09209876543', true, now()),

    ('5eed0000-0000-0000-0000-000000000004', 'PAT-SEED-0004', v_bhw,
     'Rodel', 'Sumaylo', 'Bagontapay', 'Rodel Sumaylo Bagontapay',
     date '1995-01-19', extract(year from age(date '1995-01-19'))::int,
     'male', '101321001', 'Sitio Bagong Silang',
     null, false, null),

    ('5eed0000-0000-0000-0000-000000000005', 'PAT-SEED-0005', v_bhw,
     'Cristina', 'Awa', 'Malinao', 'Cristina Awa Malinao',
     date '1958-08-07', extract(year from age(date '1958-08-07'))::int,
     'female', '101301001', null,
     '09331112222', true, now());

  -- --- 3. Screenings: both referral rules + the not-flagged path -----------
  insert into public.screenings
    (screening_id, patient_id, symptom_flags, pgis_severity, referred)
  values
    -- Cardinal symptom (cough >= 2 weeks) -> flagged.
    ('5eed0000-0000-0000-0001-000000000001', '5eed0000-0000-0000-0000-000000000001',
     '{"cough_2wks":"yes","fever":"no","night_sweats":"no","weight_loss":"unsure",
       "hemoptysis":"no","chest_pain":"yes","fatigue":"yes","loss_of_appetite":"no",
       "tb_contact":"no"}'::jsonb,
     'moderate', true),

    -- Two cardinal symptoms (fever + night sweats) -> flagged.
    ('5eed0000-0000-0000-0001-000000000002', '5eed0000-0000-0000-0000-000000000002',
     '{"cough_2wks":"no","fever":"yes","night_sweats":"yes","weight_loss":"yes",
       "hemoptysis":"no","chest_pain":"no","fatigue":"yes","loss_of_appetite":"yes",
       "tb_contact":"unsure"}'::jsonb,
     'severe', true),

    -- Non-cardinal symptoms only, no contact -> NOT flagged.
    ('5eed0000-0000-0000-0001-000000000003', '5eed0000-0000-0000-0000-000000000003',
     '{"cough_2wks":"no","fever":"no","night_sweats":"no","weight_loss":"no",
       "hemoptysis":"no","chest_pain":"yes","fatigue":"yes","loss_of_appetite":"no",
       "tb_contact":"no"}'::jsonb,
     'mild', false),

    -- Rule 2: TB contact + another symptom -> flagged (no cardinal symptom).
    ('5eed0000-0000-0000-0001-000000000004', '5eed0000-0000-0000-0000-000000000004',
     '{"cough_2wks":"no","fever":"no","night_sweats":"no","weight_loss":"no",
       "hemoptysis":"no","chest_pain":"no","fatigue":"yes","loss_of_appetite":"yes",
       "tb_contact":"yes"}'::jsonb,
     'mild', true),

    -- Nothing reported -> NOT flagged. 'unsure' never counts as yes.
    ('5eed0000-0000-0000-0001-000000000005', '5eed0000-0000-0000-0000-000000000005',
     '{"cough_2wks":"unsure","fever":"no","night_sweats":"no","weight_loss":"no",
       "hemoptysis":"no","chest_pain":"no","fatigue":"no","loss_of_appetite":"no",
       "tb_contact":"no"}'::jsonb,
     'none', false);

  -- --- 4. Referrals for the 3 flagged screenings, at different stages ------
  -- result / result_outcome are recorded BY FACILITY STAFF, never computed (§1).
  insert into public.referrals
    (referral_id, patient_id, screening_id, facility_id, specimen_id,
     status, result, result_date, result_outcome, presented)
  values
    ('5eed0000-0000-0000-0002-000000000001', '5eed0000-0000-0000-0000-000000000001',
     '5eed0000-0000-0000-0001-000000000001', v_dots, null,
     'submitted', null, null, null, null),

    ('5eed0000-0000-0000-0002-000000000002', '5eed0000-0000-0000-0000-000000000002',
     '5eed0000-0000-0000-0001-000000000002', v_dots, 'SPEC-2026-0002',
     'received', null, null, null, true),

    ('5eed0000-0000-0000-0002-000000000003', '5eed0000-0000-0000-0000-000000000004',
     '5eed0000-0000-0000-0001-000000000004', v_dots, 'SPEC-2026-0004',
     'tested', 'Xpert MTB/RIF: MTB not detected.', now(), 'negative', true);

  -- --- 5. Appointments: one upcoming, one attended, one missed ------------
  insert into public.appointments
    (appointment_id, patient_id, scheduled_date, attended_date, status)
  values
    ('5eed0000-0000-0000-0003-000000000001', '5eed0000-0000-0000-0000-000000000001',
     current_date + 7, null, 'scheduled'),
    ('5eed0000-0000-0000-0003-000000000002', '5eed0000-0000-0000-0000-000000000002',
     current_date - 3, current_date - 3, 'attended'),
    ('5eed0000-0000-0000-0003-000000000003', '5eed0000-0000-0000-0000-000000000004',
     current_date - 10, null, 'missed');
end $$;

commit;

-- --- Verify ---------------------------------------------------------------
select p.display_code, p.first_name, p.middle_name, p.last_name, p.full_name,
       p.age, p.sex, b.name as barangay, p.sms_consent, p.contact_number,
       s.referred, r.status as referral_status
from public.patients p
join public.ref_barangays b on b.barangay_code = p.barangay_code
left join public.screenings s on s.patient_id = p.patient_id
left join public.referrals  r on r.screening_id = s.screening_id
order by p.display_code;
