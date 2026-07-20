-- ============================================================================
-- TB-Screen BHW — 0010_patient_name_parts.sql
-- Split the single patient name field into first / middle / last.
--
-- WHY full_name STAYS: it remains the composed display string ("First Middle
-- Last"), written by the app on every insert/update. Every reader in the system
-- already consumes it — the web portal inbox + referral detail, the mobile
-- patient list, follow-ups, the specimen print form, and the dashboard SQL in
-- mobile/src/db/dashboardRepo.ts — so keeping it avoids rewriting all of them
-- and keeps one canonical display string for printed referral slips.
--
-- It is deliberately NOT a Postgres generated column: the mobile sync engine
-- upserts the whole row (mobile/src/sync/syncEngine.ts toServerPayload), and
-- Postgres rejects any write that targets a generated column, which would break
-- every push.
--
-- Nullable, like full_name in 0006: rows enrolled before this migration have no
-- parts. The app requires first + last for NEW enrollments; middle is optional
-- (not every patient has one).
--
-- PRIVACY (§4) unchanged: name parts ride the SAME row-level policies as the
-- rest of the patient row. No new policy is needed — patients_bhw_read /
-- patients_bhw_update / patients_tbdots_read already gate the whole row.
-- POSITIONING (§1, §5) unchanged: nothing here is computed, scored, or
-- diagnostic. These are identity fields only.
-- ============================================================================

alter table public.patients
  add column if not exists first_name  text,
  add column if not exists middle_name text,
  add column if not exists last_name   text;

comment on column public.patients.first_name is
  'Given name. Required by the app for new enrollments; nullable for pre-0010 rows.';
comment on column public.patients.middle_name is
  'Middle name. Optional — not every patient has one.';
comment on column public.patients.last_name is
  'Family name. Required by the app for new enrollments; nullable for pre-0010 rows.';
comment on column public.patients.full_name is
  'Composed display string "First Middle Last", written by the app from the '
  'name parts. Kept for display/printing; not a generated column because the '
  'mobile sync pushes whole rows.';

-- ---------------------------------------------------------------------------
-- Backfill existing rows by splitting full_name: first word = first name,
-- last word = last name, anything between = middle. Best-effort only — a
-- one-word name becomes the first name with no last name, which the app then
-- shows as-is. Runs only where the parts are still empty, so re-running is safe.
-- ---------------------------------------------------------------------------
update public.patients
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
