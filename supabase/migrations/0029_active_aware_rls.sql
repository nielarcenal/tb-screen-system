-- ============================================================================
-- TB-Screen BHW — 0029_active_aware_rls.sql
-- BASE-06: deactivating an account does not revoke its row access.
--
-- THE DEFECT. 0028 made every RPC gate active-aware, but the row policies were
-- deliberately left alone — the blast radius needed its own unit. This is that
-- unit.
--
-- Every clinical policy in this schema gates on public.current_user_role():
--
--     select role from public.users where user_id = auth.uid();
--
-- with no reference to users.active. 0006 added that column and manage-bhw sets
-- it false to ban an account, but the ban is enforced by the CLIENTS — the
-- portal's AccountStateGate and the phone's accountGate. A deactivated user
-- holding an unexpired access token, or anyone replaying that token outside the
-- app, keeps full scoped read/write on patients, screenings, referrals and
-- appointments until the token expires. A client-side boundary is not a
-- boundary; the baseline audit said so about this exact column.
--
-- WHAT THIS MIGRATION DOES
--   1. Makes the identity helpers active-aware, so a deactivated caller has no
--      role, no facility and no barangay.
--   2. Moves the four ENUMERATING helpers into `app_private`, a schema
--      PostgREST does not expose, and gives them their own active-role check
--      (R3-05). In `public` they are reachable as RPCs today: any authenticated
--      caller can ask referred_patient_ids() for a facility's whole patient
--      list without going through a single policy.
--   3. Rewrites all 28 clinical policies onto current_user_active_role().
--   4. Closes current_user_role() as a trap by delegating it to the
--      active-aware helper, so a future policy written with the old name is
--      still safe.
--
-- ---------------------------------------------------------------------------
-- THE ONE DELIBERATE CARVE-OUT: an account may always read its OWN users row.
--
-- This is not a compromise, and getting it wrong makes the ban WEAKER rather
-- than stronger. Both clients discover that they have been deactivated by
-- reading their own row and inspecting `active`:
--
--   web/src/App.tsx:143            if (!user.active) setMeState('inactive')
--   mobile/src/lib/accountGate.ts  selects role, active -> evaluateAccountAccess
--
-- RLS does not raise; it filters. A refused self-read therefore returns
-- `data: null, error: null` — indistinguishable from "no such row". And
-- mobile/src/domain/accountAccess.ts maps a missing row under the `unknown`
-- policy to `{ kind: 'unknown' }`, which its own comment describes as
-- "blocks nothing and revokes nothing". So hiding the row from a deactivated
-- BHW would stop the phone from ever recording the denial, and the persistent
-- refusal that survives a force-stop (the A54 bypass
-- accountGate.ts documents) would never be written.
--
-- The correct boundary is: a ban is about OTHER people's data, never about
-- your own account record. You may always learn your own state; you may not
-- read a colleague's row, you may not write your own, and you may not touch a
-- single clinical row.
--
-- So users_read_same_facility keeps its `user_id = auth.uid()` arm ungated and
-- gains the active check only on the colleague arm. users_update_self is gated
-- — pushAssignedBarangayIfDirty (syncManager.ts:137) is precisely the write a
-- deactivated account must not make.
-- ---------------------------------------------------------------------------
--
-- KNOWN CONSEQUENCE, stated rather than discovered later: a BHW deactivated
-- while holding queued offline writes can no longer push them. Before this
-- migration those writes still synced, because the ban was client-side only.
--
-- Nothing is lost. The rejected rows raise 42501, which syncErrors.ts classifies
-- PERMANENT, so they stay `pending` and the pass continues (0020 relies on the
-- same behaviour). Where the BHW actually meets it is sign-out: signOutFlow.ts
-- counts pending rows after its final sync and refuses to wipe the cache while
-- any remain, telling them how many records could not be uploaded and letting
-- them stay signed in. Reactivating the account lets the queue through.
--
-- That is the intended meaning of a ban, and the existing flow already handles
-- it safely — but it is a real operational change and support should know that
-- deactivating a BHW mid-shift strands whatever they have not yet synced.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * It does not shorten the JWT lifetime. That is a Supabase project setting,
--     not schema, and it is a defence in depth rather than the fix.
--   * It does not touch BASE-04 (barangay_report's timezone handling).
--   * It does not touch the ref_* tables. Their policies are
--     `for select to authenticated using (true)` on seeded PSGC reference data
--     — no role predicate to fix, and nothing about a person in them.
--   * It does not touch facilities_read, for the same reason: `using (true)`,
--     and a BHW must be able to name a receiving facility. Nothing in it is
--     patient data.
--   * It adds no new table, column, or client capability.
--
-- HOW TO VERIFY AND APPLY, exactly as 0028 (M28-03):
--     node scripts/build-preflight.mjs 0029
--   writes supabase/tests/0029_preflight.generated.sql =
--     begin; <this file> <supabase/tests/0029_rls_row_matrix.sql> rollback;
--   Run that whole file in the SQL editor. It always rolls back. Every row must
--   read PASS. Only then apply this file inside begin; … commit;
--
--   This migration REQUIRES 0028 to be applied first: it calls
--   public.current_user_active_role(), which 0028 creates.
--
-- The 28 policies are restated below because CREATE POLICY takes a whole
-- expression. Each is copied verbatim from its current source; the only
-- intended differences are the helper name and, for the four enumerating
-- helpers, the schema. `node scripts/verify-0029-policies.mjs` proves that
-- mechanically, the way verify-0028-bodies.mjs does for function bodies.
--
-- POSITIONING (§1, §5) unchanged: no new data, no scoring, no new capability.
-- ============================================================================

-- No `begin;` / `commit;` here, deliberately — the preflight wraps this file in
-- a transaction it can roll back. See 0028's header for why.

-- ---------------------------------------------------------------------------
-- 0. Guard: this migration is meaningless without 0028.
-- ---------------------------------------------------------------------------
do $guard$
begin
  if to_regprocedure('public.current_user_active_role()') is null then
    raise exception
      '0029 requires migration 0028 (current_user_active_role) to be applied first';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------------
-- 1. The private schema for enumerating helpers.
--
-- PostgREST exposes only the schemas it is configured with (public, and
-- whatever else the project lists). `app_private` is not among them, so nothing
-- here is reachable as an RPC. A policy expression, however, is evaluated as
-- the querying user, so `authenticated` still needs USAGE and EXECUTE.
-- ---------------------------------------------------------------------------
create schema if not exists app_private;

revoke all on schema app_private from public;
revoke all on schema app_private from anon;
grant  usage on schema app_private to authenticated;

comment on schema app_private is
  'Helpers that RLS policies call but no client may call directly. PostgREST '
  'does not expose this schema (0029). Enumerating helpers belong here: in '
  'public they are RPCs that return other people''s row ids without passing '
  'through a single policy.';

-- ---------------------------------------------------------------------------
-- 2. Identity helpers — active-aware.
--
-- Each returns NULL for an anonymous caller, a caller with no public.users row,
-- and a deactivated account. Every use in a policy is an equality comparison,
-- and `x = NULL` is NULL, which RLS treats as "no", so NULL fails closed
-- everywhere these appear.
-- ---------------------------------------------------------------------------
create or replace function public.current_user_facility()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select facility_id from public.users
   where user_id = auth.uid()
     and active;
$$;

comment on function public.current_user_facility() is
  'Facility of the calling user, or NULL if there is no JWT, no public.users '
  'row, or the account is deactivated (0029). Fails closed in every policy '
  'that compares against it.';

create or replace function public.current_user_barangay()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select assigned_barangay_code from public.users
   where user_id = auth.uid()
     and active;
$$;

comment on function public.current_user_barangay() is
  'Assigned barangay of the calling user, or NULL if there is no JWT, no '
  'public.users row, or the account is deactivated (0029).';

-- current_user_role() is now a deprecated alias. 0028 introduced the explicit
-- name and re-gated every function onto it; this migration moves every policy.
-- Nothing in the repository should call this any more — but the migrations here
-- have been hand-applied, so dropping it could break a live object this file
-- cannot see. Delegating instead closes the trap without that risk: a future
-- policy written with the old name is still active-aware.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_active_role();
$$;

comment on function public.current_user_role() is
  'DEPRECATED (0029) — an alias for current_user_active_role(). It was the '
  'non-active-aware helper behind BASE-06. Kept, and made safe, only because a '
  'hand-applied live schema may hold a reference this migration cannot see. '
  'Use current_user_active_role() in new code. Remove once POST-CHECK 4 '
  'reports no dependants.';

-- ---------------------------------------------------------------------------
-- 3. Enumerating helpers — moved to app_private, and role-gated.
--
-- These four answer "which row ids may I see". In public they are callable:
-- `select * from referred_patient_ids()` hands any authenticated caller a
-- facility's entire patient id list with no policy in the way (R3-05, and the
-- same defect already corrected for the sole-facility helper under R2-06).
--
-- Each now checks the caller's active role itself, so it returns nothing to a
-- deactivated, unprovisioned or wrong-role caller even if it is somehow
-- reached.
-- ---------------------------------------------------------------------------
create or replace function app_private.referred_patient_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select patient_id from public.referrals
   where public.current_user_active_role() = 'tb_dots'
     and facility_id = public.current_user_facility();
