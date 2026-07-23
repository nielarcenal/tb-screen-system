-- ============================================================================
-- TB-Screen BHW — 0002_rls_policies.sql
-- Feature 1: Row Level Security. RLS is enabled on EVERY table; access is denied
-- by default and only the explicit policies below grant it (brief §4).
--
-- Access model:
--   BHW      → patients they/their facility enrolled, and the screenings,
--              referrals, and appointments hanging off those patients.
--   TB-DOTS  → referrals sent to THEIR facility, plus the patient/screening/
--              appointment rows behind those referrals (needed to record
--              results, mark attendance, flag no-shows).
--   Aggregate Barangay Hotspot counts cross facility boundaries, so they are
--   intentionally NOT exposed by these row policies — they will come from a
--   SECURITY DEFINER function returning ONLY counts-by-barangay in Feature 10.
--
-- NOTE: The service_role key (server-side Edge Functions) bypasses RLS entirely,
--       which is how the SMS job writes sms_log.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper functions. SECURITY DEFINER so they can read public.users WITHOUT
-- being blocked by users' own RLS (which would otherwise cause recursion).
-- search_path pinned to public to prevent search_path hijacking.
-- ---------------------------------------------------------------------------
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where user_id = auth.uid();
$$;

create or replace function public.current_user_facility()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select facility_id from public.users where user_id = auth.uid();
$$;

-- ===========================================================================
-- Enable RLS everywhere (default-deny).
-- ===========================================================================
alter table public.ref_regions    enable row level security;
alter table public.ref_provinces  enable row level security;
alter table public.ref_cities     enable row level security;
alter table public.ref_barangays  enable row level security;
alter table public.facilities     enable row level security;
alter table public.users          enable row level security;
alter table public.patients       enable row level security;
alter table public.screenings     enable row level security;
alter table public.referrals      enable row level security;
alter table public.appointments   enable row level security;
alter table public.sms_log        enable row level security;

-- ===========================================================================
-- Reference tables: any authenticated user may READ (needed to populate the
-- offline PSGC cache and the address cascade). No client writes — seeded only.
-- ===========================================================================
create policy ref_regions_read   on public.ref_regions   for select to authenticated using (true);
create policy ref_provinces_read on public.ref_provinces for select to authenticated using (true);
create policy ref_cities_read    on public.ref_cities    for select to authenticated using (true);
create policy ref_barangays_read on public.ref_barangays for select to authenticated using (true);

-- ===========================================================================
-- facilities: any authenticated user may READ (a BHW must be able to pick a
-- receiving TB-DOTS facility). Facilities are seeded/administered, not written
-- by the app, so there are no client INSERT/UPDATE policies.
-- ===========================================================================
create policy facilities_read on public.facilities
  for select to authenticated using (true);

-- ===========================================================================
-- users: a user may read their own row and rows in the same facility (so a BHW
-- can attribute patients to colleagues). A user may update ONLY their own row
-- (e.g. setting assigned_barangay_code). Rows are created during provisioning
-- (see seed.sql), not self-served.
-- ===========================================================================
create policy users_read_same_facility on public.users
  for select to authenticated
  using (user_id = auth.uid() or facility_id = public.current_user_facility());

create policy users_update_self on public.users
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ===========================================================================
-- patients
-- ===========================================================================
-- BHW: read patients enrolled by anyone in the BHW's own facility.
create policy patients_bhw_read on public.patients
  for select to authenticated
  using (
    public.current_user_role() = 'bhw'
    and enrolled_by in (
      select user_id from public.users
      where facility_id = public.current_user_facility()
    )
  );

-- BHW: enroll a patient (must attribute the row to themselves).
create policy patients_bhw_insert on public.patients
  for insert to authenticated
  with check (
    public.current_user_role() = 'bhw'
    and enrolled_by = auth.uid()
  );

-- BHW: update patients within their own facility.
create policy patients_bhw_update on public.patients
  for update to authenticated
  using (
    public.current_user_role() = 'bhw'
    and enrolled_by in (
      select user_id from public.users
      where facility_id = public.current_user_facility()
    )
  );

-- TB-DOTS: read ONLY patients who have a referral to the staff's facility.
create policy patients_tbdots_read on public.patients
  for select to authenticated
  using (
    public.current_user_role() = 'tb_dots'
    and patient_id in (
      select patient_id from public.referrals
      where facility_id = public.current_user_facility()
    )
  );

