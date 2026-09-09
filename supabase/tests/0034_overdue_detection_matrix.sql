-- ============================================================================
-- 0034_overdue_detection_matrix.sql — behaviour matrix for Task 3.4.
--
-- WHAT IT PROVES
--
--   1. The rule itself: open + day passed = overdue; today, tomorrow, attended,
--      missed and cancelled are not.
--   2. The acceptance criterion — no UTC/Manila rollover regression. The same
--      question is asked under four session timezones spanning 25 hours and
--      must return an identical answer every time.
--   3. Scoping is inherited correctly from RLS: a second TB-DOTS facility sees
--      none of the first facility's overdue rows, a BHW sees their barangay's,
--      and an admin sees nothing.
--   4. It writes nothing.
--
-- THE NEGATIVE CONTROL, AND WHY IT IS NOT VACUOUS
--
-- A timezone test can pass for the wrong reason: run it at 03:00 Manila and
-- UTC and Manila agree on the calendar date, so a `current_date` implementation
-- and a `manila_today()` implementation return the same thing and the test goes
-- green while proving nothing. HANDOFF §6 records two earlier tests that failed
-- exactly this way.
--
-- So the control here does not depend on the wall clock at all. Pacific/Midway
-- is UTC-11 and Pacific/Kiritimati is UTC+14: 25 hours apart, which is more
-- than a day, so their local calendar dates ALWAYS differ, at every instant,
-- with Midway strictly behind. The fixture places one appointment on Midway's
-- current_date. A `current_date`-based predicate then answers "not overdue"
-- under Midway and "overdue" under Kiritimati — a demonstrated disagreement, on
-- every run, at any hour — while overdue_followups() answers the same under
-- both. If either half of that stops holding, the control fails.
--
-- ---------------------------------------------------------------------------
-- HOW TO RUN IT. This file opens no transaction and must not be run alone.
--
--     node scripts/build-preflight.mjs 0034
--
-- writes supabase/tests/0034_preflight.generated.sql =
--   begin; <0034> <this file> rollback;
-- Run that whole file. It always rolls back, so it changes nothing, and a
-- single FAIL aborts it.
-- ---------------------------------------------------------------------------
--
-- SCOPE. The detection rule, its timezone behaviour, and the scoping it
-- inherits. NOT the policies themselves (0029's and 0031's matrices own those)
-- and NOT any sweep — 0034 deliberately writes no row, and §5 asserts that.
-- ============================================================================

create temp table t_ids (k text primary key, v uuid) on commit drop;
insert into t_ids (k, v)
select k, gen_random_uuid()
  from unnest(array[
    'fac_a','fac_b',
    'staff_a','staff_b','bhw_1','admin_1',
    'pat','scr','ref',
    'appt_yesterday','appt_today','appt_tomorrow','appt_old',
    'appt_attended','appt_missed','appt_cancelled','appt_shadow',
    'pat_b','scr_b','ref_b','appt_b'
  ]) as k;

-- A barangay with no existing patient, so the BHW arm counts only the fixture.
create temp table t_brgy (code text) on commit drop;
insert into t_brgy
select b.barangay_code
  from public.ref_barangays b
 where not exists (select 1 from public.patients p where p.barangay_code = b.barangay_code)
 order by b.barangay_code
 limit 1;

do $fixture_guard$
begin
  if not exists (select 1 from t_brgy) then
    raise exception
      '0034 matrix needs a barangay with no existing patients; every seeded '
      'barangay is occupied. Point the fixture at a disposable branch.';
  end if;
end;
$fixture_guard$;

-- ---------------------------------------------------------------------------
-- Fixture. Two TB-DOTS facilities so isolation is a question that can fail.
-- ---------------------------------------------------------------------------
insert into public.facilities (facility_id, name, type, address, short_code)
select v, 'Overdue DOTS A', 'tb_dots', 'test', 'OVDA' from t_ids where k = 'fac_a';
insert into public.facilities (facility_id, name, type, address, short_code)
select v, 'Overdue DOTS B', 'tb_dots', 'test', 'OVDB' from t_ids where k = 'fac_b';

insert into auth.users (id) select v from t_ids
 where k in ('staff_a','staff_b','bhw_1','admin_1');

