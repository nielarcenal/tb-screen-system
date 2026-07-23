-- ============================================================================
-- TB-Screen BHW — 0005_fix_rls_recursion.sql
-- BUG FIX found in first live end-to-end test (2026-07-02).
--
-- Symptom: every client read of patients or referrals fails with
--   42P17 "infinite recursion detected in policy"
-- for BOTH roles (portal inbox AND mobile BHW sync).
--
-- Cause: policies that subquery another RLS-protected table re-enter that
-- table's own policies, and two of them form a cycle:
--   patients_tbdots_read      → subqueries public.referrals
--   referrals_bhw_read/insert → subqueries public.patients
-- Postgres expands policies syntactically and ORs them regardless of the
-- caller's role, so the cycle breaks everyone, not just TB-DOTS users.
--
-- Fix: move the tb_dots-side subqueries into SECURITY DEFINER helper
-- functions (same pattern as current_user_role / current_user_facility in
-- 0002) — they read referrals WITHOUT re-applying RLS, which breaks the
-- cycle. Access semantics are unchanged: each role sees exactly the same
-- rows as 0002 intended.
-- ============================================================================

-- Patients with a referral addressed to the calling staff's facility.
create or replace function public.referred_patient_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select patient_id from public.referrals
  where facility_id = public.current_user_facility();
$$;

-- Screenings behind those referrals.
create or replace function public.referred_screening_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select screening_id from public.referrals
  where facility_id = public.current_user_facility();
$$;

-- --- patients: TB-DOTS read, now via the helper (no direct referrals ref) ---
drop policy if exists patients_tbdots_read on public.patients;
create policy patients_tbdots_read on public.patients
  for select to authenticated
  using (
    public.current_user_role() = 'tb_dots'
    and patient_id in (select public.referred_patient_ids())
  );

-- --- screenings: TB-DOTS read ---
drop policy if exists screenings_tbdots_read on public.screenings;
create policy screenings_tbdots_read on public.screenings
  for select to authenticated
  using (
    public.current_user_role() = 'tb_dots'
    and screening_id in (select public.referred_screening_ids())
  );

-- --- appointments: TB-DOTS read + update ---
drop policy if exists appointments_tbdots_read on public.appointments;
create policy appointments_tbdots_read on public.appointments
  for select to authenticated
  using (
    public.current_user_role() = 'tb_dots'
    and patient_id in (select public.referred_patient_ids())
  );

drop policy if exists appointments_tbdots_update on public.appointments;
create policy appointments_tbdots_update on public.appointments
  for update to authenticated
  using (
    public.current_user_role() = 'tb_dots'
    and patient_id in (select public.referred_patient_ids())
  );