-- ===========================================================================
-- screenings: same visibility as the parent patient, per role.
-- ===========================================================================
create policy screenings_bhw_read on public.screenings
  for select to authenticated
  using (
    public.current_user_role() = 'bhw'
    and patient_id in (
      select p.patient_id from public.patients p
      join public.users u on u.user_id = p.enrolled_by
      where u.facility_id = public.current_user_facility()
    )
  );

create policy screenings_bhw_insert on public.screenings
  for insert to authenticated
  with check (
    public.current_user_role() = 'bhw'
    and patient_id in (
      select p.patient_id from public.patients p
      join public.users u on u.user_id = p.enrolled_by
      where u.facility_id = public.current_user_facility()
    )
  );

create policy screenings_bhw_update on public.screenings
  for update to authenticated
  using (
    public.current_user_role() = 'bhw'
    and patient_id in (
      select p.patient_id from public.patients p
      join public.users u on u.user_id = p.enrolled_by
      where u.facility_id = public.current_user_facility()
    )
  );

-- TB-DOTS: read screenings behind referrals sent to their facility.
create policy screenings_tbdots_read on public.screenings
  for select to authenticated
  using (
    public.current_user_role() = 'tb_dots'
    and screening_id in (
      select screening_id from public.referrals
      where facility_id = public.current_user_facility()
    )
  );

-- ===========================================================================
-- referrals
-- ===========================================================================
-- BHW: read/create referrals for patients in their own facility.
create policy referrals_bhw_read on public.referrals
  for select to authenticated
  using (
    public.current_user_role() = 'bhw'
    and patient_id in (
      select p.patient_id from public.patients p
      join public.users u on u.user_id = p.enrolled_by
      where u.facility_id = public.current_user_facility()
    )
  );

create policy referrals_bhw_insert on public.referrals
  for insert to authenticated
  with check (
    public.current_user_role() = 'bhw'
    and patient_id in (
      select p.patient_id from public.patients p
      join public.users u on u.user_id = p.enrolled_by
      where u.facility_id = public.current_user_facility()
    )
  );

-- TB-DOTS: read + update referrals addressed to their facility (record result,
-- update status, flag no-show via `presented`).
create policy referrals_tbdots_read on public.referrals
  for select to authenticated
  using (
    public.current_user_role() = 'tb_dots'
    and facility_id = public.current_user_facility()
  );

create policy referrals_tbdots_update on public.referrals
  for update to authenticated
  using (
    public.current_user_role() = 'tb_dots'
    and facility_id = public.current_user_facility()
  )
  with check (facility_id = public.current_user_facility());

-- ===========================================================================
-- appointments
-- ===========================================================================
-- BHW: full read/write for their facility's patients.
create policy appointments_bhw_read on public.appointments
  for select to authenticated
  using (
    public.current_user_role() = 'bhw'
    and patient_id in (
      select p.patient_id from public.patients p
      join public.users u on u.user_id = p.enrolled_by
      where u.facility_id = public.current_user_facility()
    )
  );

create policy appointments_bhw_insert on public.appointments
  for insert to authenticated
  with check (
    public.current_user_role() = 'bhw'
    and patient_id in (
      select p.patient_id from public.patients p
      join public.users u on u.user_id = p.enrolled_by
      where u.facility_id = public.current_user_facility()
    )
  );

create policy appointments_bhw_update on public.appointments
  for update to authenticated
  using (
    public.current_user_role() = 'bhw'
    and patient_id in (
      select p.patient_id from public.patients p
      join public.users u on u.user_id = p.enrolled_by
      where u.facility_id = public.current_user_facility()
    )
  );

-- TB-DOTS: read/update appointments for patients referred to their facility
-- (mark attendance date, mark missed).
create policy appointments_tbdots_read on public.appointments
  for select to authenticated
  using (
    public.current_user_role() = 'tb_dots'
    and patient_id in (
      select patient_id from public.referrals
      where facility_id = public.current_user_facility()
    )
  );

create policy appointments_tbdots_update on public.appointments
  for update to authenticated
  using (
    public.current_user_role() = 'tb_dots'
    and patient_id in (
      select patient_id from public.referrals
      where facility_id = public.current_user_facility()
    )
  );

-- ===========================================================================
-- sms_log: no client policies at all → clients cannot read or write it. Only
-- the service_role (Edge Function, Feature 9) touches it, bypassing RLS.
-- RLS is enabled above so nothing leaks by default.
-- ===========================================================================