-- users.facility_id is NOT NULL for every role, and the barangay column is
-- `assigned_barangay_code` (0007). A BHW therefore carries a facility as well
-- as a barangay; only the barangay is load-bearing for the BHW arm, and
-- current_user_facility() is consulted on the tb_dots path alone.
insert into public.users (user_id, role, full_name, facility_id, assigned_barangay_code, active)
values
  ((select v from t_ids where k = 'staff_a'), 'tb_dots', 'Staff A',
   (select v from t_ids where k = 'fac_a'), null, true),
  ((select v from t_ids where k = 'staff_b'), 'tb_dots', 'Staff B',
   (select v from t_ids where k = 'fac_b'), null, true),
  ((select v from t_ids where k = 'bhw_1'), 'bhw', 'BHW One',
   (select v from t_ids where k = 'fac_a'), (select code from t_brgy), true),
  ((select v from t_ids where k = 'admin_1'), 'admin', 'Admin One',
   (select v from t_ids where k = 'fac_a'), null, true);

insert into public.patients
  (patient_id, display_code, enrolled_by, age, sex, barangay_code, sms_consent)
select (select v from t_ids where k = 'pat'), 'OVD-0001',
       (select v from t_ids where k = 'bhw_1'), 41, 'female',
       (select code from t_brgy), false;

insert into public.screenings (screening_id, patient_id, referred)
select (select v from t_ids where k = 'scr'), (select v from t_ids where k = 'pat'), true;

insert into public.referrals (referral_id, patient_id, screening_id, facility_id, status)
select (select v from t_ids where k = 'ref'), (select v from t_ids where k = 'pat'),
       (select v from t_ids where k = 'scr'), (select v from t_ids where k = 'fac_a'), 'received';

-- A second patient referred to facility B, so B has a real overdue row of its
-- own. Isolation asserted against an empty B would pass for the wrong reason:
-- "B sees nothing" must mean "B sees only its own", not "B has nothing to see".
insert into public.patients
  (patient_id, display_code, enrolled_by, age, sex, barangay_code, sms_consent)
select (select v from t_ids where k = 'pat_b'), 'OVD-0002',
       (select v from t_ids where k = 'bhw_1'), 52, 'male',
       (select code from t_brgy), false;

insert into public.screenings (screening_id, patient_id, referred)
select (select v from t_ids where k = 'scr_b'), (select v from t_ids where k = 'pat_b'), true;

insert into public.referrals (referral_id, patient_id, screening_id, facility_id, status)
select (select v from t_ids where k = 'ref_b'), (select v from t_ids where k = 'pat_b'),
       (select v from t_ids where k = 'scr_b'), (select v from t_ids where k = 'fac_b'), 'received';

-- ---------------------------------------------------------------------------
-- The appointments. Dates are expressed against manila_today() so the fixture
-- is correct whatever the session timezone is when it is built — writing
-- current_date here would have made the fixture itself carry the bug the test
-- is looking for.
--
-- appt_shadow is the negative control's row: it sits on Midway's current_date,
-- which is always strictly earlier than Kiritimati's. See the header.
-- ---------------------------------------------------------------------------
create temp table t_shadow (midway_today date, kiritimati_today date) on commit drop;

do $shadow$
declare d_mid date; d_kir date;
begin
  set local time zone 'Pacific/Midway';        -- UTC-11
  d_mid := current_date;
  set local time zone 'Pacific/Kiritimati';    -- UTC+14
  d_kir := current_date;
  reset timezone;
  insert into t_shadow values (d_mid, d_kir);
end;
$shadow$;

insert into public.appointments
  (appointment_id, patient_id, scheduled_date, attended_date, status, facility_id, referral_id)
select (select v from t_ids where k = 'appt_yesterday'), (select v from t_ids where k = 'pat'),
       public.manila_today() - 1, null, 'scheduled',
       (select v from t_ids where k = 'fac_a'), (select v from t_ids where k = 'ref');

insert into public.appointments
  (appointment_id, patient_id, scheduled_date, attended_date, status, facility_id, referral_id)
select (select v from t_ids where k = 'appt_today'), (select v from t_ids where k = 'pat'),
       public.manila_today(), null, 'scheduled',
       (select v from t_ids where k = 'fac_a'), (select v from t_ids where k = 'ref');