$$;

create or replace function app_private.referred_screening_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select screening_id from public.referrals
   where public.current_user_active_role() = 'tb_dots'
     and facility_id = public.current_user_facility();
$$;

create or replace function app_private.bhw_visible_patient_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select patient_id from public.patients
   where public.current_user_active_role() = 'bhw'
     and (barangay_code = public.current_user_barangay()
          or enrolled_by = auth.uid());
$$;

create or replace function app_private.own_enrolled_patient_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select patient_id from public.patients
   where public.current_user_active_role() is not null
     and enrolled_by = auth.uid();
$$;

revoke all on function app_private.referred_patient_ids()     from public, anon, service_role;
revoke all on function app_private.referred_screening_ids()   from public, anon, service_role;
revoke all on function app_private.bhw_visible_patient_ids()  from public, anon, service_role;
revoke all on function app_private.own_enrolled_patient_ids() from public, anon, service_role;

grant execute on function app_private.referred_patient_ids()     to authenticated;
grant execute on function app_private.referred_screening_ids()   to authenticated;
grant execute on function app_private.bhw_visible_patient_ids()  to authenticated;
grant execute on function app_private.own_enrolled_patient_ids() to authenticated;

-- The public originals become thin, UNCALLABLE wrappers rather than being
-- dropped. dashboard_counts() (0018, re-gated by 0028) calls
-- public.referred_patient_ids() in its body; dropping it would mean restating
-- that function a second time, and every restatement is another chance to
-- mistype a reporting query. As SECURITY DEFINER owned by the migration role it
-- keeps EXECUTE through ownership, while every client role loses it — so the
-- RPC surface closes without touching 0028's verified bodies.
create or replace function public.referred_patient_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$ select * from app_private.referred_patient_ids(); $$;

