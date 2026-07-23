-- ============================================================================
-- TB-Screen BHW — 0008_admin_role_captain_barangay.sql
-- (user decision, 2026-07-08)
--
-- 1. New 'admin' role: the developer/provisioning account. Admins manage
--    CAPTAIN accounts through the manage-bhw Edge Function (service role does
--    the writes) and may read all users rows to list them. Admins have NO
--    patient-data policies — like captains, they can read no patient rows.
--
-- 2. Captains are now scoped to their ASSIGNED BARANGAY, not their facility:
--    a captain may only see/manage BHWs of their own barangay, so captains
--    from other barangays cannot add or touch BHWs outside their area.
--    (Enforced both here in bhw_activity() and in the manage-bhw function.)
-- ============================================================================

alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check check (role in ('bhw','tb_dots','captain','admin'));

-- Admin: read every users row (account management list). No write policies —
-- all writes go through the Edge Function with the service role.
drop policy if exists users_admin_read on public.users;
create policy users_admin_read on public.users
  for select to authenticated
  using (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- bhw_activity(): captain's list, now scoped by BARANGAY (was: facility).
-- Same output shape as 0006 — the portal is unchanged.
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
  if public.current_user_barangay() is null then
    raise exception 'bhw_activity: captain has no assigned barangay';
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
    and u.assigned_barangay_code = public.current_user_barangay()
  order by u.full_name;
end;
$$;

comment on function public.bhw_activity(int) is
  'Per-BHW account + activity counts for the Barangay-Captain view. Captain '
  'role required; scoped to the caller''s ASSIGNED BARANGAY (0008); no patient data.';
