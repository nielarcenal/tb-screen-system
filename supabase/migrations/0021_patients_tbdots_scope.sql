-- ============================================================================
-- TB-Screen BHW — 0021_patients_tbdots_scope.sql
--
-- Narrows patients_tbdots_read to referred patients only, restoring the scope
-- 0005 set and 0007 widened.
--
-- THIS REVERSES A RECORDED DECISION. 0007's header says, of 2026-07-08:
--   "Access-model change (user decision): TB-DOTS staff now read ALL patients
--    (previously: only referred ones)."
-- and the policy itself carries "-- TB-DOTS: all patients (user decision —
-- previously referred-only)." Applied 2026-08-27 on explicit instruction,
-- after that decision was surfaced and re-confirmed. If a facility later needs
-- to look up a patient who was never referred to them — a walk-in with no BHW
-- referral, say — this is the migration to revisit, not a bug to chase.
--
-- WHY. patients_tbdots_read was an unconditional
--   using (public.current_user_role() = 'tb_dots')
-- so any account with that role could read EVERY patient row in the database,
-- province-wide, straight through PostgREST. The client-side gate shipped in
-- bb4aed0 (D-07) stops a tb_dots account signing into the mobile app, which
-- closes the route by which a phone pulled the whole province into its local
-- sqlite — but a client gate is a UX guarantee, not a boundary. Anyone holding
-- a tb_dots token could still page the table directly. This is the boundary.
--
-- It also restores consistency: 0005 scoped the equivalent tb_dots reads on
-- screenings and appointments to referred_screening_ids() / referred_patient_ids(),
-- and 0007 left patients as the one table out of step.
--
-- WHAT WAS CHECKED FIRST, against the live project rather than the files:
--   * hotspot_counts, dashboard_counts and bhw_activity are all
--     SECURITY DEFINER (prosecdef = true) — they bypass RLS and are unaffected.
--   * The portal's only direct reads of patients are nested under referral
--     selects in ReferralInbox / ReferralDetail, which are already scoped to
--     the facility's own referrals.
--   * Measured before applying, simulating the live tb_dots account under RLS:
--     6 patients visible, 3 of them referred to that account's facility.
--
-- The helper is the same SECURITY DEFINER function 0005 introduced, so reading
-- referrals from inside a patients policy does not recurse back into RLS.
-- ============================================================================

drop policy if exists patients_tbdots_read on public.patients;
create policy patients_tbdots_read on public.patients
  for select to authenticated
  using (
    public.current_user_role() = 'tb_dots'
    and patient_id in (select public.referred_patient_ids())
  );

-- ----------------------------------------------------------------------------
-- Rollback, should an unreferred-patient lookup turn out to be needed:
--
--   drop policy if exists patients_tbdots_read on public.patients;
--   create policy patients_tbdots_read on public.patients
--     for select to authenticated
--     using (public.current_user_role() = 'tb_dots');
-- ----------------------------------------------------------------------------
