-- ============================================================================
-- TB-Screen BHW — seed_demo_valencia.sql
-- DEMO DATA for the Barangay Report (0027). Not a migration: run it by hand.
--
-- WHAT IT MAKES. A plausible three-year screening history across all 31
-- Valencia City barangays, shaped so the per-barangay RANKING matches the City
-- Health Office's own 2024-2025 sheet — Poblacion far ahead, Lilingayon's 2025
-- spike, Bagontaas falling year on year. An adviser can hold the signed sheet
-- next to the portal and recognise it. 2026 is a PARTIAL year (~55% of 2025),
-- so the report's default view (current year) is populated rather than empty.
--
-- THE NUMBERS ARE NOT THE HEALTH OFFICE'S CASE COUNTS. The CHO figures are used
-- as the count of REFERRALS this system would have generated, not as confirmed
-- cases — the system does not see the city's whole caseload (0027's header).
-- Positives are a fraction of those. Nothing here should be quoted as a real
-- Valencia case count; it is demonstration data that borrows a real shape.
--
-- ---------------------------------------------------------------------------
-- SAFETY: THESE PATIENTS CANNOT BE TEXTED. Every demo patient is written with
-- sms_consent = false, which patients_sms_consent_gate (0001) forces to mean
-- contact_number IS NULL. Both queries in the sms-reminders function filter on
-- patients.sms_consent = true, so the daily 09:00 cron can never select one.
-- Belt and braces: no demo appointment is left in status 'scheduled' — they are
-- all 'attended' or 'missed' — so even flipping consent by hand would not put
-- one in the reminder window. DO NOT give these rows a contact number.
-- ---------------------------------------------------------------------------
--
-- IDEMPOTENT. Every row is tagged display_code LIKE 'PAT-DEMO-%'. Section 1
-- removes any previous run first, so this file can be run repeatedly, and the
-- same three DELETEs are how you remove the demo data for good. sms_log is
-- deleted before appointments because sms_log_appointment_id_fkey has no
-- ON DELETE CASCADE (there should never be such a row, but the order is free).
--
-- Enrolled by 'Ray Arcenal' (6a5797a4…), a BHW already assigned to a Valencia
-- barangay — deliberately NOT bhw.arcenal (5438428b…), which is the account
-- signed in on the demo handset: the mobile app syncs the patients its own
-- account enrolled, and ~1,900 of them would ruin that demo.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Remove any previous run (and: this is the uninstall).
-- ---------------------------------------------------------------------------
delete from public.sms_log
 where appointment_id in (
   select a.appointment_id from public.appointments a
     join public.patients p on p.patient_id = a.patient_id
    where p.display_code like 'PAT-DEMO-%');

delete from public.appointments
 where patient_id in (select patient_id from public.patients where display_code like 'PAT-DEMO-%');

delete from public.referrals
 where patient_id in (select patient_id from public.patients where display_code like 'PAT-DEMO-%');

delete from public.screenings
 where patient_id in (select patient_id from public.patients where display_code like 'PAT-DEMO-%');

delete from public.patients where display_code like 'PAT-DEMO-%';