insert into public.appointments
  (appointment_id, patient_id, scheduled_date, attended_date, status, facility_id, referral_id)
select (select v from t_ids where k = 'appt_tomorrow'), (select v from t_ids where k = 'pat'),
       public.manila_today() + 1, null, 'scheduled',
       (select v from t_ids where k = 'fac_a'), (select v from t_ids where k = 'ref');

insert into public.appointments
  (appointment_id, patient_id, scheduled_date, attended_date, status, facility_id, referral_id)
select (select v from t_ids where k = 'appt_old'), (select v from t_ids where k = 'pat'),
       public.manila_today() - 30, null, 'scheduled',
       (select v from t_ids where k = 'fac_a'), (select v from t_ids where k = 'ref');

insert into public.appointments
  (appointment_id, patient_id, scheduled_date, attended_date, status, facility_id, referral_id)
select (select v from t_ids where k = 'appt_attended'), (select v from t_ids where k = 'pat'),
       public.manila_today() - 5, public.manila_today() - 5, 'attended',
       (select v from t_ids where k = 'fac_a'), (select v from t_ids where k = 'ref');

insert into public.appointments
  (appointment_id, patient_id, scheduled_date, attended_date, status, facility_id, referral_id)
select (select v from t_ids where k = 'appt_missed'), (select v from t_ids where k = 'pat'),
       public.manila_today() - 5, null, 'missed',
       (select v from t_ids where k = 'fac_a'), (select v from t_ids where k = 'ref');

insert into public.appointments
  (appointment_id, patient_id, scheduled_date, attended_date, status, facility_id, referral_id)
select (select v from t_ids where k = 'appt_cancelled'), (select v from t_ids where k = 'pat'),
       public.manila_today() - 5, null, 'cancelled',
       (select v from t_ids where k = 'fac_a'), (select v from t_ids where k = 'ref');

insert into public.appointments
  (appointment_id, patient_id, scheduled_date, attended_date, status, facility_id, referral_id)
select (select v from t_ids where k = 'appt_shadow'), (select v from t_ids where k = 'pat'),
       (select midway_today from t_shadow), null, 'scheduled',
       (select v from t_ids where k = 'fac_a'), (select v from t_ids where k = 'ref');

insert into public.appointments
  (appointment_id, patient_id, scheduled_date, attended_date, status, facility_id, referral_id)
select (select v from t_ids where k = 'appt_b'), (select v from t_ids where k = 'pat_b'),
       public.manila_today() - 3, null, 'scheduled',
       (select v from t_ids where k = 'fac_b'), (select v from t_ids where k = 'ref_b');

-- A snapshot to prove §5: this migration and this function write nothing.
create temp table t_before as
select status, count(*) as n from public.appointments group by status;

create temp table t_result (
  check_kind text, tz text, persona text,
  expected text, actual text, detail text, verdict text
) on commit drop;

-- The fixture-id tables must be readable AFTER `set local role authenticated`,
-- because every assertion below filters the function's output down to this
-- fixture's rows. Without this the role switch raises "permission denied for
-- table t_ids" — which aborts the run loudly, so it cannot pass unnoticed, but
-- it also cannot run at all.
--
-- Granting it discloses nothing under test: t_ids holds uuids this file
-- generated seconds earlier, and no assertion's outcome depends on being able
-- to read them. The questions being asked are all of the form "does
-- overdue_followups() return this row", and RLS still decides that.
-- `pg_temp` is a per-session alias and cannot be named in a GRANT, so the real
-- schema (pg_temp_NN) is resolved at run time.
do $temp_grant$
declare s text := pg_my_temp_schema()::regnamespace::text;
begin
  execute format('grant usage on schema %s to authenticated', s);
  execute format('grant select on %s.t_ids, %s.t_shadow to authenticated', s, s);
end;
$temp_grant$;

-- overdue_followups() is SECURITY INVOKER, so the test must call it as a real
-- persona or RLS does not apply and every scoping question is vacuous.
create or replace function pg_temp.as_user(p_uid uuid) returns void
language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end;
$$;


-- ===========================================================================
-- 1. The rule, under four session timezones spanning 25 hours.
-- ===========================================================================
do $rule$
declare
  v_tz      text;
  u_staff_a uuid;
  v_ids     uuid[];
  v_expect  uuid[];
  v_days    int;
