-- ============================================================================
-- TB-Screen BHW — 0028_null_safe_role_gates.sql
-- BASE-01: the reporting role gates fail OPEN for a caller with no role.
--
-- THE DEFECT. public.current_user_role() (0002) is
--
--     select role from public.users where user_id = auth.uid();
--
-- which returns NULL for two real callers: an anonymous request (auth.uid() is
-- null), and an authenticated request whose account has no public.users row.
-- Both of the gates below then evaluate to NULL rather than to true:
--
--     0027 barangay_report:  if current_user_role() not in ('tb_dots','admin')
--     0026 admin_overview:   if current_user_role() <> 'admin'
--
-- and PL/pgSQL treats a NULL condition as "not true", so the IF body never
-- runs, the exception is never raised, and the SECURITY DEFINER query executes
-- with the function owner's privileges. admin_overview() additionally carries
-- an explicit `grant execute ... to anon` (0026 line 164), so the anonymous
-- path is reachable from the public API, not just in theory.
--
-- What that exposes is aggregate program and staffing data, not patient rows.
-- It is still a broken authorization boundary and it is fixed here.
--
-- THE SECOND DEFECT, same class. No gate in this schema checks users.active.
-- 0006 added the column and account management sets it false to ban an account,
-- but a deactivated user holding an unexpired JWT still satisfies every gate
-- until that token expires. `current_user_role()` was never active-aware, and
-- the clients are what enforce the ban today. That is a client-side boundary,
-- so it is not a boundary.
--
-- WHAT THIS MIGRATION DOES
--   1. Adds public.current_user_active_role(), which returns NULL for all three
--      cases at once: anonymous, no profile row, deactivated.
--   2. Re-gates every client-callable SECURITY DEFINER function that makes a
--      role decision, null-safely and active-aware.
--   3. Restates the function ACLs explicitly, following 0019's finding that
--      Supabase's default privileges grant EXECUTE to `anon` by name, so
--      `revoke ... from public` alone does not remove it.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * It does not change current_user_role() itself. That helper is consulted
--     by ~20 RLS policies; making it active-aware would revoke row access from
--     every deactivated account mid-session, which is probably correct but is a
--     far larger blast radius than this repair and needs its own unit and its
--     own test pass. Recorded as a separate finding — see POST-CHECK 5.
--   * It does not touch BASE-04 (barangay_report compares timestamptz to date
--     parameters and so reads the session timezone instead of Manila). The gate
--     is the only line of that function changed here. BASE-04 gets its own
--     migration and its own boundary tests; bundling it would make this diff
--     unreviewable and put reporting arithmetic in an authorization fix.
--   * It does not touch clear_password_change_flag() (0019). It has no role
--     gate to fail open — it acts on the caller's own row and already carries
--     the correct ACLs.
--
-- Six function bodies are restated below because CREATE OR REPLACE FUNCTION
-- takes a whole definition; there is no way to replace only a gate. Every body
-- is copied verbatim from its current source. The only intended difference in
-- each is the guard clause and, where a header comment described the old gate,
-- that comment. See POST-CHECK 6 for how that claim is checked mechanically.
--
-- HOW TO VERIFY AND APPLY THIS FILE. Do not paste it straight into the SQL
-- editor and run it. The denial matrix must pass first, and it can only run
-- against these definitions, so it must run inside the same transaction:
--
--   A. PREFERRED — disposable Supabase branch.
--      Apply this file, run supabase/tests/0028_role_gate_matrix.sql, read the
--      matrix, discard the branch. Then apply this file to the real project.
--
--   B. OTHERWISE — one transactional preflight batch.
--        node scripts/build-0028-preflight.mjs
--      writes supabase/tests/0028_preflight.generated.sql, which is
--      `begin;` + this file + the matrix + a raise-on-FAIL + `rollback;`.
--      Run that whole file in the SQL editor. It always rolls back, so it
--      changes nothing; a FAIL row aborts it. Only after it reports all PASS,
--      apply this file for real inside `begin; … commit;`.
--      The preflight is GENERATED, never hand-maintained, so it cannot drift
--      from the migration it is verifying.
--
-- POSITIONING (§1, §5) unchanged: no new data, no new column, no scoring.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- NO `begin;` / `commit;` HERE, DELIBERATELY (M28-03).
--
-- The mandatory pre-apply check (supabase/tests/0028_role_gate_matrix.sql) has
-- to exercise definitions that only exist after this file runs. If this file
-- committed itself, that check could only ever run AFTER application, which is
-- the opposite of what it is for. Leaving the transaction to the caller lets
-- the preflight put this file and the matrix in one transaction and roll the
-- whole thing back.
--
-- Two supported ways to run it, both in the file header.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The helper.
--
-- SECURITY DEFINER for the same anti-recursion reason as 0002: a gate must be
-- able to read public.users without re-entering that table's own policies.
-- search_path pinned, as on every definer function in this schema.
--
-- `and active` is what makes a banned account indistinguishable from an account
-- that never existed. Returning NULL rather than raising keeps the helper
-- usable inside a policy expression, where an exception would be wrong.
-- ---------------------------------------------------------------------------
create or replace function public.current_user_active_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users
   where user_id = auth.uid()
     and active;