-- ---------------------------------------------------------------------------
-- 2. The plan: one row per patient to create.
--
-- `n` is the CHO figure for that barangay-year and becomes the number of
-- REFERRED patients. A further 40% are screened and NOT referred, because a
-- report where every screening leads to a referral would misdescribe what
-- screening does.
-- ---------------------------------------------------------------------------
create temp table demo_plan on commit drop as
with cho(code, yr, n) as (values
  -- barangay_code, year, CHO figure   (2026 = round(2025 × 0.55), partial year)
  ('101321001',2024,48),('101321001',2025,30),('101321001',2026,17), -- Bagontaas
  ('101321002',2024,26),('101321002',2025, 7),('101321002',2026, 4), -- Banlag
  ('101321003',2024, 2),('101321003',2025, 5),('101321003',2026, 3), -- Barobo
  ('101321004',2024,27),('101321004',2025,36),('101321004',2026,20), -- Batangan
  ('101321005',2024, 5),('101321005',2025, 4),('101321005',2026, 2), -- Catumbalon
  ('101321006',2024,13),('101321006',2025, 8),('101321006',2026, 4), -- Colonia
  ('101321007',2024,10),('101321007',2025, 5),('101321007',2026, 3), -- Concepcion
  ('101321008',2024,16),('101321008',2025,15),('101321008',2026, 8), -- Dagat-Kidavao
  ('101321010',2024, 9),('101321010',2025,15),('101321010',2026, 8), -- Guinoyuran
  ('101321011',2024,16),('101321011',2025,19),('101321011',2026,10), -- Kahapunan
  ('101321012',2024, 8),('101321012',2025,20),('101321012',2026,11), -- Laligan
  ('101321013',2024, 6),('101321013',2025,71),('101321013',2026,39), -- Lilingayon
  ('101321014',2024, 3),('101321014',2025, 1),('101321014',2026, 1), -- Lourdes
  ('101321015',2024, 8),('101321015',2025,20),('101321015',2026,11), -- Lumbayao
  ('101321016',2024,24),('101321016',2025,45),('101321016',2026,25), -- Lumbo
  ('101321017',2024,11),('101321017',2025,14),('101321017',2026, 8), -- Lurogan
  ('101321018',2024, 3),('101321018',2025, 4),('101321018',2026, 2), -- Maapag
  ('101321019',2024,10),('101321019',2025, 5),('101321019',2026, 3), -- Mabuhay
  ('101321020',2024,12),('101321020',2025,16),('101321020',2026, 9), -- Mailag
  ('101321021',2024, 3),('101321021',2025, 3),('101321021',2026, 2), -- Mt. Nebo
  ('101321022',2024, 3),('101321022',2025, 5),('101321022',2026, 3), -- Nabago
  ('101321023',2024,17),('101321023',2025,26),('101321023',2026,14), -- Pinatilan
  ('101321024',2024,107),('101321024',2025,116),('101321024',2026,64), -- Poblacion
  ('101321025',2024, 8),('101321025',2025,11),('101321025',2026, 6), -- San Carlos
  ('101321026',2024, 8),('101321026',2025, 7),('101321026',2026, 4), -- San Isidro
  ('101321028',2024, 4),('101321028',2025, 5),('101321028',2026, 3), -- Sinabuagan
  ('101321029',2024,14),('101321029',2025,19),('101321029',2026,10), -- Sinayawan
  ('101321030',2024,18),('101321030',2025,15),('101321030',2026, 8), -- Sugod
  ('101321033',2024,24),('101321033',2025,21),('101321033',2026,12), -- Tongantongan
  ('101321034',2024, 3),('101321034',2025, 3),('101321034',2026, 2), -- Tugaya
  ('101321035',2024, 0),('101321035',2025, 1),('101321035',2026, 1)  -- Vintar
)
select
  c.code,
  c.yr,
  g.i,
  (g.i <= c.n) as is_referred,
  row_number() over (order by c.yr, c.code, g.i) as seq,
  -- Spread through the year deterministically (a stride coprime with the span),
  -- capped at today for the current year so nothing is dated in the future.
  (make_timestamptz(c.yr, 1, 1, 9, 0, 0, 'Asia/Manila')
     + (((g.i * 37) % case when c.yr = 2026 then greatest(extract(doy from now() at time zone 'Asia/Manila')::int - 1, 1)
                           else 364 end)) * interval '1 day') as ts
from cho c
cross join lateral generate_series(1, c.n + ceil(c.n * 0.4)::int) as g(i)
where c.n > 0;

-- ---------------------------------------------------------------------------
-- 3. Patients. sms_consent = false — see the SAFETY note in the header.
-- Names are obviously synthetic ON PURPOSE: a screenshot of this view must not
-- be mistakable for real patient records.
-- ---------------------------------------------------------------------------
insert into public.patients
  (display_code, enrolled_by, full_name, first_name, last_name, age, sex,
   birthdate, barangay_code, sms_consent, contact_number, consent_date,
   created_at, updated_at)
select
  'PAT-DEMO-' || lpad(p.seq::text, 5, '0'),
  '6a5797a4-33dd-42a8-a6c4-771e338750f2'::uuid,
  'Demo Patient ' || lpad(p.seq::text, 5, '0'),
  'Demo',
  'Patient ' || lpad(p.seq::text, 5, '0'),
  18 + (p.seq * 7) % 62,
  case when p.seq % 2 = 0 then 'male' else 'female' end,
  (date '1975-01-01' + ((p.seq * 97) % 16000) * interval '1 day')::date,
  p.code,
  false, null, null,
  p.ts, p.ts
from demo_plan p;