begin
  select v into u_staff_a from t_ids where k = 'staff_a';

  select array[
    (select v from t_ids where k = 'appt_old'),
    (select v from t_ids where k = 'appt_yesterday')
  ] into v_expect;

  foreach v_tz in array array['UTC','Asia/Manila','Pacific/Midway','Pacific/Kiritimati'] loop

    execute format('set local time zone %L', v_tz);
    perform pg_temp.as_user(u_staff_a);

    -- appt_shadow is excluded from this assertion by name: its date is
    -- whatever Midway thinks today is, so whether it is overdue depends on the
    -- hour. Section 3 asserts the only thing that must be true of it — that
    -- every timezone agrees.
    select coalesce(array_agg(o.appointment_id order by o.scheduled_date, o.appointment_id), '{}')
      into v_ids
      from public.overdue_followups() o
     where o.appointment_id in (select v from t_ids)
       and o.appointment_id <> (select v from t_ids where k = 'appt_shadow');

    reset role;

    insert into t_result values ('rule: overdue set', v_tz, 'tb_dots A',
      'appt_old, appt_yesterday',
      coalesce(array_length(v_ids, 1), 0)::text || ' row(s)',
      'today, tomorrow, attended, missed and cancelled must all be excluded',
      case when v_ids = v_expect then 'PASS' else 'FAIL' end);

    -- days_overdue is arithmetic on the Manila calendar, so it must also be
    -- timezone-invariant. 30 is the only value appt_old can have.
    execute format('set local time zone %L', v_tz);
    perform pg_temp.as_user(u_staff_a);
    select o.days_overdue into v_days
      from public.overdue_followups() o
     where o.appointment_id = (select v from t_ids where k = 'appt_old');
    reset role;

    insert into t_result values ('rule: days_overdue', v_tz, 'tb_dots A',
      '30', coalesce(v_days, -1)::text,
      'manila_today() - scheduled_date, for a row placed 30 days back',
      case when v_days = 30 then 'PASS' else 'FAIL' end);

  end loop;
  reset timezone;
end;
$rule$;


-- ===========================================================================
-- 2. Each excluded status, asked individually.
--
-- Section 1 asserts the whole set, which would also pass if a row were absent
-- for the wrong reason. These name each exclusion so a failure says which.
-- ===========================================================================
do $exclusions$
declare
  u_staff_a uuid;
  r         record;
  v_hit     boolean;
begin
  select v into u_staff_a from t_ids where k = 'staff_a';

  for r in
    select k, case k
                when 'appt_today'     then 'the day has not passed'
                when 'appt_tomorrow'  then 'the day is in the future'
                when 'appt_attended'  then 'attendance was completed'
                when 'appt_missed'    then 'already asserted missed by staff'
                when 'appt_cancelled' then 'cancelled is inactive (0031)'
              end as why
      from t_ids
     where k in ('appt_today','appt_tomorrow','appt_attended','appt_missed','appt_cancelled')
  loop
    set local time zone 'UTC';
    perform pg_temp.as_user(u_staff_a);
    select exists (
      select 1 from public.overdue_followups() o
       where o.appointment_id = (select v from t_ids where k = r.k)
    ) into v_hit;
    reset role;

    insert into t_result values ('exclusion: ' || r.k, 'UTC', 'tb_dots A',
      'absent', case when v_hit then 'PRESENT' else 'absent' end, r.why,
      case when v_hit then 'FAIL' else 'PASS' end);
  end loop;

  -- The positive control for this whole section. If the fixture were invisible
  -- for some unrelated reason, every exclusion above would pass while proving
  -- nothing, so one row that MUST be present is asked the same way.
  set local time zone 'UTC';
  perform pg_temp.as_user(u_staff_a);
  select exists (
    select 1 from public.overdue_followups() o
     where o.appointment_id = (select v from t_ids where k = 'appt_yesterday')
  ) into v_hit;
  reset role;
  reset timezone;

  insert into t_result values ('positive control', 'UTC', 'tb_dots A',
    'present', case when v_hit then 'present' else 'ABSENT' end,
    'without this, every exclusion above could pass on an invisible fixture',
    case when v_hit then 'PASS' else 'FAIL' end);
