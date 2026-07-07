-- ============================================================================
-- TB-Screen BHW — 0004_hotspot_counts.sql
-- Feature 10: Barangay Hotspot View (brief §6, §8.10).
--
-- SURVEILLANCE, NOT CONTACT TRACING: this function returns ONLY aggregate
-- counts grouped by barangay_code. There is deliberately NO household, sitio,
-- address, or per-patient output of any kind, and no way to drill down through
-- it. Grouping is solely on the PSGC barangay_code (§6).
--
-- Why SECURITY DEFINER: hotspot counts aggregate ACROSS all BHWs/facilities,
-- which the row-level policies (0002) intentionally do not allow any single
-- user to read row-by-row. This function crosses that boundary in a controlled
-- way — TB-DOTS callers only, counts only (exactly as promised in 0002's
-- header comment).
--
-- Definition of a "presumptive case" here: a patient with at least one
-- screening in the date range where referred = true — i.e. flagged for
-- referral by the DOH-NTP checklist (§5). A patient screened twice in the
-- period still counts ONCE (count(distinct patient_id)). No score anywhere.
-- ============================================================================

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
as $$
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
    and s.created_at >= from_date
    and s.created_at <  (to_date + 1)   -- inclusive end date
  group by p.barangay_code, b.name, c.name
  order by count(distinct p.patient_id) desc, b.name asc;
end;
$$;

comment on function public.hotspot_counts(date, date) is
  'Aggregate presumptive-case counts by barangay for the TB-DOTS portal '
  '(Feature 10). Counts only; TB-DOTS role required; never per-patient data.';
