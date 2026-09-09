-- ============================================================================
-- TB-Screen BHW — 0030_barangay_report_manila_boundaries.sql
-- BASE-04: the barangay report reads the session timezone instead of Manila.
--
-- THE DEFECT. barangay_report() compares a `timestamptz` column to a `date`
-- parameter:
--
--     where s.created_at >= from_date and s.created_at < (to_date + 1)
--
-- PostgreSQL casts the date to timestamptz using the SESSION TimeZone. On a UTC
-- session — which is what PostgREST and the SQL editor use by default — that
-- makes `from_date` midnight UTC, i.e. 08:00 the same morning in Manila. So
-- every screening and referral created between 00:00 and 08:00 Manila falls
-- into the PREVIOUS reporting day, and at a year boundary into the previous
-- year.
--
-- Migration 0018 introduced manila_day_start() to fix this exact class of bug,
-- and dashboard_counts() and hotspot_counts() use it. 0027 shipped a new
-- reporting function that did not, which is BASE-04. 0028 restated this body
-- while repairing the authorization gate and deliberately left the arithmetic
-- alone — reporting arithmetic does not belong in a security fix. This is the
-- unit that finishes it.
--
-- THE FIX. Half-open ranges bounded by manila_day_start(), the pairing 0018's
-- own comment prescribes:
--
--     where s.created_at >= public.manila_day_start(from_date)
--       and s.created_at <  public.manila_day_start(to_date + 1)
--
-- `manila_day_start(d)` is `d::timestamp at time zone 'Asia/Manila'` — the
-- instant midnight-in-Manila begins on that calendar date — so the comparison
-- no longer depends on what timezone the caller happens to be in.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   * The `mis` CTE compares appointments.scheduled_date, a plain `date`, to
--     the date parameters. No timezone is involved in a date-to-date
--     comparison, so it was always correct and is left exactly as it was.
--     dashboard_counts() carries the same note for the same reason. This is
--     not an oversight.
--   * The counts themselves. Numbers move at the boundaries because they were
--     wrong there; nothing else about what is counted changes.
--   * The role gate, the ACLs and every other line of the body, all of which
--     0028 verified. `node scripts/verify-0030-report-body.mjs` proves that
--     nothing but the four date predicates moved.
--
-- ---------------------------------------------------------------------------
-- THE SECOND HALF OF BASE-04: the header's date-basis claim was wrong.
--
-- 0027's header said, of the period columns:
--
--     "So a patient screened in December and tested in January lands in
--      DIFFERENT periods for screened_count and tested_count."
--
-- That is not what the SQL does. `tested_count` counts referrals whose CURRENT
-- status is 'tested', filtered by `referrals.created_at` — the date the
-- referral was RAISED, not the date the test happened. A referral created in
-- December and tested in January is counted in DECEMBER, in the same period as
-- its screening, which is the opposite of what the header promised.
--
-- The honest description, now in the function comment and in the report UI:
--
--   * screened_count / referred_count are EVENT counts — screenings created in
--     the period.
--   * presented_count / tested_count / positive_count are COHORT counts —
--     referrals CREATED in the period, counted by the state they have reached
--     by the time the report is run. They are not "tests done in the period".
--     A referral raised on 30 December and tested on 5 January counts in
--     December, and the same referral's row will change category as its status
--     advances.
--   * missed_count is an event count on appointments.scheduled_date.
--
-- The basis is NOT changed here. Recounting the referral columns by
-- `result_date` would be a different measure and different numbers, and that is
-- a decision for the health office, not a bug fix. `referrals.result_date`
-- exists if they want it; it would be its own unit with its own review.
-- Describing the current behaviour accurately is what this migration owes.
-- ---------------------------------------------------------------------------
--
-- HOW TO VERIFY AND APPLY, as 0028 and 0029:
--     node scripts/build-preflight.mjs 0030
--   writes supabase/tests/0030_preflight.generated.sql =
--     begin; <this file> <supabase/tests/0030_report_boundary.sql> rollback;
--   Run that whole file in the SQL editor. It always rolls back. Every row must
--   read PASS. Only then apply this file inside begin; … commit;
--
--   The boundary test runs the report under BOTH a UTC session and a Manila
--   session and asserts identical counts, which is the property the old code
--   did not have.
--
--   This migration requires 0028 (current_user_active_role) to be applied.
--
-- POSITIONING (§1, §5) unchanged: counts only, aggregate by barangay only, no
-- score, no new column, no new capability.
-- ============================================================================

