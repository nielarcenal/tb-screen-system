-- ============================================================================
-- TB-Screen BHW — 0006_design_parity.sql
-- Design-canvas parity batch (approved 2026-07-07):
--   1. patients.full_name + patients.birthdate (user sign-off on collecting
--      names; previously the schema was deliberately code-only).
--   2. referrals.result_outcome — STRUCTURED positive/negative recorded by
--      TB-DOTS staff after laboratory testing. NEVER computed by the system
--      (§1). Powers the facility dashboard counts. The mobile app does NOT
--      sync this column: outcomes stay visible at the facility only; BHWs see
--      referral progress (submitted/received/tested/result recorded).
--   3. Barangay-Captain role: users.role gains 'captain', users.active gains a
--      deactivation flag. Captains manage BHW ACCOUNTS only — the existing
--      patient/screening/referral policies all gate on role in
--      ('bhw','tb_dots'), so a captain can read NO patient data of any kind.
--   4. dashboard_counts() — today's aggregate counts for the TB-DOTS dashboard.
--   5. bhw_activity()   — per-BHW 30-day activity counts for the captain view.
--
-- POSITIONING (§1) unchanged: no score, no probability, nothing diagnostic is
-- computed anywhere. Counts are counts.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Patient identity: name + birthdate.
-- Nullable because pre-0006 rows have neither; the app requires both for new
-- enrollments and keeps writing the derived integer `age` so nothing breaks.
-- Privacy: names ride the SAME row-level policies as the rest of the patient
-- row — enrolling BHW's facility and the receiving TB-DOTS facility only.
-- ---------------------------------------------------------------------------
alter table public.patients
  add column if not exists full_name text,
  add column if not exists birthdate date
    check (birthdate is null or birthdate <= current_date);

-- ---------------------------------------------------------------------------
-- 2. Structured lab-result outcome (facility-recorded, never computed).
-- `result` stays as free-text notes; `result_outcome` is the countable value.
-- ---------------------------------------------------------------------------
alter table public.referrals
  add column if not exists result_outcome text
    check (result_outcome in ('positive','negative'));

comment on column public.referrals.result_outcome is
  'Laboratory outcome recorded by TB-DOTS staff after testing. Never computed. '
  'Not synced to BHW devices — facility-visible only.';

-- ---------------------------------------------------------------------------
-- 3. Captain role + account deactivation flag.
-- Captains share facility_id with their BHWs, so the existing
-- users_read_same_facility policy already lets them LIST accounts. All account
-- WRITES (create / edit / deactivate) go through the manage-bhw Edge Function
-- (service role): deactivation also bans the auth user, which is what actually
-- blocks sign-in. `active` is the UI/reporting flag.
-- ---------------------------------------------------------------------------
alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check check (role in ('bhw','tb_dots','captain'));

alter table public.users
  add column if not exists active boolean not null default true;

-- ---------------------------------------------------------------------------
-- 4. dashboard_counts() — today's numbers for the TB-DOTS facility dashboard.
--
-- Why SECURITY DEFINER: same controlled boundary-crossing as hotspot_counts
-- (0004) — aggregates only, tb_dots callers only. screened_today is
-- catchment-wide (all screenings submitted today, referred or not), matching
-- the hotspot precedent; every other number is scoped to the caller's own
-- facility.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_counts()
returns table (
  screened_today  bigint,  -- screenings submitted today (catchment-wide)
  referred_today  bigint,  -- referrals addressed to this facility today
  positive_today  bigint,  -- outcomes recorded today at this facility
  negative_today  bigint,
  attended_today  bigint,  -- of appointments scheduled today (referred patients)
  missed_today    bigint,
  scheduled_today bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_user_role() is distinct from 'tb_dots' then
    raise exception 'dashboard_counts: TB-DOTS role required';
  end if;

  return query
  select
    (select count(*) from public.screenings s
      where s.created_at::date = current_date),
    (select count(*) from public.referrals r
      where r.facility_id = public.current_user_facility()
        and r.created_at::date = current_date),
    (select count(*) from public.referrals r
      where r.facility_id = public.current_user_facility()
        and r.result_outcome = 'positive'
        and r.result_date::date = current_date),
    (select count(*) from public.referrals r
      where r.facility_id = public.current_user_facility()
        and r.result_outcome = 'negative'
        and r.result_date::date = current_date),
    (select count(*) from public.appointments a
      where a.scheduled_date = current_date and a.status = 'attended'
        and a.patient_id in (select public.referred_patient_ids())),
    (select count(*) from public.appointments a
      where a.scheduled_date = current_date and a.status = 'missed'
        and a.patient_id in (select public.referred_patient_ids())),
    (select count(*) from public.appointments a
      where a.scheduled_date = current_date
        and a.patient_id in (select public.referred_patient_ids()));
end;
$$;

comment on function public.dashboard_counts() is
  'Aggregate today-counts for the TB-DOTS portal dashboard. Counts only; '
  'TB-DOTS role required; never per-patient data.';

-- ---------------------------------------------------------------------------
-- 5. bhw_activity() — captain's BHW-management table: accounts + counts ONLY.
--
-- Why SECURITY DEFINER: captains cannot read patients/screenings/referrals
-- (by design), so their activity counts must cross that boundary in a
-- controlled way. Output contains NO patient-level data whatsoever.
--
-- Attribution note (documented approximation): screenings/referrals are
-- attributed to the BHW who ENROLLED the patient (patients.enrolled_by) —
-- screenings do not record a creator column. Accurate for the normal flow
-- where a BHW screens their own enrollees.
-- ---------------------------------------------------------------------------
create or replace function public.bhw_activity(days_back int default 30)
returns table (
  user_id        uuid,
  full_name      text,
  barangay_code  text,
  barangay_name  text,
  active         boolean,
  screenings_n   bigint,
  referrals_n    bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_user_role() is distinct from 'captain' then
    raise exception 'bhw_activity: captain role required';
  end if;

  return query
  select
    u.user_id,
    u.full_name,
    u.assigned_barangay_code,
    b.name,
    u.active,
    (select count(*) from public.screenings s
      join public.patients p on p.patient_id = s.patient_id
      where p.enrolled_by = u.user_id
        and s.created_at >= now() - make_interval(days => days_back)),
    (select count(*) from public.referrals r
      join public.patients p on p.patient_id = r.patient_id
      where p.enrolled_by = u.user_id
        and r.created_at >= now() - make_interval(days => days_back))
  from public.users u
  left join public.ref_barangays b on b.barangay_code = u.assigned_barangay_code
  where u.role = 'bhw'
    and u.facility_id = public.current_user_facility()
  order by u.full_name;
end;
$$;

comment on function public.bhw_activity(int) is
  'Per-BHW account + activity counts for the Barangay-Captain view. Captain '
  'role required; scoped to the caller''s facility; no patient data.';
