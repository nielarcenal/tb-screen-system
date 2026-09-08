-- ============================================================================
-- TB-Screen BHW — 0027_barangay_report.sql
-- Barangay Report: the screening-and-referral funnel, aggregated by barangay.
--
-- WHY THIS EXISTS. The Valencia City Health Office compiles its per-barangay TB
-- figures BY HAND (2024–2025 sheet, signed by the City TB Nurse Coordinator).
-- This function produces, continuously and automatically, the portion of that
-- work the system actually observes.
--
-- WHAT IT IS NOT — and the report UI must keep saying so:
--   * NOT the city case register. The CHO's "All Forms" count includes every
--     case from every source: walk-ins elsewhere, private clinics, other
--     facilities, extrapulmonary. This function only ever sees patients who
--     passed through THIS system — a BHW referral, or a walk-in registered at
--     TB-DOTS (0025). It is a subset by construction and always will be.
--   * NOT treatment outcomes. There is no TX Completed column here because
--     there is no treatment register anywhere in this schema: no treatment
--     start, no regimen, no cohort close-out. Adding one would push the system
--     out of "pre-screening + referral follow-up" into DOTS case management.
--
-- POSITIONING (§1, §5). `positive_count` is reported because TB-DOTS ENTERED
-- that result, not because anything here concluded it. The system reports the
-- facility's diagnosis; it never makes one. No score is computed, and `referred`
-- still comes from the DOH-NTP checklist alone.
--
-- PRIVACY (§6). Aggregate `GROUP BY barangay_code` ONLY — the same boundary
-- hotspot_counts() (0004) holds. No sitio, no household, no address, no
-- per-patient row, and no drill-down path from any column. Counts only.
--
-- SECURITY DEFINER for the same reason as 0004: these counts cross all BHWs and
-- facilities, which the row-level policies (0002) deliberately forbid any single
-- user to read row by row. Crossing that boundary is allowed ONLY as aggregates,
-- and only for the two roles that have a reporting job.
--
-- DATE BASIS — read this before comparing columns. Each column counts events OF
-- ITS OWN KIND that fall in the period, using that event's own timestamp:
-- screenings by `screenings.created_at`, referral columns by
-- `referrals.created_at`, missed check-ups by `appointments.scheduled_date`.
-- So a patient screened in December and tested in January lands in DIFFERENT
-- periods for `screened_count` and `tested_count`. That is deliberate — it is
-- how the health office counts too (an event belongs to the year it happened)
-- — but it means the columns are NOT a strict funnel within one period and
-- must never be presented as "X of these Y went on to...". The UI states this.
-- ============================================================================

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
begin
  -- Reporting roles only. A BHW or an anonymous caller gets an error, not data
  -- — same gate shape as hotspot_counts(), widened to admin because the
  -- developer portal carries the province-wide view.
  if public.current_user_role() not in ('tb_dots', 'admin') then
    raise exception 'barangay_report: TB-DOTS or admin role required';
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
  'Counts only, GROUP BY barangay_code only (§6); TB-DOTS or admin required. '
  'A SUBSET of the health office case register, never a replacement: no '
  'treatment outcomes exist in this schema, and only patients seen through '
  'this system are counted.';