-- No `begin;` / `commit;` here, deliberately — the preflight wraps this file in
-- a transaction it can roll back. See 0028's header for why.

do $guard$
begin
  if to_regprocedure('public.current_user_active_role()') is null then
    raise exception
      '0030 requires migration 0028 (current_user_active_role) to be applied first';
  end if;
  if to_regprocedure('public.manila_day_start(date)') is null then
    raise exception
      '0030 requires migration 0018 (manila_day_start) to be applied first';
  end if;
end;
$guard$;

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
    -- 0018's prescribed pairing: half-open, bounded by midnight-in-Manila, so
    -- the window does not move with the caller's session timezone (BASE-04).
    where s.created_at >= public.manila_day_start(from_date)
      and s.created_at <  public.manila_day_start(to_date + 1)  -- inclusive end
    group by p.barangay_code
  ),
  ref as (
    select p.barangay_code,
           count(*) filter (where r.presented is true)                     as presented,
           count(*) filter (where r.status = 'tested')                     as tested,
           count(*) filter (where r.result_outcome = 'positive')           as positive
    from public.referrals r
    join public.patients  p on p.patient_id = r.patient_id
    where r.created_at >= public.manila_day_start(from_date)
      and r.created_at <  public.manila_day_start(to_date + 1)
    group by p.barangay_code
  ),
  -- Lost-to-follow-up ANALOGUE: a check-up marked missed whose patient never
  -- booked a later one. Rebooking is recovery, so it is not a loss. This is the
  -- closest this schema comes to the CHO's "Lost to FF Up" column; it is not
  -- the same measurement and the UI labels it as missed check-ups.
  --
  -- scheduled_date is a plain `date`, already written in local terms, so a
  -- date-to-date comparison involves no timezone and needs no Manila bounds.
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
  'account is required (0028). Period bounds are Manila calendar days via '
  'manila_day_start(), independent of the session timezone (0030). '
  'DATE BASIS: screened/referred are EVENTS created in the period. '
  'presented/tested/positive are a COHORT — referrals CREATED in the period, '
  'counted by the status they have reached by report time, NOT tests performed '
  'in the period. missed counts appointments by scheduled_date. '
  'A SUBSET of the health office case register, never a replacement.';

-- CREATE OR REPLACE preserves the existing ACL, but 0028 established that these
-- are restated explicitly rather than assumed — Supabase default privileges
-- grant EXECUTE to anon and service_role by name, and a silent regression here
-- is exactly BASE-01.
revoke all on function public.barangay_report(date, date) from public;
revoke all on function public.barangay_report(date, date) from anon;
revoke all on function public.barangay_report(date, date) from service_role;
grant  execute on function public.barangay_report(date, date) to authenticated;

-- ============================================================================
-- POST-CHECKS (run separately — the SQL editor returns only the last result).
--
-- 1. No date predicate in this function compares a timestamptz to a bare date
--    parameter any more:
--
--    select prosrc ~ 'created_at\s*>=\s*from_date' as still_broken
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and p.proname = 'barangay_report';
--
--    Expect still_broken = false.
--
-- 2. The ACL is unchanged from 0028's expectation — `authenticated` only, no
--    anon, no PUBLIC, no service_role. Use 0028 POST-CHECK 1's LEFT JOIN query.
--
-- 3. The boundary behaviour: supabase/tests/0030_report_boundary.sql, through
--    the generated preflight. It places events in the 00:00–08:00 Manila window
--    that the old code misfiled, runs the report under a UTC session and a
--    Manila session, and asserts both agree and both attribute the event to the
--    correct Manila day — including across a year boundary.
--
-- 4. Transcription: `node scripts/verify-0030-report-body.mjs` must print OK.
--    It compares this body against 0028's, normalising ONLY the four date
--    predicates, so any other edit to the reporting query fails loudly.
-- ============================================================================