create or replace function public.referred_screening_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$ select * from app_private.referred_screening_ids(); $$;

create or replace function public.bhw_visible_patient_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$ select * from app_private.bhw_visible_patient_ids(); $$;

create or replace function public.own_enrolled_patient_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$ select * from app_private.own_enrolled_patient_ids(); $$;

comment on function public.referred_patient_ids() is
  'DEPRECATED (0029) — delegates to app_private.referred_patient_ids(). Client '
  'EXECUTE is revoked; it survives only for SECURITY DEFINER callers inside the '
  'database. New policies must call the app_private function.';

revoke all on function public.referred_patient_ids()     from public, anon, authenticated, service_role;
revoke all on function public.referred_screening_ids()   from public, anon, authenticated, service_role;
revoke all on function public.bhw_visible_patient_ids()  from public, anon, authenticated, service_role;
revoke all on function public.own_enrolled_patient_ids() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. users — the carve-out lives here. Read the header before changing this.
-- ---------------------------------------------------------------------------

-- Self-read stays ungated: an account must always be able to learn its own
-- state, and both clients depend on it to distinguish "deactivated" from
-- "no profile". The colleague arm is gated.
drop policy if exists users_read_same_facility on public.users;
create policy users_read_same_facility on public.users
  for select to authenticated
  using (
    user_id = auth.uid()
    or (public.current_user_active_role() is not null
        and facility_id = public.current_user_facility())
  );

