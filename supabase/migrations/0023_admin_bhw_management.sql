-- 0023 — let admins manage BHW accounts, and separate active from deactivated
-- in the admin overview tiles.
--
-- TWO CHANGES, both requested by the user on 2026-09-06.
--
-- ---------------------------------------------------------------------------
-- 1. bhw_activity() gains admin as a second caller role.
--
-- WHY. Until now only a captain could reach a BHW account, and only within
-- their own barangay (0008). That is the right boundary for captains, but it
-- made the admin dependent on a captain being available and correct: when a
-- BHW cannot sign in, the fix waits on whoever holds that barangay. The
-- captain's scope is UNCHANGED; the admin is added alongside it, unscoped.
--
-- THIS IS A DELIBERATE WIDENING OF ADMIN REACH. An admin can now see and act
-- on every BHW account in the system. That is the point of the change, but it
-- is a real boundary being moved and should not be read as incidental. What it
-- does NOT do is open patient data: this function returns accounts and counts
-- only, and admins still have no patient read policy anywhere (see 0022).
--
-- HOW THE SCOPE IS ENFORCED. v_scope is set from the caller's own barangay for
-- a captain and left NULL for an admin, and the predicate is
--   (v_scope is null or u.assigned_barangay_code = v_scope)
-- A captain can never reach the NULL branch: the captain path raises if
-- current_user_barangay() is null, so v_scope is guaranteed non-null by the
-- time the query runs. Writing it the other way round -- checking the role
-- again inside the predicate -- would put the boundary in two places.
--
-- ---------------------------------------------------------------------------
-- 2. admin_overview() splits active and deactivated personnel.
--
-- 0022's header left this open in as many words:
--
--   "No active/inactive filter. The previous function counted deactivated
--    accounts too; preserving that keeps the change to the join alone. If
--    these tiles should exclude deactivated staff, that is a separate call."
--
-- This is that call. The `captains` and `bhws` columns now count ACTIVE
-- accounts only, and two new columns carry the deactivated ones, so the
-- headline number means "people who can actually sign in" while the
-- deactivated figure stays visible rather than being silently folded in or
-- silently dropped.
--
-- NOTE THE SEMANTIC CHANGE: `captains` and `bhws` previously INCLUDED
-- deactivated accounts. Any consumer reading them as totals now reads them as
-- active counts. The only consumer is AdminDashboard.tsx, updated alongside.
--
-- The return type changes, so this is a DROP + CREATE rather than a CREATE OR
-- REPLACE, and the grants are restated because DROP discards them.
--
-- The catchment join from 0022 is carried over unchanged: captains and BHWs
-- sit on a barangay health station, not on the DOTS centre, so they are
-- counted through the catchment that refers to that centre. Do not "simplify"
-- it back to u.facility_id = f.facility_id -- that is the bug 0022 fixed, and
-- it made every count structurally zero.

-- ---------------------------------------------------------------------------
-- 1. bhw_activity: captain (scoped, 0008) or admin (unscoped).
-- ---------------------------------------------------------------------------
create or replace function public.bhw_activity(days_back integer default 30)
returns table(
  user_id uuid,
  full_name text,
  first_name text,
  middle_name text,
  last_name text,
  purok text,
  email text,
  barangay_code text,
  barangay_name text,
  joined_at timestamp with time zone,
  active boolean,
  screenings_n bigint,
  referrals_n bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role  text := public.current_user_role();
  v_scope text;
begin
  if v_role = 'captain' then
    v_scope := public.current_user_barangay();
    if v_scope is null then
      raise exception 'bhw_activity: captain has no assigned barangay';
    end if;
  elsif v_role = 'admin' then
    v_scope := null;  -- unscoped by design; see header
  else
    raise exception 'bhw_activity: captain or admin role required';
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
    and (v_scope is null or u.assigned_barangay_code = v_scope)  -- 0008 scope for captains
  order by u.full_name;
end;
$function$;

comment on function public.bhw_activity(integer) is
  'BHW accounts with 30-day activity counts. Captains see their own barangay '
  '(0008); admins see all BHWs (0023). Accounts and counts only, never patient rows.';

-- ---------------------------------------------------------------------------
-- 2. admin_overview: active vs deactivated.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_overview();

create function public.admin_overview()
returns table(
  facility_id uuid,
  facility_name text,
  captains bigint,
  captains_inactive bigint,
  bhws bigint,
  bhws_inactive bigint,
  open_referrals bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'admin_overview: admin role required';
  end if;

  return query
    select
      f.facility_id,
      f.name,
      -- Captains and BHWs sit on a barangay health station, not on the DOTS
      -- centre, so they are counted through the catchment that refers here (0022).
      (select count(*) from public.users u
         join public.ref_barangays b on b.barangay_code = u.assigned_barangay_code
         join public.ref_cities c on c.city_code = b.city_code
        where u.role = 'captain' and u.active
          and c.default_facility_id = f.facility_id),
      (select count(*) from public.users u
         join public.ref_barangays b on b.barangay_code = u.assigned_barangay_code
         join public.ref_cities c on c.city_code = b.city_code
        where u.role = 'captain' and not u.active
          and c.default_facility_id = f.facility_id),
      (select count(*) from public.users u
         join public.ref_barangays b on b.barangay_code = u.assigned_barangay_code
         join public.ref_cities c on c.city_code = b.city_code
        where u.role = 'bhw' and u.active
          and c.default_facility_id = f.facility_id),
      (select count(*) from public.users u
         join public.ref_barangays b on b.barangay_code = u.assigned_barangay_code
         join public.ref_cities c on c.city_code = b.city_code
        where u.role = 'bhw' and not u.active
          and c.default_facility_id = f.facility_id),
      -- Unchanged: referrals are addressed to a TB-DOTS facility directly.
      (select count(*) from public.referrals r
        where r.facility_id = f.facility_id and r.status <> 'closed')
    from public.facilities f
    where f.type = 'tb_dots'
    order by f.name;
end;
$function$;

comment on function public.admin_overview() is
  'Per-facility admin summary. captains/bhws count ACTIVE accounts; '
  '*_inactive count deactivated ones (0023). Counts only, never patient rows.';

-- DROP discarded these, so restate them to match every other RPC in the schema.
grant execute on function public.admin_overview() to anon, authenticated, service_role;
