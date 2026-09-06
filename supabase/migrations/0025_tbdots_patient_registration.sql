-- ============================================================================
-- TB-Screen — 0025_tbdots_patient_registration.sql
-- TB-DOTS staff may register a patient directly, for walk-in and self-referred
-- people who never went through a BHW. Confirmed with the TB-DOTS head nurse,
-- 2026-09-06, alongside the referral-model correction in 0024.
--
-- NO SCHEMA CHANGE TO THE TABLES. patients.enrolled_by has always been a plain
-- foreign key to users, not a bhw-only column, so a facility-registered patient
-- is an ordinary patients row whose enroller happens to hold the tb_dots role.
-- What was missing was permission: every INSERT policy on patients, screenings
-- and referrals gated on current_user_role() = 'bhw'.
--
-- WHY A WALK-IN GETS THE WHOLE CHAIN (patient → screening → referral), not just
-- a patient row:
--
--   * referrals.screening_id is NOT NULL, and the portal's inbox, detail panel
--     and hotspot_counts() all read the screening. A patient row on its own
--     would be a half-record that nothing downstream could render.
--   * The walk-in's referral starts at status 'received', not 'submitted' —
--     there is no "waiting to arrive" phase for someone already standing at the
--     desk. Nothing else about the row differs.
--   * 0021 narrowed patients_tbdots_read to referred patients only, and its
--     header names this exact case ("a walk-in with no BHW referral, say") as
--     the reason it might one day need revisiting. It does not: the referral
--     row makes the patient visible through the existing policy. 0021 stands.
--
-- POSITIONING (§1, §5) unchanged. The screening a facility records is the same
-- DOH-NTP checklist under the same rule — `referred` still comes from the
-- symptom answers alone. Registering a patient is data entry, not a finding.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: patient ids the CALLER personally enrolled.
--
-- SECURITY DEFINER for the same anti-recursion reason as 0005/0007 — a policy
-- on screenings or referrals must be able to consult patients without
-- re-entering that table's own policies. Not role-gated inside the function:
-- it answers a question about the caller's own rows and each policy below
-- applies its own role check, matching bhw_visible_patient_ids() (0007).
-- ---------------------------------------------------------------------------
create or replace function public.own_enrolled_patient_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select patient_id from public.patients where enrolled_by = auth.uid();
$$;

comment on function public.own_enrolled_patient_ids() is
  'Patient ids enrolled by the calling account. Used by the tb_dots insert '
  'policies (0025): at the moment a walk-in screening or referral is written '
  'the referral does not exist yet, so referred_patient_ids() cannot answer.';

-- ---------------------------------------------------------------------------
-- patients — insert, and a read widened to cover the caller's own enrolments.
--
-- The read widening mirrors clause (b) of the BHW rule in 0007: a record must
-- not vanish from the very account that created it. Without it a facility
-- registration would be invisible for the instant between the patient INSERT
-- and the referral INSERT — and permanently invisible if the referral failed,
-- leaving an orphan row no one could see or repair through the portal.
-- Scope is unchanged in every other respect: 0021's referred-only rule still
-- governs every patient the account did not itself enrol.
-- ---------------------------------------------------------------------------
drop policy if exists patients_tbdots_insert on public.patients;
create policy patients_tbdots_insert on public.patients
  for insert to authenticated
  with check (
    public.current_user_role() = 'tb_dots'
    and enrolled_by = auth.uid()
  );