comment on policy users_read_same_facility on public.users is
  'Own row always; a colleague''s row only while the account is active (0029). '
  'The self-read is deliberately ungated — the portal and the phone both learn '
  'they were deactivated by reading this row, and RLS filters rather than '
  'raising, so hiding it would read as "no account" and, on mobile, would stop '
  'the denial being recorded at all.';

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
  for update to authenticated
  using (public.current_user_active_role() is not null and user_id = auth.uid())
  with check (public.current_user_active_role() is not null and user_id = auth.uid());

drop policy if exists users_tbdots_read_bhws on public.users;
create policy users_tbdots_read_bhws on public.users
  for select to authenticated
  using (
    public.current_user_active_role() = 'tb_dots'
    and role = 'bhw'
  );

drop policy if exists users_admin_read on public.users;
create policy users_admin_read on public.users
  for select to authenticated
  using (public.current_user_active_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 5. facilities — admin write only. facilities_read (0002) is untouched.
-- ---------------------------------------------------------------------------
drop policy if exists facilities_admin_insert on public.facilities;
create policy facilities_admin_insert on public.facilities
  for insert to authenticated
  with check (public.current_user_active_role() = 'admin');

drop policy if exists facilities_admin_update on public.facilities;
create policy facilities_admin_update on public.facilities
  for update to authenticated
  using (public.current_user_active_role() = 'admin')
  with check (public.current_user_active_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 6. patients
-- ---------------------------------------------------------------------------
drop policy if exists patients_bhw_read on public.patients;
create policy patients_bhw_read on public.patients
  for select to authenticated
  using (
    public.current_user_active_role() = 'bhw'
    and (
      barangay_code = public.current_user_barangay()
      or enrolled_by = auth.uid()
    )
  );

drop policy if exists patients_bhw_insert on public.patients;
create policy patients_bhw_insert on public.patients
  for insert to authenticated
  with check (
    public.current_user_active_role() = 'bhw'
    and enrolled_by = auth.uid()
  );

drop policy if exists patients_bhw_update on public.patients;
create policy patients_bhw_update on public.patients
  for update to authenticated
  using (
    public.current_user_active_role() = 'bhw'
    and (
      barangay_code = public.current_user_barangay()
      or enrolled_by = auth.uid()
    )
  );

drop policy if exists patients_tbdots_read on public.patients;
create policy patients_tbdots_read on public.patients
  for select to authenticated
  using (
    public.current_user_active_role() = 'tb_dots'
    and (
      patient_id in (select app_private.referred_patient_ids())
      or enrolled_by = auth.uid()
    )
  );

drop policy if exists patients_tbdots_insert on public.patients;
create policy patients_tbdots_insert on public.patients
  for insert to authenticated
  with check (
    public.current_user_active_role() = 'tb_dots'
    and enrolled_by = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- 7. screenings
-- ---------------------------------------------------------------------------
drop policy if exists screenings_bhw_read on public.screenings;
create policy screenings_bhw_read on public.screenings
  for select to authenticated
  using (
    public.current_user_active_role() = 'bhw'
    and patient_id in (select app_private.bhw_visible_patient_ids())
  );

drop policy if exists screenings_bhw_insert on public.screenings;
create policy screenings_bhw_insert on public.screenings
  for insert to authenticated
  with check (
    public.current_user_active_role() = 'bhw'
    and patient_id in (select app_private.bhw_visible_patient_ids())
  );

drop policy if exists screenings_bhw_update on public.screenings;
create policy screenings_bhw_update on public.screenings
  for update to authenticated
  using (
    public.current_user_active_role() = 'bhw'
    and patient_id in (select app_private.bhw_visible_patient_ids())
  );

drop policy if exists screenings_tbdots_read on public.screenings;
create policy screenings_tbdots_read on public.screenings
  for select to authenticated
  using (
    public.current_user_active_role() = 'tb_dots'
    and (
      screening_id in (select app_private.referred_screening_ids())
      or patient_id in (select app_private.own_enrolled_patient_ids())
    )
  );

drop policy if exists screenings_tbdots_insert on public.screenings;
create policy screenings_tbdots_insert on public.screenings
  for insert to authenticated
  with check (
    public.current_user_active_role() = 'tb_dots'
    and patient_id in (select app_private.own_enrolled_patient_ids())
  );

-- ---------------------------------------------------------------------------
-- 8. referrals
-- ---------------------------------------------------------------------------
drop policy if exists referrals_bhw_read on public.referrals;
create policy referrals_bhw_read on public.referrals
  for select to authenticated
  using (
    public.current_user_active_role() = 'bhw'
    and patient_id in (select app_private.bhw_visible_patient_ids())
  );

drop policy if exists referrals_bhw_insert on public.referrals;
create policy referrals_bhw_insert on public.referrals
  for insert to authenticated
  with check (
    public.current_user_active_role() = 'bhw'
    and patient_id in (select app_private.bhw_visible_patient_ids())
  );

drop policy if exists referrals_bhw_update on public.referrals;
create policy referrals_bhw_update on public.referrals
  for update to authenticated
  using (
    public.current_user_active_role() = 'bhw'
    and patient_id in (select app_private.bhw_visible_patient_ids())
    -- Still exactly as the BHW submitted it: the facility has not received,
    -- tested or closed it, and no result has been recorded.
    and status = 'submitted'
    and result is null
    and result_date is null
    and presented is null
  )
  with check (
    public.current_user_active_role() = 'bhw'
    and patient_id in (select app_private.bhw_visible_patient_ids())
    -- ...and it must stay that way. A BHW cannot record or fabricate a result.
    and status = 'submitted'
    and result is null
    and result_date is null
    and presented is null
  );

comment on policy referrals_bhw_update on public.referrals is
  'Retry path only: lets a BHW re-push a referral whose INSERT reply was lost. '
  'Active accounts only (0029).';

drop policy if exists referrals_tbdots_read on public.referrals;
create policy referrals_tbdots_read on public.referrals
  for select to authenticated
  using (
    public.current_user_active_role() = 'tb_dots'
    and facility_id = public.current_user_facility()
  );

drop policy if exists referrals_tbdots_update on public.referrals;
create policy referrals_tbdots_update on public.referrals
  for update to authenticated
  using (
    public.current_user_active_role() = 'tb_dots'
    and facility_id = public.current_user_facility()
  )
  with check (facility_id = public.current_user_facility());

drop policy if exists referrals_tbdots_insert on public.referrals;
create policy referrals_tbdots_insert on public.referrals
  for insert to authenticated
  with check (
    public.current_user_active_role() = 'tb_dots'
    and facility_id = public.current_user_facility()
    and patient_id in (select app_private.own_enrolled_patient_ids())
  );

-- ---------------------------------------------------------------------------
-- 9. appointments
--
-- These stay patient-wide (BASE-02). 0030 gives them their own facility
-- ownership; this migration only closes the deactivation hole, and deliberately
-- does not smuggle an ownership change into a security fix.
-- ---------------------------------------------------------------------------
drop policy if exists appointments_bhw_read on public.appointments;
create policy appointments_bhw_read on public.appointments
  for select to authenticated
  using (
    public.current_user_active_role() = 'bhw'
    and patient_id in (select app_private.bhw_visible_patient_ids())
  );

drop policy if exists appointments_bhw_insert on public.appointments;
create policy appointments_bhw_insert on public.appointments
  for insert to authenticated
  with check (
    public.current_user_active_role() = 'bhw'
    and patient_id in (select app_private.bhw_visible_patient_ids())
  );

drop policy if exists appointments_bhw_update on public.appointments;
create policy appointments_bhw_update on public.appointments
  for update to authenticated
  using (
    public.current_user_active_role() = 'bhw'
    and patient_id in (select app_private.bhw_visible_patient_ids())
  );

drop policy if exists appointments_tbdots_read on public.appointments;
create policy appointments_tbdots_read on public.appointments
  for select to authenticated
  using (
    public.current_user_active_role() = 'tb_dots'
    and patient_id in (select app_private.referred_patient_ids())
  );

drop policy if exists appointments_tbdots_update on public.appointments;
create policy appointments_tbdots_update on public.appointments
  for update to authenticated
  using (
    public.current_user_active_role() = 'tb_dots'
    and patient_id in (select app_private.referred_patient_ids())
  );

drop policy if exists appointments_tbdots_insert on public.appointments;
create policy appointments_tbdots_insert on public.appointments
  for insert to authenticated
  with check (
    public.current_user_active_role() = 'tb_dots'
    and patient_id in (select app_private.referred_patient_ids())
  );

-- ============================================================================
-- POST-CHECKS (run separately — the SQL editor returns only the last result).
--
-- 1. No policy still calls the deprecated helper directly. It is safe now
--    (§2 delegates it), but a hit means a policy this migration did not cover:
--
--    select tablename, policyname, cmd
--      from pg_policies
--     where schemaname = 'public'
--       and (coalesce(qual, '') like '%current_user_role%'
--         or coalesce(with_check, '') like '%current_user_role%')
--     order by 1, 2;
--
--    Expect 0 rows.
--
-- 2. No policy reaches an enumerating helper through `public` any more:
--
--    select tablename, policyname
--      from pg_policies
--     where schemaname = 'public'
--       and (coalesce(qual, '') || coalesce(with_check, ''))
--           ~ 'public\.(referred_patient_ids|referred_screening_ids|bhw_visible_patient_ids|own_enrolled_patient_ids)'
--     order by 1, 2;
--
--    Expect 0 rows.
--
-- 3. The public wrappers are not client-callable, and the app_private ones are
--    not reachable by anon. Use the LEFT JOIN form for the same reason as
--    0028's POST-CHECK 1 — PUBLIC is grantee OID 0 and has no pg_roles row:
--
--    select n.nspname, p.proname,
--           coalesce(r.rolname, 'PUBLIC') as grantee, a.privilege_type
--      from pg_proc p
--      join pg_namespace n on n.oid = p.pronamespace
--      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
--      left join pg_roles r on r.oid = a.grantee
--     where p.proname in ('referred_patient_ids','referred_screening_ids',
--                         'bhw_visible_patient_ids','own_enrolled_patient_ids')
--     order by 1, 2, 3;
--
--    Expect: app_private rows granted to `authenticated` only; public rows with
--    NO anon, authenticated, service_role or PUBLIC grant at all (owner only).
--
-- 4. Dependants of the deprecated helper, before any future migration drops it:
--
--    select p.proname
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.prosrc like '%current_user_role()%'
--       and p.proname <> 'current_user_role';
--
--    Expect 0 rows once 0028 is applied. A non-empty result is the reason this
--    migration delegated the function instead of dropping it.
--
-- 5. The behaviour matrix: supabase/tests/0029_rls_row_matrix.sql, run through
--    the generated preflight. It asserts, per persona and per table, how many
--    rows are visible and which writes succeed — including the carve-out (a
--    deactivated account still reads its own users row) and its limit (it reads
--    no colleague row, writes nothing, and sees no clinical row).
--
-- 6. Policy transcription: `node scripts/verify-0029-policies.mjs` must print
--    OK for all 28. It compares each policy expression against its source
--    migration, normalising only the helper rename and the app_private move.
-- ============================================================================