-- ---------------------------------------------------------------------------
-- 4. Screenings. `referred` comes from the plan, standing in for the DOH-NTP
-- checklist outcome (§5) — there is no score here or anywhere else.
-- ---------------------------------------------------------------------------
insert into public.screenings
  (patient_id, symptom_flags, pgis_severity, referred, created_at, updated_at)
select
  pt.patient_id,
  case when p.is_referred
    then jsonb_build_object(
      'cough_2wks','yes','fever', case when p.seq % 3 = 0 then 'yes' else 'no' end,
      'night_sweats', case when p.seq % 4 = 0 then 'yes' else 'no' end,
      'weight_loss', case when p.seq % 5 = 0 then 'yes' else 'no' end,
      'hemoptysis', case when p.seq % 11 = 0 then 'yes' else 'no' end,
      'tb_contact', case when p.seq % 7 = 0 then 'yes' else 'no' end)
    else jsonb_build_object(
      'cough_2wks','no','fever','no','night_sweats','no','weight_loss','no',
      'hemoptysis','no','tb_contact','no')
  end,
  (array['none','mild','moderate','severe'])[1 + (p.seq % 4)],
  p.is_referred,
  p.ts, p.ts
from demo_plan p
join public.patients pt on pt.display_code = 'PAT-DEMO-' || lpad(p.seq::text, 5, '0');

-- ---------------------------------------------------------------------------
-- 5. Referrals — to Valencia City Health DOTS Center (d3), which is what
-- ref_cities.default_facility_id already maps Valencia to. Deliberately NOT d2:
-- the facility.arcenal test account sits at d2 and its inbox must stay usable.
-- ---------------------------------------------------------------------------
insert into public.referrals
  (patient_id, screening_id, facility_id, status, presented, result_outcome,
   result_date, created_at, updated_at)
select
  pt.patient_id,
  s.screening_id,
  '00000000-0000-0000-0000-0000000000d3'::uuid,
  case when p.seq % 100 < 10 then 'submitted'
       when p.seq % 100 < 18 then 'received'
       when p.seq % 100 < 88 then 'tested'
       else 'closed' end,
  case when p.seq % 100 < 10 then null            -- not arrived yet
       when p.seq % 17 = 0   then false           -- no-show
       else true end,
  case when p.seq % 100 < 18 then null            -- untested: no outcome
       when p.seq % 5 < 2    then 'positive'
       else 'negative' end,
  case when p.seq % 100 < 18 then null else p.ts + interval '5 days' end,
  p.ts + interval '2 days',
  p.ts + interval '2 days'
from demo_plan p
join public.patients   pt on pt.display_code = 'PAT-DEMO-' || lpad(p.seq::text, 5, '0')
join public.screenings s  on s.patient_id = pt.patient_id
where p.is_referred;

-- ---------------------------------------------------------------------------
-- 6. Check-ups. NOTHING is left 'scheduled' — see the SAFETY note. `missed`
-- rows are what the report's missed-check-up column counts.
-- ---------------------------------------------------------------------------
insert into public.appointments
  (patient_id, scheduled_date, attended_date, status, created_at, updated_at)
select
  pt.patient_id,
  (p.ts + interval '12 days')::date,
  case when p.seq % 9 = 0 then null else (p.ts + interval '12 days')::date end,
  case when p.seq % 9 = 0 then 'missed' else 'attended' end,
  p.ts + interval '5 days',
  p.ts + interval '12 days'
from demo_plan p
join public.patients pt on pt.display_code = 'PAT-DEMO-' || lpad(p.seq::text, 5, '0')
where p.is_referred and p.seq % 100 >= 18;   -- only those who reached testing

commit;

-- ---------------------------------------------------------------------------
-- Verify (run separately). Expect referred_2024 = 466 and referred_2025 = 572,
-- and expect zero demo patients able to receive an SMS.
-- ---------------------------------------------------------------------------
-- select extract(year from s.created_at at time zone 'Asia/Manila') as yr,
--        count(*) filter (where s.referred) as referred,
--        count(*) as screened
--   from public.screenings s
--   join public.patients p on p.patient_id = s.patient_id
--  where p.display_code like 'PAT-DEMO-%'
--  group by 1 order by 1;
--
-- select count(*) as demo_patients_with_sms_consent
--   from public.patients
--  where display_code like 'PAT-DEMO-%' and sms_consent;   -- must be 0
--
-- select count(*) as demo_appts_still_scheduled
--   from public.appointments a join public.patients p using (patient_id)
--  where p.display_code like 'PAT-DEMO-%' and a.status = 'scheduled';  -- must be 0
