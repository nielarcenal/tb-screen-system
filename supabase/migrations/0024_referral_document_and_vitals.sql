-- ============================================================================
-- TB-Screen — 0024_referral_document_and_vitals.sql
-- Referral-model correction + optional vital signs.
-- Confirmed with the TB-DOTS head nurse in Valencia City, 2026-09-06.
--
-- WHAT CHANGED IN THE WORLD, NOT JUST IN THE CODE. Sputum collection and
-- testing happen ONLY at the TB-DOTS facility, never at the barangay. A BHW's
-- role ends at symptom assessment and referral; nothing physical travels with
-- the patient. The build assumed the opposite — that a "specimen form" rode
-- along with a sputum sample the BHW had taken — and that assumption is what
-- this migration retires.
--
-- Two consequences, both here:
--
--   1. referrals.specimen_id becomes referrals.lab_sample_id, and OWNERSHIP
--      moves. The BHW app used to generate SPC-<device>-<seq> at referral
--      creation, naming a sample that did not exist and never would. The real
--      sample id belongs to TB-DOTS and is entered by facility staff when they
--      physically collect sputum on-site — in practice while moving the
--      referral from 'submitted' to 'received'/'tested'.
--
--      The rename is deliberate rather than a re-scope in place: the column's
--      MEANING changed, and any reader still expecting the old one should fail
--      loudly (undefined column) instead of silently reading a field that is
--      now always NULL at the moment it used to be populated.
--
--   2. Optional vital signs land on `screenings`. Every column is nullable —
--      a BHW whose thermometer or oximeter is flat that day must still be able
--      to finish a screening. These are SUPPLEMENTARY CONTEXT, exactly like
--      pgis_severity: recorded, displayed, printed on the referral document so
--      the facility has them on arrival, and NEVER an input to the referral
--      decision. The DOH-NTP symptom checklist alone decides that (§5).
--
-- POSITIONING (§1, §5) unchanged and re-affirmed: there is still no score
-- column anywhere. BMI is deliberately NOT stored — it is computed at display
-- and print time from height + weight, the same way age is computed from
-- birthdate. A stored BMI would be a derived number sitting in the clinical
-- record looking like a finding; a computed one is arithmetic on two measured
-- values, which is what it actually is.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. referrals.specimen_id → referrals.lab_sample_id.
--
-- ALTER ... RENAME COLUMN carries indexes, policies and grants with it, and
-- nothing in the schema references this column by name (no index, no policy
-- predicate, no trigger argument — the immutable-columns trigger in 0020 pins
-- referral_id / patient_id / screening_id, not this one), so the rename is
-- self-contained. Existing values are preserved: the SPC-* ids already written
-- by the app stay put rather than being erased, because a row a facility has
-- already worked may have had that code handwritten on paper. They are simply
-- no longer generated.
-- ---------------------------------------------------------------------------
alter table public.referrals rename column specimen_id to lab_sample_id;

comment on column public.referrals.lab_sample_id is
  'Laboratory sample identifier, OWNED BY TB-DOTS. Entered by facility staff '
  'when they collect the sputum sample on-site (typically while marking the '
  'referral received/tested). The BHW app never generates this — sputum is '
  'collected only at the facility. Was specimen_id until 0024, when the '
  '"specimen travels with the patient" assumption was retired.';

comment on table public.referrals is
  'A screening sent to a receiving TB-DOTS facility. The optional printed '
  'REFERRAL DOCUMENT a patient may carry is informational only — the row here '
  'is the record of truth and reaches the facility portal on creation whether '
  'or not anything is ever printed.';

