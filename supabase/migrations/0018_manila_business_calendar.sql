-- ============================================================================
-- TB-Screen — 0018_manila_business_calendar.sql
-- D-04: the reporting functions computed "today" and date ranges in UTC while
-- every user is in Bukidnon (Asia/Manila, UTC+8, no DST).
--
-- The database session timezone is UTC (verified against the live project:
-- `show timezone` = UTC; no migration ever set it). So `current_date` was the
-- UTC calendar date and `timestamptz::date` truncated at UTC midnight — which
-- is 08:00 in Manila. Every "today" window therefore ran 08:00 → 08:00 local:
--
--   * screened_today / referred_today / positive_today / negative_today —
--     work recorded between midnight and 08:00 local counted toward the
--     PREVIOUS day, and dropped out of the tile at 08:00 rather than midnight.
--   * attended/missed/scheduled_today — worse, because appointments
--     .scheduled_date is a plain `date` written from the device in LOCAL terms
--     (toDateOnly, mobile/app/referral/[screeningId].tsx). Comparing it to a
--     UTC current_date meant that every morning from midnight to 08:00 the
--     dashboard listed YESTERDAY's appointments — exactly the hours TB-DOTS
--     staff open the portal to see who is coming in.
--   * hotspot_counts — the portal sends Manila calendar dates (HotspotView
--     via toDateOnly); comparing a timestamptz to a bare `date` promoted that
--     date to UTC midnight, so the window ran 8 hours late at both ends.
--
-- FIX: two small helpers pin the business calendar to Asia/Manila, and the
-- comparisons become half-open ranges on the raw timestamptz instead of
-- ::date casts — a cast on the column cannot use an index, a range can.
--
-- The zone is hardcoded. The Philippines is a single timezone and has had no
-- DST since 1978; sms-reminders/index.ts already hardcodes 'Asia/Manila' the
-- same way. If that ever changes, these two helpers are the only place to fix.
--
-- NOT CHANGED: bhw_activity(days_back) compares against
-- `now() - make_interval(days => days_back)` — a rolling window from the
-- current instant, which is timezone-independent and already correct.
-- admin_overview() has no date logic.
--
-- No schema change, no data change, no positioning change (§1): the same
-- counts, filed under the day they actually happened.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers. STABLE (not IMMUTABLE): manila_today() reads the clock, and
-- `at time zone` depends on the tz database. Neither is used in an index.
-- search_path is pinned on both — Supabase's security advisor flags functions
-- that leave it mutable.
-- ---------------------------------------------------------------------------
create or replace function public.manila_today()
returns date
language sql
stable
set search_path = public
as $fn$
  select (now() at time zone 'Asia/Manila')::date;
$fn$;

comment on function public.manila_today() is
  'Today''s calendar date in Asia/Manila — the business calendar for the whole '
  'system. Use instead of current_date, which is UTC (0018).';

create or replace function public.manila_day_start(d date)
returns timestamptz
language sql
stable
set search_path = public
as $fn$
  select d::timestamp at time zone 'Asia/Manila';
$fn$;

comment on function public.manila_day_start(date) is
  'The instant midnight-in-Manila begins on calendar date d. Pair as '
  'ts >= manila_day_start(d) and ts < manila_day_start(d + 1) to bound a '
  'local day without casting the column (0018).';

-- ---------------------------------------------------------------------------
-- dashboard_counts() — unchanged signature, role gate and output. Only the
-- date predicates move from UTC to Manila.
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
  if public.current_user_role() is distinct from 'tb_dots' then
    raise exception 'dashboard_counts: TB-DOTS role required';
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
  'the Asia/Manila calendar day (0018). Counts only; TB-DOTS role required; '
  'never per-patient data.';

-- ---------------------------------------------------------------------------
-- hotspot_counts() — unchanged signature, role gate, grouping and output.
-- from_date/to_date are now read as Manila calendar dates, which is what the
-- portal has always sent.
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
  -- TB-DOTS staff only (portal). BHWs and anonymous callers get an error, not
  -- data. (EXECUTE is granted broadly by default; this check is the gate.)
  if public.current_user_role() is distinct from 'tb_dots' then
    raise exception 'hotspot_counts: TB-DOTS role required';
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
  'Aggregate presumptive-case counts by barangay for the TB-DOTS portal '
  '(Feature 10), over the Asia/Manila calendar range from_date..to_date '
  'inclusive (0018). Counts only; TB-DOTS role required; never per-patient data.';
