-- ============================================================================
-- TB-Screen — 0016_fix_bhw_activity_email_type.sql
-- BUGFIX ×2 in bhw_activity(): the captain portal could not load its BHWs, and
-- (once loading) would have listed BHWs outside the captain's barangay.
--
-- 1. WRONG RETURN TYPE — the actual failure.
--    SYMPTOM: every captain surface calling bhw_activity() (the dashboard and
--    the "My BHWs" page) errored with
--
--      42804  structure of query does not match function result type
--             Returned type character varying(255) does not match expected
--             type text in column 7.
--
--    CAUSE: 0014 added the account email by joining auth.users. auth.users.email
--    is varchar(255), but the RETURNS TABLE declares it as text. plpgsql
--    RETURN QUERY requires the query's column types to match the declared OUT
--    types EXACTLY — it applies no assignment cast — so the function raised for
--    every caller. Column 7 is `email`.
--    FIX: au.email::text.
--
-- 2. SCOPE REGRESSION — restore 0008.
--    0008 deliberately narrowed the captain's list from FACILITY to ASSIGNED
--    BARANGAY, so captains cannot see BHWs outside their own area, and added a
--    guard for a captain with no barangay. 0014 rewrote the function body and
--    reinstated the pre-0008 facility filter, dropping both. That contradicts
--    manage-bhw, which still enforces barangay scope on every write — a captain
--    would see rows they cannot edit ("BHW not found in your barangay").
--    FIX: filter on public.current_user_barangay() again, guard restored.
--
-- Everything else is unchanged: same role guard, same counts-only shape (§1 —
-- still no patient data). The declared return type is identical, so CREATE OR
-- REPLACE suffices (no drop, nothing depending on the function breaks).
-- ============================================================================

create or replace function public.bhw_activity(days_back int default 30)
returns table (
  user_id        uuid,
  full_name      text,
  first_name     text,
  middle_name    text,
  last_name      text,
  purok          text,
  email          text,
  barangay_code  text,
  barangay_name  text,
  joined_at      timestamptz,
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
  if public.current_user_barangay() is null then
    raise exception 'bhw_activity: captain has no assigned barangay';
  end if;

  return query
  select
    u.user_id,
    u.full_name,
    u.first_name,
    u.middle_name,
    u.last_name,
    u.purok,
    au.email::text,   -- auth.users.email is varchar(255); OUT column is text
    u.assigned_barangay_code,
    b.name,
    u.created_at,
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
  left join auth.users au on au.id = u.user_id
  where u.role = 'bhw'
    and u.assigned_barangay_code = public.current_user_barangay()  -- 0008 scope
  order by u.full_name;
end;
$$;

comment on function public.bhw_activity(int) is
  'Per-BHW account (identity + own email + coverage) and 30-day activity counts '
  'for the Barangay-Captain view. Captain role required; scoped to the caller''s '
  'ASSIGNED BARANGAY (0008, restored in 0016); no patient data.';