end;
$exclusions$;


-- ===========================================================================
-- 3. The negative control: a current_date predicate disagrees with itself,
--    and overdue_followups() does not. Deterministic at every hour — see the
--    file header for why 25 hours of separation is what makes it so.
-- ===========================================================================
do $control$
declare
  u_staff_a uuid;
  d_mid     date;
  d_kir     date;
  shadow_mid boolean;
  shadow_kir boolean;
  real_mid   boolean;
  real_kir   boolean;
begin
  select v into u_staff_a from t_ids where k = 'staff_a';
  select midway_today, kiritimati_today into d_mid, d_kir from t_shadow;

  insert into t_result values ('control: dates differ', 'Midway vs Kiritimati', '-',
    'Midway strictly earlier',
    d_mid::text || ' vs ' || d_kir::text,
    'UTC-11 and UTC+14 are 25 hours apart, so their calendar dates always differ',
    case when d_mid < d_kir then 'PASS' else 'FAIL' end);

  -- The BROKEN predicate, evaluated directly, under each timezone.
  set local time zone 'Pacific/Midway';
  select (a.status = 'scheduled' and a.scheduled_date < current_date) into shadow_mid
    from public.appointments a
   where a.appointment_id = (select v from t_ids where k = 'appt_shadow');

  set local time zone 'Pacific/Kiritimati';
  select (a.status = 'scheduled' and a.scheduled_date < current_date) into shadow_kir
    from public.appointments a
   where a.appointment_id = (select v from t_ids where k = 'appt_shadow');
  reset timezone;

  insert into t_result values ('control: current_date is broken', 'Midway vs Kiritimati', '-',
    'false then true',
    coalesce(shadow_mid::text, 'null') || ' then ' || coalesce(shadow_kir::text, 'null'),
    'the same row, the same instant, two answers — this is the bug 0034 avoids',
    case when shadow_mid = false and shadow_kir = true then 'PASS' else 'FAIL' end);

  -- The SHIPPED predicate, same row, same two timezones.
  set local time zone 'Pacific/Midway';
  perform pg_temp.as_user(u_staff_a);
  select exists (
    select 1 from public.overdue_followups() o
     where o.appointment_id = (select v from t_ids where k = 'appt_shadow')
  ) into real_mid;
  reset role;

  set local time zone 'Pacific/Kiritimati';
  perform pg_temp.as_user(u_staff_a);
  select exists (
    select 1 from public.overdue_followups() o
     where o.appointment_id = (select v from t_ids where k = 'appt_shadow')
  ) into real_kir;
  reset role;
  reset timezone;

  insert into t_result values ('control: manila_today() is not', 'Midway vs Kiritimati', 'tb_dots A',
    'identical',
    coalesce(real_mid::text, 'null') || ' and ' || coalesce(real_kir::text, 'null'),
    'whichever answer is correct for the hour, both sessions must give it',
    case when real_mid = real_kir then 'PASS' else 'FAIL' end);
end;
$control$;


-- ===========================================================================
-- 4. Scoping, inherited from RLS rather than restated. Each persona is asked
--    what it can see of the OTHER facility as well as its own, so "sees
--    nothing" and "sees only its own" are distinguishable.
-- ===========================================================================
do $scoping$
declare
  v_own   int;
  v_other int;
  v_all   int;
