-- =============================================================================
-- TB-Screen BHW — 0026_rename_captain_to_midwife.sql
--
-- WHY: the role that supervises a barangay's BHWs was modelled as the Barangay
-- Captain, which is wrong. In the DOH structure the BHWs of a barangay report
-- to the MIDWIFE who staffs the Barangay Health Station; the Barangay Captain
-- is a local-government official with no line authority over them. Nothing the
-- role DOES changes here — same barangay scope, same "no patient data ever"
-- rule, same BHW provisioning powers. Only who it represents changes, so this
-- is a pure rename of the value 'captain' → 'midwife'.
--
-- WHAT IT TOUCHES (the complete set — verified against the live schema, not
-- against the migration files, which have been hand-applied before):
--   1. users.role values + the users_role_check CHECK constraint.
--   2. bhw_activity()  — role gate + error text. Signature unchanged.
--   3. admin_overview() — role filter AND two OUT column names
--      (captains/captains_inactive → midwives/midwives_inactive). Renaming an
--      OUT column is a signature change, so this one needs DROP + CREATE, and
--      DROP discards the function's grants — they are restated below.
-- No RLS policy, view, trigger or column default mentions the old value.
--
-- MUST SHIP WITH: the redeployed `manage-bhw` Edge Function (it rejects any
-- caller whose role is not 'captain'/'admin') and the rebuilt portals. Applying
-- this alone locks the midwife out of BHW management.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The role value itself.
--    Constraint comes off first: it still forbids 'midwife' while the update
--    is running, and re-adding it afterwards re-validates every row anyway.
-- ---------------------------------------------------------------------------
alter table public.users drop constraint if exists users_role_check;

update public.users set role = 'midwife' where role = 'captain';

alter table public.users
  add constraint users_role_check
  check (role in ('bhw','tb_dots','midwife','admin'));

-- ---------------------------------------------------------------------------
-- 2. bhw_activity() — the midwife's "My BHWs" list, scoped by BARANGAY (0008);
--    admins call it unscoped. Body is unchanged apart from the role name.
-- ---------------------------------------------------------------------------
create or replace function public.bhw_activity(days_back integer default 30)
returns table (
  user_id uuid, full_name text, first_name text, middle_name text,
  last_name text, purok text, email text, barangay_code text,
  barangay_name text, joined_at timestamptz, active boolean,
  screenings_n bigint, referrals_n bigint
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
  if v_role = 'midwife' then
    v_scope := public.current_user_barangay();
    if v_scope is null then
      raise exception 'bhw_activity: midwife has no assigned barangay';
    end if;
  elsif v_role = 'admin' then
    v_scope := null;  -- unscoped by design; see header
  else
    raise exception 'bhw_activity: midwife or admin role required';
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
    and (v_scope is null or u.assigned_barangay_code = v_scope)  -- 0008 scope for midwives
  order by u.full_name;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. admin_overview() — per-facility coverage counts. DROP first: the OUT
--    columns `captains`/`captains_inactive` are being renamed, which
--    CREATE OR REPLACE cannot do.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_overview();

create function public.admin_overview()
returns table (
  facility_id uuid, facility_name text, midwives bigint,
  midwives_inactive bigint, bhws bigint, bhws_inactive bigint,
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
      -- Midwives and BHWs sit on a barangay health station, not on the DOTS
      -- centre, so they are counted through the catchment that refers here (0022).
      (select count(*) from public.users u
         join public.ref_barangays b on b.barangay_code = u.assigned_barangay_code
         join public.ref_cities c on c.city_code = b.city_code
        where u.role = 'midwife' and u.active
          and c.default_facility_id = f.facility_id),
      (select count(*) from public.users u
         join public.ref_barangays b on b.barangay_code = u.assigned_barangay_code
         join public.ref_cities c on c.city_code = b.city_code
        where u.role = 'midwife' and not u.active
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

-- DROP discarded these; the pre-0026 ACL was PUBLIC + anon + authenticated +
-- service_role, all EXECUTE. PUBLIC is restored by CREATE itself. The function
-- is SECURITY DEFINER but gates on the admin role internally (line 1 of body).
grant execute on function public.admin_overview() to anon, authenticated, service_role;

commit;
