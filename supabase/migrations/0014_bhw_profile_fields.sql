-- ============================================================================
-- TB-Screen — 0014_bhw_profile_fields.sql
-- Captain page redesign (v2 "My BHWs" drawer): give account rows the identity
-- fields the redesigned form edits, and a first-sign-in password gate.
--
-- 1. users name parts (first/middle/last) — mirrors patients (0010). WHY parts:
--    the redesigned edit drawer round-trips first / middle / last independently;
--    splitting full_name by spaces on every edit is lossy for middle names.
--    full_name STAYS as the composed display string ("First Middle Last"),
--    written by manage-bhw on every create/update — every existing reader (web
--    App/referrals, mobile session/attribution, specimen print) consumes it, so
--    keeping it avoids rewriting them. Nullable, like patients (0010).
-- 2. users.purok — the BHW's coverage area within the barangay (captain-managed,
--    free text e.g. "Purok 3"). Only BHW rows use it; captains/staff leave null.
-- 3. users.must_change_password — set true when an account is provisioned or its
--    password is reset (manage-bhw), cleared once the account sets its own
--    password on first sign-in. Drives the forced-change flow on the sign-in
--    surfaces (mobile for BHWs, web for captains/staff).
-- 4. bhw_activity() gains the parts, purok, account email (auth.users) and the
--    joined date so the captain's edit drawer can show them. Still counts only —
--    NO patient-level data (§1). SECURITY DEFINER as before; the email returned
--    is the BHW's OWN account email, which the captain already provisions.
--
-- POSITIONING (§1) unchanged: identity fields only — nothing computed, scored,
-- or diagnostic.
-- ============================================================================

alter table public.users
  add column if not exists first_name            text,
  add column if not exists middle_name           text,
  add column if not exists last_name             text,
  add column if not exists purok                 text,
  add column if not exists must_change_password  boolean not null default false;

comment on column public.users.first_name is
  'Given name. Written by manage-bhw; nullable for pre-0014 rows (backfilled below).';
comment on column public.users.middle_name is
  'Middle name. Optional — not every account has one.';
comment on column public.users.last_name is
  'Family name. Written by manage-bhw; nullable for pre-0014 rows (backfilled below).';
comment on column public.users.purok is
  'BHW coverage area within the assigned barangay (free text, e.g. "Purok 3"). '
  'BHW rows only; null for captains and TB-DOTS staff.';
comment on column public.users.must_change_password is
  'True while the account still holds an admin/captain-provisioned or reset '
  'password; cleared once the user sets their own password on first sign-in.';

-- ---------------------------------------------------------------------------
-- Backfill name parts by splitting full_name (same best-effort rule as 0010):
-- first word = first name, last word = last name, anything between = middle.
-- Runs only where the parts are still empty, so re-running is safe.
-- ---------------------------------------------------------------------------
update public.users
set
  first_name = split_part(trim(full_name), ' ', 1),
  last_name  = nullif(
                 split_part(trim(full_name), ' ',
                            array_length(string_to_array(trim(full_name), ' '), 1)),
                 split_part(trim(full_name), ' ', 1)
               ),
  middle_name = nullif(
                  trim(both ' ' from
                    regexp_replace(
                      regexp_replace(trim(full_name), '^\S+\s*', ''),
                      '\s*\S+$', ''
                    )
                  ),
                  ''
                )
where full_name is not null
  and trim(full_name) <> ''
  and first_name is null
  and last_name is null;

-- ---------------------------------------------------------------------------
-- bhw_activity() — captain's BHW-management source. Return type changes (new
-- columns), so it must be dropped and recreated (create-or-replace cannot alter
-- OUT columns). Same guard, scope, and attribution note as 0006.
-- ---------------------------------------------------------------------------
drop function if exists public.bhw_activity(int);

create function public.bhw_activity(days_back int default 30)
returns table (
  user_id        uuid,
  full_name      text,
  first_name     text,
  middle_name    text,
  last_name      text,
  purok          text,
  email          text,
  barangay_code  text,
  barangay_name  text,
  joined_at      timestamptz,
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

  return query
  select
    u.user_id,
    u.full_name,
    u.first_name,
    u.middle_name,
    u.last_name,
    u.purok,
    au.email,
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
    and u.facility_id = public.current_user_facility()
  order by u.full_name;
end;
$$;

comment on function public.bhw_activity(int) is
  'Per-BHW account (identity + own email + coverage) and 30-day activity counts '
  'for the Barangay-Captain view. Captain role required; scoped to the caller''s '
  'facility; no patient data.';
