-- ============================================================================
-- TB-Screen BHW — 0001_init_schema.sql
-- Feature 1: Backend foundation — schema only.
--
-- POSITIONING (see brief §1): This is a PRE-SCREENING SUPPORT tool. It does NOT
-- diagnose TB. No column, comment, or value in this schema may imply diagnosis,
-- TB probability, detection, or a risk score. Referral is decided by the DOH-NTP
-- symptom checklist ALONE (see brief §5) — there is intentionally NO score column.
--
-- Conventions:
--  * UUID primary keys throughout.
--  * created_at / updated_at on every syncable table; updated_at auto-touched.
--  * Small fixed value sets use CHECK constraints on text columns (kept over
--    Postgres ENUMs so a solo student can alter them without migration pain, and
--    they still generate clean TS union types via `supabase gen types`).
--  * Device-local sync bookkeeping (sync_status pending|synced) lives in the
--    on-device expo-sqlite mirror, NOT on the server — so it is absent here (§7).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Auto-touch updated_at on any UPDATE. Backs the §7 last-write-wins sync.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================================================
-- PSGC reference tables (read-only, seeded). Cascading address dropdowns read
-- these offline (brief §6). DOCUMENTED DELIMITATION: bundled scope is Bukidnon
-- province only (Region X → Bukidnon → its cities/municipalities → barangays).
-- Codes are the official PSGC codes; kept as text to preserve leading zeros.
-- ===========================================================================
create table public.ref_regions (
  region_code   text primary key,
  name          text not null
);

create table public.ref_provinces (
  province_code text primary key,
  region_code   text not null references public.ref_regions(region_code),
  name          text not null
);

create table public.ref_cities (
  city_code     text primary key,
  province_code text not null references public.ref_provinces(province_code),
  name          text not null,
  -- 'city' | 'municipality' — PSGC LGU classification (display only).
  type          text not null default 'municipality'
                 check (type in ('city','municipality'))
);

create table public.ref_barangays (
  barangay_code text primary key,
  city_code     text not null references public.ref_cities(city_code),
  name          text not null
);

create index ref_provinces_region_idx on public.ref_provinces(region_code);
create index ref_cities_province_idx   on public.ref_cities(province_code);
create index ref_barangays_city_idx    on public.ref_barangays(city_code);

-- ===========================================================================
-- facilities
-- ===========================================================================
create table public.facilities (
  facility_id uuid primary key default gen_random_uuid(),
  name        text not null,
  -- barangay_health_station = where BHWs are based; tb_dots = receiving facility.
  type        text not null check (type in ('barangay_health_station','tb_dots')),
  address     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger facilities_set_updated_at
  before update on public.facilities
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- users — one row per authenticated account; user_id === auth.uid().
-- ===========================================================================
create table public.users (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  role                    text not null check (role in ('bhw','tb_dots')),
  full_name               text not null,
  facility_id             uuid not null references public.facilities(facility_id),
  -- BHW's default barangay for enrollment pre-fill (brief §6). Nullable: TB-DOTS
  -- staff have none, and a BHW may not have set it yet.
  assigned_barangay_code  text references public.ref_barangays(barangay_code),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index users_facility_idx on public.users(facility_id);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- patients
--
-- PRIVACY (brief §4): contact_number is stored ONLY when sms_consent = true.
-- The CHECK below makes the database refuse to hold a number without consent,
-- and requires a consent_date whenever consent is granted. Declining SMS still
-- allows enrollment (contact_number simply stays NULL).
-- ===========================================================================
create table public.patients (
  patient_id     uuid primary key default gen_random_uuid(),
  -- Cosmetic UI code (e.g. PAT-0001). The uuid is the real key. Generated on the
  -- enrolling device (offline). NOTE/FLAG: a naive global PAT-000N sequence can
  -- collide across offline devices — to be resolved in Feature 5 (e.g. device-
  -- scoped prefix). Unique here to catch collisions at sync time.
  display_code   text not null unique,
  enrolled_by    uuid not null references public.users(user_id),
  age            int  not null check (age >= 0 and age < 130),
  sex            text not null check (sex in ('male','female')),
  barangay_code  text not null references public.ref_barangays(barangay_code),
  -- Free-form; PSGC has no sitio data, and sitio is NEVER used for matching (§6).
  sitio          text,
  contact_number text,
  sms_consent    boolean not null default false,
  consent_date   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- PRIVACY INVARIANT: no consent ⇒ no number and no consent_date;
  --                    consent ⇒ a consent_date must be recorded.
  constraint patients_sms_consent_gate check (
    (sms_consent = false and contact_number is null and consent_date is null)
    or
    (sms_consent = true  and consent_date is not null)
  )
);

create index patients_enrolled_by_idx on public.patients(enrolled_by);
create index patients_barangay_idx    on public.patients(barangay_code);

create trigger patients_set_updated_at
  before update on public.patients
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- screenings — one DOH-NTP checklist + one PGI-S item per screening event.
--
-- NO SCORE COLUMN BY DESIGN (§5). `referred` is decided by symptom criteria
-- alone in app logic. `pgis_severity` is supplementary context only: it does
-- NOT feed any score and does NOT trigger referral on its own.
-- ===========================================================================
create table public.screenings (
  screening_id   uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.patients(patient_id),
  -- DOH-NTP answers as tri-state where useful, e.g.
  --   {"cough_2wks":"yes","weight_loss":"no","night_sweats":"unsure", ...}
  symptom_flags  jsonb not null default '{}'::jsonb,
  -- Patient-reported cough severity: none|mild|moderate|severe. Context only.
  pgis_severity  text check (pgis_severity in ('none','mild','moderate','severe')),
  referred       boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index screenings_patient_idx on public.screenings(patient_id);

create trigger screenings_set_updated_at
  before update on public.screenings
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- referrals — a screening sent to a receiving TB-DOTS facility.
-- `presented` is the no-show flag (did the patient show up for testing?).
-- `result` is free text recorded by TB-DOTS staff (NOT a computed value).
-- ===========================================================================
create table public.referrals (
  referral_id  uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients(patient_id),
  screening_id uuid not null references public.screenings(screening_id),
  -- Receiving TB-DOTS facility.
  facility_id  uuid not null references public.facilities(facility_id),
  specimen_id  text,
  status       text not null default 'submitted'
                check (status in ('submitted','received','tested','closed')),
  result       text,
  result_date  timestamptz,
  presented    boolean,             -- null = unknown yet; false = no-show
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index referrals_patient_idx  on public.referrals(patient_id);
create index referrals_facility_idx on public.referrals(facility_id);

create trigger referrals_set_updated_at
  before update on public.referrals
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- appointments — check-up scheduling / attendance.
-- ===========================================================================
create table public.appointments (
  appointment_id uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.patients(patient_id),
  scheduled_date date not null,
  attended_date  date,
  status         text not null default 'scheduled'
                  check (status in ('scheduled','attended','missed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index appointments_patient_idx  on public.appointments(patient_id);
create index appointments_schedule_idx on public.appointments(scheduled_date);

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- sms_log — one row per reminder send attempt (written by the Edge Function via
-- the service role in Feature 9). Clients do not write here.
-- ===========================================================================
create table public.sms_log (
  sms_id          uuid primary key default gen_random_uuid(),
  appointment_id  uuid not null references public.appointments(appointment_id),
  sent_at         timestamptz not null default now(),
  delivery_status text not null default 'queued'
                   check (delivery_status in ('queued','sent','failed','stubbed'))
);

create index sms_log_appointment_idx on public.sms_log(appointment_id);