begin
  -- TB-DOTS A: its own two overdue rows, none of B's.
  set local time zone 'UTC';
  perform pg_temp.as_user((select v from t_ids where k = 'staff_a'));
  select count(*) filter (where o.facility_id = (select v from t_ids where k = 'fac_a')),
         count(*) filter (where o.facility_id = (select v from t_ids where k = 'fac_b'))
    into v_own, v_other
    from public.overdue_followups() o
   where o.appointment_id in (select v from t_ids);
  reset role;

  insert into t_result values ('scope: own facility', 'UTC', 'tb_dots A',
    'sees A''s rows', v_own::text || ' row(s) of A', '',
    case when v_own >= 2 then 'PASS' else 'FAIL' end);

  insert into t_result values ('scope: cross-facility', 'UTC', 'tb_dots A',
    '0 of B', v_other::text || ' of B',
    'B has a genuinely overdue row, so this is isolation and not emptiness',
    case when v_other = 0 then 'PASS' else 'FAIL' end);

  -- TB-DOTS B: the mirror. Proves B's row exists and is reachable by someone.
  perform pg_temp.as_user((select v from t_ids where k = 'staff_b'));
  select count(*) filter (where o.facility_id = (select v from t_ids where k = 'fac_b')),
         count(*) filter (where o.facility_id = (select v from t_ids where k = 'fac_a'))
    into v_own, v_other
    from public.overdue_followups() o
   where o.appointment_id in (select v from t_ids);
  reset role;

  insert into t_result values ('scope: own facility', 'UTC', 'tb_dots B',
    '1 of B', v_own::text || ' of B',
    'the row A was not allowed to see is really there',
    case when v_own = 1 then 'PASS' else 'FAIL' end);

  insert into t_result values ('scope: cross-facility', 'UTC', 'tb_dots B',
    '0 of A', v_other::text || ' of A', '',
    case when v_other = 0 then 'PASS' else 'FAIL' end);

  -- BHW: sees their barangay's patients, both facilities' appointments, and
  -- gets a null case_number because no case exists here.
  perform pg_temp.as_user((select v from t_ids where k = 'bhw_1'));
  select count(*) into v_all
    from public.overdue_followups() o
   where o.appointment_id in (select v from t_ids);
  reset role;

  insert into t_result values ('scope: bhw barangay', 'UTC', 'bhw',
    '>= 3 rows', v_all::text || ' row(s)',
    'both patients are in the BHW''s barangay, so both facilities'' rows show',
    case when v_all >= 3 then 'PASS' else 'FAIL' end);

  -- Admin has no patients/appointments read policy at all.
  perform pg_temp.as_user((select v from t_ids where k = 'admin_1'));
  select count(*) into v_all from public.overdue_followups() o;
  reset role;
  reset timezone;

  insert into t_result values ('scope: admin', 'UTC', 'admin',
    '0 rows', v_all::text || ' row(s)',
    'admin holds no clinical read policy; SECURITY INVOKER must not grant one',
    case when v_all = 0 then 'PASS' else 'FAIL' end);
end;
$scoping$;


-- ===========================================================================
-- 5. It writes nothing. Detection is not mutation — the whole argument of
--    0034's header rests on this, so it is asserted rather than assumed.
-- ===========================================================================
do $readonly$
declare n_diff int;
begin
  select count(*) into n_diff
    from (
      select status, count(*) as n from public.appointments group by status
      except
      select status, n from t_before
    ) d;

  insert into t_result values ('writes nothing', '-', '-',
    'status counts unchanged',
    case when n_diff = 0 then 'unchanged' else n_diff::text || ' status(es) moved' end,
    'no row may have been relabelled by running the detection',
    case when n_diff = 0 then 'PASS' else 'FAIL' end);
end;
$readonly$;


-- ---------------------------------------------------------------------------
-- Cross-timezone agreement, stated as its own assertion.
-- ---------------------------------------------------------------------------
insert into t_result
select 'timezone agreement', 'four zones, 25h span', persona,
       'identical',
       case when count(distinct actual) = 1 then 'identical' else 'DIFFERS' end,
       string_agg(distinct tz || '=' || actual, ', '),
       case when count(distinct actual) = 1 then 'PASS' else 'FAIL' end
  from t_result
 where check_kind in ('rule: overdue set', 'rule: days_overdue')
 group by check_kind, persona, expected;


-- ---------------------------------------------------------------------------
-- THE MATRIX. Every row must read PASS. Failures sort to the top.
-- ---------------------------------------------------------------------------
select verdict, check_kind, tz, persona, expected, actual, detail
  from t_result
 order by (verdict = 'PASS'), check_kind, tz, persona;

do $verdict$
declare n_fail int; n_all int;
begin
  select count(*) filter (where verdict = 'FAIL'), count(*) into n_fail, n_all from t_result;

  if n_all = 0 then
    raise exception '0034 matrix produced no rows — the harness did not run';
  end if;
  if n_fail > 0 then
    raise exception '0034 matrix: % of % checks FAILED — do not apply 0034', n_fail, n_all;
  end if;
  raise notice '0034 matrix: all % checks PASSED', n_all;
end;
$verdict$;
