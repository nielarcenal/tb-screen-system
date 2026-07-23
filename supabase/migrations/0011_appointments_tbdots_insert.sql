-- ============================================================================
-- TB-Screen BHW — 0011_appointments_tbdots_insert.sql
-- Let TB-DOTS staff SCHEDULE follow-up check-ups from the facility portal.
--
-- Decision (2026-07-22): the BHW's mobile app still creates the FIRST check-up
-- at referral time; the facility owns every subsequent one. Facility staff
-- already had read + update on appointments (mark attended / missed) but NO
-- insert — so a "Schedule check-up" button would send the row and RLS would
-- silently accept zero. This adds the missing insert policy.
--
-- Scope is identical to appointments_tbdots_update: a staff member may insert
-- an appointment ONLY for a patient referred to their own facility. Same
-- SECURITY DEFINER helper (referred_patient_ids(), 0005), so no recursion and
-- no new cross-table policy reference.
--
-- POSITIONING (§1/§5) unchanged: an appointment is a date + a status, nothing
-- computed, scored, or diagnostic. This is calendar data entry only.
-- ============================================================================

drop policy if exists appointments_tbdots_insert on public.appointments;
create policy appointments_tbdots_insert on public.appointments
  for insert to authenticated
  with check (
    public.current_user_role() = 'tb_dots'
    and patient_id in (select public.referred_patient_ids())
  );
