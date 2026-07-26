-- ============================================================================
-- TB-Screen BHW — 0012_admin_overview.sql
-- Admin dashboard data (developer portal): program-wide facility coverage —
-- per TB-DOTS facility, how many captains and BHWs are attached and how many
-- referrals are still open. The dashboard tiles are summed from these rows.
--
-- Why SECURITY DEFINER: admins have NO patient/referral read policies (by
-- design — nothing clinical renders in the developer portal). The open-referral
-- counts must cross that boundary here, returning COUNTS ONLY: no patient rows,
-- no referral rows, nothing diagnostic (§1). Same anti-recursion pattern as
-- bhw_activity()/hotspot_counts().
-- ============================================================================
create or replace function public.admin_overview()
returns table (
  facility_id    uuid,
  facility_name  text,
  captains       bigint,
  bhws           bigint,
  open_referrals bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'admin_overview: admin role required';
  end if;

  return query
    select
      f.facility_id,
      f.name,
      (select count(*) from public.users u
        where u.facility_id = f.facility_id and u.role = 'captain'),
      (select count(*) from public.users u
        where u.facility_id = f.facility_id and u.role = 'bhw'),
      (select count(*) from public.referrals r
        where r.facility_id = f.facility_id and r.status <> 'closed')
    from public.facilities f
    where f.type = 'tb_dots'
    order by f.name;
end;
$$;

comment on function public.admin_overview() is
  'Program-wide facility coverage for the admin developer portal (dashboard '
  'tiles + coverage list). Admin role required; SECURITY DEFINER to count '
  'referrals admins cannot read directly; returns counts only, no patient data.';