$$;

comment on function public.current_user_active_role() is
  'Role of the calling user, or NULL if there is no JWT, no public.users row, '
  'or the account is deactivated (0028). Use this — not current_user_role() — '
  'in every authorization gate: NULL collapses all three denial cases into one '
  'value that an explicit IS NULL test catches. current_user_role() remains '
  'the helper the RLS policies use; it is not active-aware.';

revoke all on function public.current_user_active_role() from public;
revoke all on function public.current_user_active_role() from anon;
revoke all on function public.current_user_active_role() from service_role;
grant  execute on function public.current_user_active_role() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. barangay_report(date, date) — 0027. FAIL-OPEN GATE.
--
-- Body identical to 0027 apart from the guard. The date predicates are left
-- exactly as they are: BASE-04 is real, and it is not this migration's job.
-- ---------------------------------------------------------------------------
create or replace function public.barangay_report(from_date date, to_date date)
returns table (
  barangay_code   text,
  barangay_name   text,
  city_name       text,
  screened_count  bigint,
  referred_count  bigint,
  presented_count bigint,
  tested_count    bigint,
  positive_count  bigint,
  missed_count    bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_active_role();
begin
  -- Reporting roles only. An anonymous caller, a caller with no profile row, a
  -- deactivated account, or a BHW gets an error, not data. The IS NULL test is
  -- load-bearing: `NULL not in (...)` is NULL, and PL/pgSQL does not run an IF
  -- whose condition is NULL — which is exactly how this gate failed open.
  if v_role is null or v_role not in ('tb_dots', 'admin') then
    raise exception 'barangay_report: TB-DOTS or admin role required'
      using errcode = '42501';
  end if;

  return query
  with
  -- One row per barangay that has ANY patient, so a barangay with screenings
  -- but no referrals still appears with zeros rather than vanishing.
  base as (
    select distinct p.barangay_code, b.name as bname, c.name as cname
    from public.patients      p
    join public.ref_barangays b on b.barangay_code = p.barangay_code
    join public.ref_cities    c on c.city_code = b.city_code
  ),
  scr as (
    select p.barangay_code,
           count(distinct s.patient_id) filter (where true)          as screened,
           count(distinct s.patient_id) filter (where s.referred)    as referred
    from public.screenings s
    join public.patients   p on p.patient_id = s.patient_id
    where s.created_at >= from_date
      and s.created_at <  (to_date + 1)     -- inclusive end date
    group by p.barangay_code
  ),
  ref as (
    select p.barangay_code,
           count(*) filter (where r.presented is true)                     as presented,
           count(*) filter (where r.status = 'tested')                     as tested,
           count(*) filter (where r.result_outcome = 'positive')           as positive
    from public.referrals r
    join public.patients  p on p.patient_id = r.patient_id
    where r.created_at >= from_date
      and r.created_at <  (to_date + 1)
    group by p.barangay_code
  ),
  -- Lost-to-follow-up ANALOGUE: a check-up marked missed whose patient never
  -- booked a later one. Rebooking is recovery, so it is not a loss. This is the
  -- closest this schema comes to the CHO's "Lost to FF Up" column; it is not
  -- the same measurement and the UI labels it as missed check-ups.
  mis as (
    select p.barangay_code, count(*) as missed
    from public.appointments a
    join public.patients     p on p.patient_id = a.patient_id
    where a.status = 'missed'
      and a.scheduled_date between from_date and to_date
      and not exists (
        select 1 from public.appointments a2
        where a2.patient_id = a.patient_id
          and a2.status = 'scheduled'
          and a2.scheduled_date > a.scheduled_date
      )
    group by p.barangay_code
  )
  select
    base.barangay_code,
    base.bname,
    base.cname,
    coalesce(scr.screened,  0)::bigint,
    coalesce(scr.referred,  0)::bigint,
    coalesce(ref.presented, 0)::bigint,
    coalesce(ref.tested,    0)::bigint,
    coalesce(ref.positive,  0)::bigint,
    coalesce(mis.missed,    0)::bigint
  from base
  left join scr on scr.barangay_code = base.barangay_code
  left join ref on ref.barangay_code = base.barangay_code
  left join mis on mis.barangay_code = base.barangay_code
  order by coalesce(ref.positive, 0) desc,
           coalesce(scr.referred, 0) desc,
           base.bname asc;
end;
$$;

comment on function public.barangay_report(date, date) is
  'Per-barangay screening/referral funnel counts for the reporting views. '
  'Counts only, GROUP BY barangay_code only (§6); an ACTIVE TB-DOTS or admin '
  'account is required (0028). A SUBSET of the health office case register, '
  'never a replacement: no treatment outcomes exist in this schema, and only '
  'patients seen through this system are counted.';

revoke all on function public.barangay_report(date, date) from public;
revoke all on function public.barangay_report(date, date) from anon;
revoke all on function public.barangay_report(date, date) from service_role;
grant  execute on function public.barangay_report(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. admin_overview() — 0026. FAIL-OPEN GATE, AND REACHABLE BY anon.
--
-- Signature unchanged since 0026, so CREATE OR REPLACE is enough and the
-- existing grants survive — which is precisely why the anon grant must be named
-- and revoked below rather than assumed gone.
--
-- service_role EXECUTE is revoked here, unlike 0019's decision for
-- clear_password_change_flag(). The reasoning does not carry across: there, a
-- service-role call was a harmless no-op UPDATE, so keeping the grant cost
-- nothing. Here auth.uid() is null under service_role, so every one of these
-- functions now RAISES. A standing grant on a function that cannot work is a
-- trap, not a convenience. No Edge Function calls any of them today (checked:
-- manage-bhw and sms-reminders do not). A future one that needs a grant should
-- add it deliberately, in its own migration, having decided it wants to bypass
-- the role gate.
-- ---------------------------------------------------------------------------
create or replace function public.admin_overview()
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
declare
  v_role text := public.current_user_active_role();
begin
  if v_role is null or v_role <> 'admin' then
    raise exception 'admin_overview: admin role required'
      using errcode = '42501';
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

comment on function public.admin_overview() is
  'Per-facility staffing and open-referral counts for the developer portal. '
  'An ACTIVE admin account is required (0028); anonymous EXECUTE is revoked.';

revoke all on function public.admin_overview() from public;
revoke all on function public.admin_overview() from anon;
revoke all on function public.admin_overview() from service_role;
grant  execute on function public.admin_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. bhw_activity(int) — 0026.
--
-- This gate did NOT fail open: the IF/ELSIF/ELSE shape sends a NULL role to the
-- ELSE branch, which raises. It is re-gated only to become active-aware, and to
-- get explicit ACLs. Body otherwise verbatim.
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
  v_role  text := public.current_user_active_role();
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
    -- Reached by a NULL role too (anonymous, no profile row, deactivated),
    -- which is why this shape never had 0027's defect.
    raise exception 'bhw_activity: midwife or admin role required'
      using errcode = '42501';
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

comment on function public.bhw_activity(integer) is
  'BHW roster with screening/referral activity. An ACTIVE midwife (own '
  'barangay) or admin (unscoped) account is required (0028).';

revoke all on function public.bhw_activity(integer) from public;
revoke all on function public.bhw_activity(integer) from anon;
revoke all on function public.bhw_activity(integer) from service_role;
grant  execute on function public.bhw_activity(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. dashboard_counts() — 0018.
--
-- `is distinct from` was already null-safe. Re-gated for active-awareness and
-- explicit ACLs. Body otherwise verbatim, Manila handling untouched.
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
as $fn$
declare
  d_today date        := public.manila_today();
  d_start timestamptz := public.manila_day_start(d_today);
  d_next  timestamptz := public.manila_day_start(d_today + 1);
begin
  if public.current_user_active_role() is distinct from 'tb_dots' then
    raise exception 'dashboard_counts: TB-DOTS role required'
      using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from public.screenings s
      where s.created_at >= d_start and s.created_at < d_next),
    (select count(*) from public.referrals r
      where r.facility_id = public.current_user_facility()
        and r.created_at >= d_start and r.created_at < d_next),
    (select count(*) from public.referrals r
      where r.facility_id = public.current_user_facility()
        and r.result_outcome = 'positive'
        and r.result_date >= d_start and r.result_date < d_next),
    (select count(*) from public.referrals r
      where r.facility_id = public.current_user_facility()
        and r.result_outcome = 'negative'
        and r.result_date >= d_start and r.result_date < d_next),
    -- scheduled_date is a plain `date`, already written in local terms, so it
    -- compares against the local calendar date rather than a range.
    (select count(*) from public.appointments a
      where a.scheduled_date = d_today and a.status = 'attended'
        and a.patient_id in (select public.referred_patient_ids())),
    (select count(*) from public.appointments a
      where a.scheduled_date = d_today and a.status = 'missed'
        and a.patient_id in (select public.referred_patient_ids())),
    (select count(*) from public.appointments a
      where a.scheduled_date = d_today
        and a.patient_id in (select public.referred_patient_ids()));
end;
$fn$;

comment on function public.dashboard_counts() is
  'Aggregate today-counts for the TB-DOTS portal dashboard, where "today" is '
  'the Asia/Manila calendar day (0018). Counts only; an ACTIVE TB-DOTS account '
  'is required (0028); never per-patient data.';

revoke all on function public.dashboard_counts() from public;
revoke all on function public.dashboard_counts() from anon;
revoke all on function public.dashboard_counts() from service_role;
grant  execute on function public.dashboard_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. hotspot_counts(date, date) — 0018. Same treatment as dashboard_counts().
-- ---------------------------------------------------------------------------
create or replace function public.hotspot_counts(from_date date, to_date date)
returns table (
  barangay_code     text,
  barangay_name     text,
  city_name         text,
  presumptive_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  -- TB-DOTS staff only (portal). BHWs, anonymous callers, callers with no
  -- profile row and deactivated accounts get an error, not data.
  if public.current_user_active_role() is distinct from 'tb_dots' then
    raise exception 'hotspot_counts: TB-DOTS role required'
      using errcode = '42501';
  end if;

  return query
  select
    p.barangay_code,
    b.name as barangay_name,
    c.name as city_name,
    count(distinct p.patient_id) as presumptive_count
  from public.screenings s
  join public.patients      p on p.patient_id = s.patient_id
  join public.ref_barangays b on b.barangay_code = p.barangay_code
  join public.ref_cities    c on c.city_code = b.city_code
  where s.referred = true
    and s.created_at >= public.manila_day_start(from_date)
    and s.created_at <  public.manila_day_start(to_date + 1)  -- inclusive end
  group by p.barangay_code, b.name, c.name
  order by count(distinct p.patient_id) desc, b.name asc;
end;
$fn$;

comment on function public.hotspot_counts(date, date) is
  'Presumptive-TB counts per barangay for the hotspot view. Counts only; an '
  'ACTIVE TB-DOTS account is required (0028).';

revoke all on function public.hotspot_counts(date, date) from public;
revoke all on function public.hotspot_counts(date, date) from anon;
revoke all on function public.hotspot_counts(date, date) from service_role;
grant  execute on function public.hotspot_counts(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. next_facility_patient_code() — 0025.
--
-- The only WRITE-path gate in this set: it allocates the display code a
-- facility registration is about to use. Same null-safety story as the two
-- above (`is distinct from` was already safe), now active-aware.
-- ---------------------------------------------------------------------------
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
  if public.current_user_active_role() is distinct from 'tb_dots' then
    raise exception 'next_facility_patient_code: TB-DOTS role required'
      using errcode = '42501';
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
  'portal (0025). An ACTIVE TB-DOTS account is required (0028). Mobile does '
  'not use this — it generates PAT-<device>-<seq> offline.';

revoke all on function public.next_facility_patient_code() from public;
revoke all on function public.next_facility_patient_code() from anon;
revoke all on function public.next_facility_patient_code() from service_role;
grant  execute on function public.next_facility_patient_code() to authenticated;


-- ============================================================================
-- POST-CHECKS (run separately — the SQL editor returns only the last result).
--
-- 1. No `anon` EXECUTE grant survives on any of the seven functions. This is
--    the check that matters most: 0019 established that Supabase's default
--    privileges grant EXECUTE to anon BY NAME, so a revoke from PUBLIC alone
--    leaves it standing.
--
--    NOTE (M28-01): this MUST be a LEFT JOIN with grantee 0 rendered as PUBLIC.
--    PostgreSQL represents PUBLIC as grantee OID 0, which has no pg_roles row,
--    so an inner join silently drops it — the query would report "no PUBLIC
--    grant" even when one is standing, which is the single thing this check
--    exists to catch. The first version of this post-check had that bug.
--
--    select p.proname,
--           coalesce(r.rolname, 'PUBLIC') as grantee,
--           a.privilege_type
--      from pg_proc p
--      join pg_namespace n on n.oid = p.pronamespace
--      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
--      left join pg_roles r on r.oid = a.grantee
--     where n.nspname = 'public'
--       and p.proname in ('current_user_active_role','barangay_report',
--                         'admin_overview','bhw_activity','dashboard_counts',
--                         'hotspot_counts','next_facility_patient_code')
--     order by 1, 2;
--
--    Expect EXACTLY: one `authenticated` EXECUTE row per function, seven rows
--    in total, plus whatever the function OWNER holds. No `anon`, no PUBLIC and
--    no `service_role` row anywhere.
--
--    service_role is revoked from all seven (M28-01). Supabase's default
--    privileges grant it by name and CREATE OR REPLACE preserves it, so it must
--    be named to be removed, exactly like anon. Under service_role auth.uid()
--    is null, so every one of these functions raises — a standing grant on a
--    function that cannot work is a trap, not a convenience.
--
--    An owner row (typically `postgres`) is expected and is not a finding: the
--    owner's privileges are implicit in owning the function.
--
-- 2. All seven are SECURITY DEFINER with a pinned search_path:
--
--    select proname, prosecdef, proconfig
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and proname in ('current_user_active_role','barangay_report',
--                       'admin_overview','bhw_activity','dashboard_counts',
--                       'hotspot_counts','next_facility_patient_code');
--
--    Expect prosecdef = true and proconfig = {search_path=public} on all seven.
--
-- 3. No gate still consults the non-active-aware helper:
--
--    select p.proname
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.prosrc like '%current_user_role()%'
--       and p.proname in ('barangay_report','admin_overview','bhw_activity',
--                         'dashboard_counts','hotspot_counts',
--                         'next_facility_patient_code');
--
--    Expect 0 rows. (RLS POLICIES still use current_user_role(), by design —
--    this check covers the functions only.)
--
-- 4. The denial matrix. Run supabase/tests/0028_role_gate_matrix.sql, which
--    exercises every function against real database roles: anonymous, a
--    signed-in account with no public.users row, a deactivated account, each
--    wrong role, and each allowed role. It reports PASS/FAIL per cell and
--    rolls itself back.
--
-- 5. KNOWN GAP, deliberately left open by this migration. RLS policies still
--    call current_user_role(), which is not active-aware, so a deactivated user
--    holding an unexpired JWT can still READ ROWS through the policies until
--    that token expires. This migration closes the RPC surface only. Confirm
--    the exposure directly:
--
--    select polname, tablename
--      from pg_policies pol
--      join pg_policy p on p.polname = pol.policyname
--     where pol.schemaname = 'public'
--       and pol.qual like '%current_user_role%';
--
--    Fixing it means either making current_user_role() active-aware (one line,
--    ~20 policies affected, needs a full role/regression pass) or shortening
--    the JWT lifetime. It is a separate work unit and is NOT closed here.
--
-- 6. THE VERBATIM-BODY CLAIM. Six bodies were restated from their source
--    migrations. To check that nothing but the guard changed, run:
--
--        node scripts/verify-0028-bodies.mjs
--
--    It extracts each function from its source migration and from this file,
--    strips the guard block and comments, and diffs the remainder. It must
--    print OK for all six.
-- ============================================================================