drop policy if exists patients_tbdots_read on public.patients;
create policy patients_tbdots_read on public.patients
  for select to authenticated
  using (
    public.current_user_role() = 'tb_dots'
    and (
      patient_id in (select public.referred_patient_ids())
      or enrolled_by = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- screenings — insert for the caller's own patients; read widened to match.
-- ---------------------------------------------------------------------------
drop policy if exists screenings_tbdots_insert on public.screenings;
create policy screenings_tbdots_insert on public.screenings
  for insert to authenticated
  with check (
    public.current_user_role() = 'tb_dots'
    and patient_id in (select public.own_enrolled_patient_ids())
  );

drop policy if exists screenings_tbdots_read on public.screenings;
create policy screenings_tbdots_read on public.screenings
  for select to authenticated
  using (
    public.current_user_role() = 'tb_dots'
    and (
      screening_id in (select public.referred_screening_ids())
      or patient_id in (select public.own_enrolled_patient_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- referrals — insert, addressed to the staff member's OWN facility only.
--
-- Deliberately narrower than referrals_tbdots_update (0002), which governs a
-- referral that already exists: a facility may create a referral only for a
-- patient it registered itself, and only to itself. It may not manufacture a
-- referral into another facility's inbox, nor attach one to a patient a BHW
-- enrolled.
--
-- The status is NOT pinned to 'received' here. RLS gates rows, not workflow,
-- and referrals_tbdots_update already lets this account move the status freely
-- a second later — pinning it would be theatre. The portal writes 'received'.
-- ---------------------------------------------------------------------------
drop policy if exists referrals_tbdots_insert on public.referrals;
create policy referrals_tbdots_insert on public.referrals
  for insert to authenticated
  with check (
    public.current_user_role() = 'tb_dots'
    and facility_id = public.current_user_facility()
    and patient_id in (select public.own_enrolled_patient_ids())
  );

-- ---------------------------------------------------------------------------
-- Patient display codes for the portal.
--
-- Mobile generates PAT-<4-char device code>-<seq> offline, where the device
-- code is random per installation so two phones cannot collide (§4.2). The
-- portal has no such problem and needs no such trick: it is online by
-- definition and the database can simply hand out the next number. Facility
-- registrations are therefore PAT-DOTS-<seq>, which is also legible on sight
-- as "this one did not come from a BHW".
--
-- The loop is a guard, not an expectation: display_code is UNIQUE server-wide,
-- and a code could in principle already be taken if the sequence were ever
-- reset or a row inserted by hand. Skipping past it costs one extra nextval.
--
-- SECURITY DEFINER so the existence probe reads patients without RLS (the
-- caller cannot see other facilities' patients, and must not have to). Role
-- gate inside, same shape as hotspot_counts() (0004).
-- ---------------------------------------------------------------------------
create sequence if not exists public.facility_patient_code_seq;

create or replace function public.next_facility_patient_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  code text;
begin
  if public.current_user_role() is distinct from 'tb_dots' then
    raise exception 'next_facility_patient_code: TB-DOTS role required';
  end if;

  loop
    code := 'PAT-DOTS-' ||
            lpad(nextval('public.facility_patient_code_seq')::text, 4, '0');
    exit when not exists (
      select 1 from public.patients where display_code = code
    );
  end loop;

  return code;
end;
$$;

comment on function public.next_facility_patient_code() is
  'Next PAT-DOTS-#### display code for a patient registered at the facility '
  'portal (0025). TB-DOTS role required. Mobile does not use this — it '
  'generates PAT-<device>-<seq> offline.';

-- ============================================================================
-- POST-CHECKS (run separately).
--
-- 1. The four policies exist and carry the expected commands:
--
--    select tablename, policyname, cmd
--      from pg_policies
--     where schemaname = 'public'
--       and policyname in ('patients_tbdots_insert', 'patients_tbdots_read',
--                          'screenings_tbdots_insert', 'screenings_tbdots_read',
--                          'referrals_tbdots_insert')
--     order by tablename, policyname;
--
--    Expect 5 rows: patients INSERT + SELECT, referrals INSERT,
--    screenings INSERT + SELECT.
--
-- 2. Both new functions are SECURITY DEFINER with a pinned search_path:
--
--    select proname, prosecdef, proconfig
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and proname in ('own_enrolled_patient_ids',
--                       'next_facility_patient_code');
--
--    Expect prosecdef = true and proconfig = {search_path=public} on both.
--
-- 3. The code generator refuses a non-tb_dots caller. Run as a BHW token:
--
--    select public.next_facility_patient_code();   -- expect: role required
--
-- No data migration: this grants permission and adds a generator. Nothing
-- existing changes.
-- ============================================================================
