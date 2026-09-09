-- ============================================================================
-- 0030_report_boundary.sql — the Manila boundary test for barangay_report().
--
-- WHAT IT PROVES. BASE-04 was a timezone bug: comparing a timestamptz column to
-- a bare `date` parameter casts the date using the SESSION TimeZone, so on a UTC
-- session the reporting day started at 08:00 Manila and everything before that
-- was filed under the previous day.
--
-- A test that only ran under one session timezone could not see this. So this
-- file runs the SAME report twice — once with `TimeZone = 'UTC'` and once with
-- `TimeZone = 'Asia/Manila'` — and asserts that the two agree, and that both
-- attribute each event to the correct Manila calendar day.
--
-- It also includes a NEGATIVE CONTROL that demonstrates the old arithmetic
-- failing on the very same rows, so a reader can see the bug is real and the
-- test is not passing vacuously.
--
-- ---------------------------------------------------------------------------
-- HOW TO RUN IT. This file opens no transaction and must not be run alone.
--
--     node scripts/build-preflight.mjs 0030
--
-- writes supabase/tests/0030_preflight.generated.sql =
--   begin; <0030> <this file> rollback;
-- Run that whole file in the SQL editor. It always rolls back, so it changes
-- nothing, and a single FAIL aborts it.
-- ---------------------------------------------------------------------------
--
-- THE FIXTURE. One barangay, one patient, and events placed at instants chosen
-- to sit inside the 00:00–08:00 Manila window that the old code misfiled:
--
--   2026-01-01 01:00 Manila  =  2025-12-31 17:00 UTC
--
-- That instant is New Year's Day in Manila and New Year's Eve in UTC, so it
-- lands in a different YEAR depending on which the report uses. A year boundary
-- is the case that matters most here: this report is read as an annual figure
-- and compared against the previous year.
--
-- A second event at 2026-01-01 09:00 Manila (01:00 UTC) is unambiguous — both
-- timezones agree it is 2026 — so it acts as the control that the fixture is
-- being counted at all.
--
-- SCOPE. Date bounds only. Not authorization (0028's matrix), not row access
-- (0029's), and not the cohort-versus-event basis of the referral columns,
-- which 0030 documents but deliberately does not change.
-- ============================================================================

create temp table t_ids (k text primary key, v uuid) on commit drop;
insert into t_ids (k, v)
select k, gen_random_uuid()
  from unnest(array[
    'fac','staff','pat',
    'scr_early','scr_late','ref_early','ref_late'
  ]) as k;

-- The barangay must hold NO existing patient. barangay_report() aggregates by
-- barangay and cannot be filtered to a fixture the way 0029's matrix filters by
-- row id, so any live patient sharing the barangay would be counted into the
-- expected numbers below and the test would pass or fail for reasons that have
-- nothing to do with timezones. Picking an empty barangay is what makes every
-- expected count on this page exact arithmetic.
create temp table t_brgy (code text) on commit drop;
insert into t_brgy
select b.barangay_code
  from public.ref_barangays b
 where not exists (select 1 from public.patients p where p.barangay_code = b.barangay_code)
 order by b.barangay_code
 limit 1;

do $fixture$
begin
  if not exists (select 1 from t_brgy) then
    raise exception
      '0030 boundary test needs a barangay with no existing patients; every '
      'seeded barangay is occupied. Point the fixture at a disposable branch.';
  end if;
end;
$fixture$;

insert into public.facilities (facility_id, name, type, address)
select v, 'Boundary DOTS', 'tb_dots', 'test' from t_ids where k = 'fac';

insert into auth.users (id) select v from t_ids where k = 'staff';

insert into public.users (user_id, role, full_name, facility_id, active)
select (select v from t_ids where k = 'staff'), 'tb_dots', 'Boundary staff',
       (select v from t_ids where k = 'fac'), true;

insert into public.patients
  (patient_id, display_code, enrolled_by, age, sex, barangay_code, sms_consent)
select (select v from t_ids where k = 'pat'), 'BND-0001',
       (select v from t_ids where k = 'staff'), 40, 'male',
       (select code from t_brgy), false;

-- created_at is `not null default now()`, but it is an ordinary column, so the
-- fixture writes the instants it needs directly. Both are written as explicit
-- Manila wall-clock times converted to an absolute instant, so the fixture
-- itself does not depend on the session timezone either.
insert into public.screenings (screening_id, patient_id, referred, created_at)
values
  ((select v from t_ids where k = 'scr_early'), (select v from t_ids where k = 'pat'), true,
   timestamp '2026-01-01 01:00' at time zone 'Asia/Manila'),
  ((select v from t_ids where k = 'scr_late'),  (select v from t_ids where k = 'pat'), true,
   timestamp '2026-01-01 09:00' at time zone 'Asia/Manila');

insert into public.referrals
  (referral_id, patient_id, screening_id, facility_id, status, presented, result_outcome, created_at)
values
  ((select v from t_ids where k = 'ref_early'), (select v from t_ids where k = 'pat'),
   (select v from t_ids where k = 'scr_early'), (select v from t_ids where k = 'fac'),
   'tested', true, 'positive',
   timestamp '2026-01-01 01:00' at time zone 'Asia/Manila'),
  ((select v from t_ids where k = 'ref_late'), (select v from t_ids where k = 'pat'),
   (select v from t_ids where k = 'scr_late'), (select v from t_ids where k = 'fac'),
   'tested', true, 'positive',
   timestamp '2026-01-01 09:00' at time zone 'Asia/Manila');

create temp table t_result (
  check_kind text, tz text, period text,
  expected text, actual text, detail text, verdict text
) on commit drop;

-- ---------------------------------------------------------------------------
-- The report is SECURITY DEFINER and gates on an active TB-DOTS role, so the
-- test has to call it as the staff account rather than as the migration role.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.as_staff(p_uid uuid) returns void
language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end;
$$;

do $boundary$
declare
  v_tz        text;
  u_staff   uuid;
  brgy      text;
  v_scr     bigint;
  v_pos     bigint;
begin
  select v into u_staff from t_ids where k = 'staff';
  select code into brgy from t_brgy;

  foreach v_tz in array array['UTC', 'Asia/Manila'] loop

    -- ---- 2026-01-01, the Manila day both events belong to -----------------
    execute format('set local timezone %L', v_tz);
    perform pg_temp.as_staff(u_staff);
    select screened_count, positive_count into v_scr, v_pos
      from public.barangay_report(date '2026-01-01', date '2026-01-01')
     where barangay_code = brgy;
    reset role;

    -- screened_count counts DISTINCT patients, and both screenings belong to
    -- the same person, so the expected value is 1 patient — not 2 events.
    insert into t_result values ('day in range', v_tz, '2026-01-01',
      '1 patient', coalesce(v_scr, 0)::text || ' patient',
      'both screenings are the same patient',
      case when coalesce(v_scr, 0) = 1 then 'PASS' else 'FAIL' end);

    -- positive_count counts referral ROWS, so both referrals count.
    insert into t_result values ('day in range', v_tz, '2026-01-01',
      '2 positive', coalesce(v_pos, 0)::text || ' positive',
      '01:00 and 09:00 Manila both fall on 1 Jan',
      case when coalesce(v_pos, 0) = 2 then 'PASS' else 'FAIL' end);

    -- ---- 2025-12-31, the day BEFORE. Nothing may leak backwards. ----------
    -- This is the assertion the old code failed: under UTC it filed the 01:00
    -- Manila events here, in the previous day AND the previous YEAR.
    execute format('set local timezone %L', v_tz);
    perform pg_temp.as_staff(u_staff);
    select screened_count, positive_count into v_scr, v_pos
      from public.barangay_report(date '2025-12-31', date '2025-12-31')
     where barangay_code = brgy;
    reset role;

    insert into t_result values ('day before', v_tz, '2025-12-31',
      '0 patient', coalesce(v_scr, 0)::text || ' patient',
      'the 01:00 Manila event must not leak into the previous day',
      case when coalesce(v_scr, 0) = 0 then 'PASS' else 'FAIL' end);

    insert into t_result values ('day before', v_tz, '2025-12-31',
      '0 positive', coalesce(v_pos, 0)::text || ' positive', '',
      case when coalesce(v_pos, 0) = 0 then 'PASS' else 'FAIL' end);

    -- ---- The full previous YEAR, which is how this report is actually read.
    execute format('set local timezone %L', v_tz);
    perform pg_temp.as_staff(u_staff);
    select positive_count into v_pos
      from public.barangay_report(date '2025-01-01', date '2025-12-31')
     where barangay_code = brgy;
    reset role;

    insert into t_result values ('previous year', v_tz, '2025',
      '0 positive', coalesce(v_pos, 0)::text || ' positive',
      'a New Year event must not be counted in the year before',
      case when coalesce(v_pos, 0) = 0 then 'PASS' else 'FAIL' end);

  end loop;

  reset timezone;
end;
$boundary$;

-- ---------------------------------------------------------------------------
-- NEGATIVE CONTROL. Reproduce the OLD predicate against the same fixture, so
-- the matrix shows the bug rather than only asserting its absence. If this ever
-- stops reporting the misfiling, the fixture has drifted and the PASS rows
-- above no longer mean anything.
-- ---------------------------------------------------------------------------
do $control$
declare n_old bigint; n_new bigint;
begin
  set local timezone 'UTC';

  -- The old arithmetic: timestamptz compared to a bare date parameter.
  select count(*) into n_old
    from public.referrals r
   where r.created_at >= date '2025-12-31'
     and r.created_at <  (date '2025-12-31' + 1)
     and r.referral_id in (select v from t_ids);

  -- The new arithmetic, same window.
  select count(*) into n_new
    from public.referrals r
   where r.created_at >= public.manila_day_start(date '2025-12-31')
     and r.created_at <  public.manila_day_start(date '2025-12-31' + 1)
     and r.referral_id in (select v from t_ids);

  reset timezone;

  insert into t_result values ('negative control', 'UTC', '2025-12-31',
    'old counts 1, new counts 0',
    'old counts ' || n_old || ', new counts ' || n_new,
    'demonstrates the bug the fixture is designed to catch',
    case when n_old = 1 and n_new = 0 then 'PASS' else 'FAIL' end);
end;
$control$;

-- ---------------------------------------------------------------------------
-- Cross-timezone agreement, stated as its own assertion: for every period, the
-- UTC session and the Manila session must have produced identical results.
-- ---------------------------------------------------------------------------
insert into t_result
select 'timezone agreement', 'UTC vs Asia/Manila', period,
       'identical',
       case when count(distinct actual) = 1 then 'identical' else 'DIFFERS' end,
       string_agg(distinct tz || '=' || actual, ', '),
       case when count(distinct actual) = 1 then 'PASS' else 'FAIL' end
  from t_result
 where check_kind in ('day in range', 'day before', 'previous year')
 group by period, check_kind, expected;

-- ---------------------------------------------------------------------------
-- THE MATRIX. Every row must read PASS. Failures sort to the top.
-- ---------------------------------------------------------------------------
select verdict, check_kind, tz, period, expected, actual, detail
  from t_result
 order by (verdict = 'PASS'), check_kind, period, tz;

do $verdict$
declare n_fail int; n_all int;
begin
  select count(*) filter (where verdict = 'FAIL'), count(*) into n_fail, n_all from t_result;

  if n_all = 0 then
    raise exception '0030 boundary test produced no rows — the harness did not run';
  end if;
  if n_fail > 0 then
    raise exception '0030 boundary test: % of % checks FAILED — do not apply 0030', n_fail, n_all;
  end if;
  raise notice '0030 boundary test: all % checks PASSED', n_all;
end;
$verdict$;
