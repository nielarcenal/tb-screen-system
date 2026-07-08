-- ============================================================================
-- TB-Screen BHW — 0007_bhw_barangay_scope.sql
-- Access-model change (user decision, 2026-07-08):
--
--   BEFORE (0002): a BHW saw every patient enrolled by anyone in their
--   FACILITY — in practice, patients from every barangay.
--
--   AFTER: a BHW sees only
--     (a) patients whose barangay_code equals their own assigned barangay, OR
--     (b) patients they themselves enrolled (the enrollment form deliberately
--         lets a BHW record a resident of a neighboring barangay — without (b)
--         that record would vanish from the very device that created it).
--   TB-DOTS staff now read ALL patients (previously: only referred ones).
--   Screenings / referrals / appointments follow the parent patient's scope.
--
--   Also: TB-DOTS staff may read BHW users rows (any facility) so the portal
--   can show WHICH BHW screened/enrolled a patient by name.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER: read users/patients without re-entering RLS —
-- same anti-recursion pattern as 0002/0005).
-- ---------------------------------------------------------------------------
create or replace function public.current_user_barangay()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select assigned_barangay_code from public.users where user_id = auth.uid();
$$;

-- Patient ids the calling BHW may see: own barangay OR own enrollments.
-- Child-table policies use this instead of subquerying patients directly.
create or replace function public.bhw_visible_patient_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select patient_id from public.patients
  where barangay_code = public.current_user_barangay()
     or enrolled_by = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- patients
-- ---------------------------------------------------------------------------
drop policy if exists patients_bhw_read on public.patients;
create policy patients_bhw_read on public.patients
  for select to authenticated
  using (
    public.current_user_role() = 'bhw'
    and (
      barangay_code = public.current_user_barangay()
      or enrolled_by = auth.uid()
    )
  );

drop policy if exists patients_bhw_update on public.patients;
create policy patients_bhw_update on public.patients
  for update to authenticated
  using (
    public.current_user_role() = 'bhw'
    and (
      barangay_code = public.current_user_barangay()
      or enrolled_by = auth.uid()
    )
  );

-- TB-DOTS: all patients (user decision — previously referred-only).
drop policy if exists patients_tbdots_read on public.patients;
create policy patients_tbdots_read on public.patients
  for select to authenticated
  using (public.current_user_role() = 'tb_dots');

-- ---------------------------------------------------------------------------
-- screenings — BHW scope follows the parent patient.
-- ---------------------------------------------------------------------------
drop policy if exists screenings_bhw_read on public.screenings;
create policy screenings_bhw_read on public.screenings
  for select to authenticated
  using (
    public.current_user_role() = 'bhw'
    and patient_id in (select public.bhw_visible_patient_ids())
  );

drop policy if exists screenings_bhw_insert on public.screenings;
create policy screenings_bhw_insert on public.screenings
  for insert to authenticated
  with check (
    public.current_user_role() = 'bhw'
    and patient_id in (select public.bhw_visible_patient_ids())
  );

drop policy if exists screenings_bhw_update on public.screenings;
create policy screenings_bhw_update on public.screenings
  for update to authenticated
  using (
    public.current_user_role() = 'bhw'
    and patient_id in (select public.bhw_visible_patient_ids())
  );

-- ---------------------------------------------------------------------------
-- referrals — BHW scope follows the parent patient.
-- ---------------------------------------------------------------------------
drop policy if exists referrals_bhw_read on public.referrals;
create policy referrals_bhw_read on public.referrals
  for select to authenticated
  using (
    public.current_user_role() = 'bhw'
    and patient_id in (select public.bhw_visible_patient_ids())
  );

drop policy if exists referrals_bhw_insert on public.referrals;
create policy referrals_bhw_insert on public.referrals
  for insert to authenticated
  with check (
    public.current_user_role() = 'bhw'
    and patient_id in (select public.bhw_visible_patient_ids())
  );

-- ---------------------------------------------------------------------------
-- appointments — BHW scope follows the parent patient.
-- ---------------------------------------------------------------------------
drop policy if exists appointments_bhw_read on public.appointments;
create policy appointments_bhw_read on public.appointments
  for select to authenticated
  using (
    public.current_user_role() = 'bhw'
    and patient_id in (select public.bhw_visible_patient_ids())
  );

drop policy if exists appointments_bhw_insert on public.appointments;
create policy appointments_bhw_insert on public.appointments
  for insert to authenticated
  with check (
    public.current_user_role() = 'bhw'
    and patient_id in (select public.bhw_visible_patient_ids())
  );

drop policy if exists appointments_bhw_update on public.appointments;
create policy appointments_bhw_update on public.appointments
  for update to authenticated
  using (
    public.current_user_role() = 'bhw'
    and patient_id in (select public.bhw_visible_patient_ids())
  );

-- ---------------------------------------------------------------------------
-- users: TB-DOTS staff may read BHW rows (any facility) — needed to display
-- the enrolling/screening BHW's name in the portal. Names + barangay only in
-- practice; no patient data lives on users rows.
-- ---------------------------------------------------------------------------
drop policy if exists users_tbdots_read_bhws on public.users;
create policy users_tbdots_read_bhws on public.users
  for select to authenticated
  using (
    public.current_user_role() = 'tb_dots'
    and role = 'bhw'
  );
