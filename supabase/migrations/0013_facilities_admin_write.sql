-- ============================================================================
-- TB-Screen BHW — 0013_facilities_admin_write.sql
-- Let the system administrator create and edit TB-DOTS facility records from
-- the developer portal. Until now facilities were seeded/administered only
-- (0002: read open to all authenticated, no client writes).
--
-- Admins hold no patient policies; a facility row is name/type/address only —
-- nothing clinical. No DELETE policy: facilities are referenced by users and
-- referrals foreign keys, so removal stays a deliberate DB operation.
-- ============================================================================
drop policy if exists facilities_admin_insert on public.facilities;
create policy facilities_admin_insert on public.facilities
  for insert to authenticated
  with check (public.current_user_role() = 'admin');

drop policy if exists facilities_admin_update on public.facilities;
create policy facilities_admin_update on public.facilities
  for update to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