-- ---------------------------------------------------------------------------
-- 2. Vital signs on the screening record.
--
-- Types chosen to match what a BHW actually reads off a device:
--   * height_cm / weight_kg / temperature_c — numeric with one decimal place,
--     because 36.8 °C and 52.4 kg are ordinary readings and a float would make
--     them approximate for no reason.
--   * the four remaining are whole numbers on every instrument that produces
--     them, so they are integers.
--
-- The CHECK ranges are DATA-ENTRY GUARDS, not clinical thresholds. Each is set
-- wide enough to admit any real human reading (a newborn's 45 cm, a fever of
-- 42 °C) and to reject only transposed digits and slipped decimal points —
-- 1700 cm for 170, 3.68 °C for 36.8. They classify nothing. `not null` is
-- never used: a missing instrument must not block a screening.
-- ---------------------------------------------------------------------------
alter table public.screenings
  add column if not exists height_cm      numeric(5,1)
    check (height_cm is null or (height_cm >= 30 and height_cm <= 250)),
  add column if not exists weight_kg      numeric(5,1)
    check (weight_kg is null or (weight_kg >= 1 and weight_kg <= 400)),
  add column if not exists temperature_c  numeric(4,1)
    check (temperature_c is null or (temperature_c >= 30 and temperature_c <= 45)),
  add column if not exists systolic_bp    int
    check (systolic_bp is null or (systolic_bp >= 50 and systolic_bp <= 300)),
  add column if not exists diastolic_bp   int
    check (diastolic_bp is null or (diastolic_bp >= 20 and diastolic_bp <= 200)),
  add column if not exists pulse_rate     int
    check (pulse_rate is null or (pulse_rate >= 20 and pulse_rate <= 250)),
  add column if not exists spo2_percent   int
    check (spo2_percent is null or (spo2_percent >= 50 and spo2_percent <= 100));

comment on column public.screenings.height_cm is
  'Height in centimetres. Optional supplementary context (§5) — never feeds '
  'the referral decision. BMI is computed from this and weight_kg at display '
  'and print time; it is deliberately not stored.';
comment on column public.screenings.weight_kg is
  'Weight in kilograms. Optional supplementary context (§5).';
comment on column public.screenings.temperature_c is
  'Body temperature in degrees Celsius. Optional supplementary context (§5).';
comment on column public.screenings.systolic_bp is
  'Systolic blood pressure, mmHg. Optional supplementary context (§5).';
comment on column public.screenings.diastolic_bp is
  'Diastolic blood pressure, mmHg. Optional supplementary context (§5).';
comment on column public.screenings.pulse_rate is
  'Pulse rate, beats per minute. Optional supplementary context (§5).';
comment on column public.screenings.spo2_percent is
  'Peripheral oxygen saturation, percent. Optional supplementary context (§5).';

comment on table public.screenings is
  'One DOH-NTP checklist per screening event, plus supplementary context that '
  'never feeds the decision: pgis_severity (patient-reported) and the optional '
  'vital signs added in 0024. NO SCORE COLUMN BY DESIGN (§5) — `referred` is '
  'decided by the symptom checklist alone.';

-- ============================================================================
-- POST-CHECKS (run separately — the SQL editor returns only the last result).
--
-- 1. The column is renamed and nothing answers to the old name:
--
--    select column_name from information_schema.columns
--     where table_schema = 'public' and table_name = 'referrals'
--       and column_name in ('specimen_id', 'lab_sample_id');
--
--    Expect exactly one row: lab_sample_id.
--
-- 2. All seven vitals columns exist and are nullable:
--
--    select column_name, data_type, is_nullable
--      from information_schema.columns
--     where table_schema = 'public' and table_name = 'screenings'
--       and column_name in ('height_cm','weight_kg','temperature_c',
--                           'systolic_bp','diastolic_bp','pulse_rate',
--                           'spo2_percent')
--     order by column_name;
--
--    Expect 7 rows, is_nullable = YES on every one.
--
-- 3. Still no score column anywhere (§5) — this must stay empty forever:
--
--    select table_name, column_name from information_schema.columns
--     where table_schema = 'public'
--       and (column_name ilike '%score%' or column_name ilike '%risk%'
--            or column_name ilike '%probab%');
--
-- No backfill: every new column starts NULL, which is the correct value for
-- every screening taken before vitals were collectable.
-- ============================================================================
