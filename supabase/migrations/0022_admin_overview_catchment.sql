-- ============================================================================
-- TB-Screen BHW — 0022_admin_overview_catchment.sql
--
-- Fixes admin_overview() so the developer portal stops reporting the entire
-- captain and BHW workforce as zero.
--
-- WHY. The function counted personnel by matching users.facility_id against
-- the facility row it was already iterating:
--
--     (select count(*) from public.users u
--       where u.facility_id = f.facility_id and u.role = 'captain')
--
-- while the outer query iterates `where f.type = 'tb_dots'`. But captains and
-- BHWs are never attached to a TB-DOTS centre — by the system's own wiring they
-- sit on a barangay_health_station (a captain shares their BHWs' station so
-- bhw_activity, which scopes by barangay, can see them). The two predicates are
-- therefore mutually exclusive, and both counts are structurally 0 for every
-- row, in every deployment, no matter how many people are enrolled.
--
-- Measured live before the change (2026-09-02): public.users held 1 captain and
-- 5 BHWs, all active, all with a facility_id; every one on
-- "Casisang Barangay Health Station" (type barangay_health_station). All 11
-- coverage rows rendered "0 captains, 0 BHWs", and the summary tiles — which
-- AdminDashboard.tsx computes by summing those rows — read 0 and 0 beneath the
-- labels "across the program" and "across all facilities". The same portal's
-- Captain management screen, which queries users directly, correctly showed 1.
--
-- WHAT REPLACES IT. ref_cities.default_facility_id already maps a city to its
-- DOTS centre — it is the mapping that routes a BHW's referral to the right
-- facility. Routing personnel the same way makes "per facility" mean the same
-- thing for all three columns: the catchment that refers into that centre.
--
--     users.assigned_barangay_code -> ref_barangays.city_code
--                                  -> ref_cities.default_facility_id
--
-- Verified against live data before writing this file. The corrected join
-- yields Malaybalay City DOTS 1 captain / 2 BHWs and Valencia City DOTS
-- 0 / 3 — totalling exactly the 1 and 5 that public.users holds.
--
-- The open_referrals column is NOT touched. referrals.facility_id genuinely
-- addresses a TB-DOTS facility, so that count was already correct (4 open at
-- Malaybalay City, matching the portal).
--
-- DELIBERATELY UNCHANGED, so this migration stays one idea:
--   * No active/inactive filter. The previous function counted deactivated
--     accounts too; preserving that keeps the change to the join alone. If
--     these tiles should exclude deactivated staff, that is a separate call.
--   * The summary tiles remain a client-side sum of the returned rows
--     (AdminDashboard.tsx). A user whose assigned_barangay_code is null, or
--     whose city has no default_facility_id, therefore appears in no row and
--     in no total. Measured live: 0 such captains or BHWs today. If that stops
--     being true the tiles under-report again, and the totals need their own
--     query rather than a sum.
--
-- NOT ENFORCEMENT. This is a reporting correction. It changes no policy, grants
-- no access and moves no data; admin_overview() stays SECURITY DEFINER with the
-- same admin-role guard, and admins still read counts only, never patient or
-- referral rows.
-- ============================================================================

create or replace function public.admin_overview()
returns table(
  facility_id uuid,
  facility_name text,
  captains bigint,
  bhws bigint,
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
      -- centre, so they are counted through the catchment that refers here.
      (select count(*) from public.users u
         join public.ref_barangays b on b.barangay_code = u.assigned_barangay_code
         join public.ref_cities c on c.city_code = b.city_code
        where u.role = 'captain'
          and c.default_facility_id = f.facility_id),
      (select count(*) from public.users u
         join public.ref_barangays b on b.barangay_code = u.assigned_barangay_code
         join public.ref_cities c on c.city_code = b.city_code
        where u.role = 'bhw'
          and c.default_facility_id = f.facility_id),
      -- Unchanged: referrals are addressed to a TB-DOTS facility directly.
      (select count(*) from public.referrals r
        where r.facility_id = f.facility_id and r.status <> 'closed')
    from public.facilities f
    where f.type = 'tb_dots'
    order by f.name;
end;
$function$;

-- ----------------------------------------------------------------------------
-- Rollback — restores the facility_id match, and with it the permanent zeros:
--
--   create or replace function public.admin_overview()
--   returns table(facility_id uuid, facility_name text, captains bigint,
--                 bhws bigint, open_referrals bigint)
--   language plpgsql stable security definer set search_path to 'public'
--   as $function$
--   begin
--     if public.current_user_role() <> 'admin' then
--       raise exception 'admin_overview: admin role required';
--     end if;
--     return query
--       select f.facility_id, f.name,
--         (select count(*) from public.users u
--           where u.facility_id = f.facility_id and u.role = 'captain'),
--         (select count(*) from public.users u
--           where u.facility_id = f.facility_id and u.role = 'bhw'),
--         (select count(*) from public.referrals r
--           where r.facility_id = f.facility_id and r.status <> 'closed')
--       from public.facilities f
--       where f.type = 'tb_dots'
--       order by f.name;
--   end;
--   $function$;
-- ----------------------------------------------------------------------------
