-- ============================================================================
-- TB-Screen BHW — seed.sql
-- Feature 1 seed data (brief §8): one facility of each type, one BHW user, one
-- TB-DOTS user, plus a SMALL Bukidnon PSGC sample so address FKs resolve during
-- testing. This is NOT the full PSGC import — that is a separate data task.
--
-- Safe to re-run: uses fixed UUIDs + ON CONFLICT DO NOTHING.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PSGC reference data: run supabase/seed_psgc_bukidnon.sql (generated from the
-- official PSA PSGC dataset — full Bukidnon: 22 LGUs, 464 barangays) BEFORE the
-- facilities/users blocks below. With the Supabase CLI:
--   psql "$DATABASE_URL" -f supabase/seed_psgc_bukidnon.sql
-- or paste it into the SQL editor. Idempotent.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Facilities — one of each type.
-- ---------------------------------------------------------------------------
insert into public.facilities (facility_id, name, type, address) values
  ('00000000-0000-0000-0000-0000000000b1',
   'Casisang Barangay Health Station', 'barangay_health_station',
   'Casisang, Malaybalay City, Bukidnon'),
  ('00000000-0000-0000-0000-0000000000d1',
   'Bukidnon Provincial TB-DOTS Center', 'tb_dots',
   'Malaybalay City, Bukidnon')
on conflict (facility_id) do nothing;

-- ---------------------------------------------------------------------------
-- Users — IMPORTANT: public.users.user_id references auth.users(id). Auth users
-- must exist FIRST. SQL cannot safely create Supabase auth accounts (password
-- hashing / GoTrue internals), so create the two accounts via the Supabase Auth
-- API/dashboard, then paste their UIDs below and run this block.
--
-- Recommended local flow (Supabase CLI running):
--   1) Create the BHW account:
--      curl -X POST "$SUPABASE_URL/auth/v1/admin/users" \
--        -H "apikey: $SERVICE_ROLE_KEY" \
--        -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
--        -H "Content-Type: application/json" \
--        -d '{"email":"bhw@test.local","password":"Test1234!","email_confirm":true}'
--   2) Repeat for tb_dots@test.local.
--   3) Copy each returned "id" into the placeholders below and run this block.
-- ---------------------------------------------------------------------------
-- insert into public.users (user_id, role, full_name, facility_id, assigned_barangay_code) values
--   ('<PASTE_BHW_AUTH_UID>',     'bhw',     'Test BHW',
--    '00000000-0000-0000-0000-0000000000b1', '101312012'),  -- Casisang, Malaybalay (real PSGC)
--   ('<PASTE_TBDOTS_AUTH_UID>',  'tb_dots', 'Test TB-DOTS Staff',
--    '00000000-0000-0000-0000-0000000000d1', null)
-- on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Barangay Captain test account (0006). Same flow: create the auth user first
-- (captain@test.local / Test1234!), then paste the UID and run. The captain
-- MUST share facility_id with the BHWs they manage (users_read_same_facility
-- is how they list accounts) — here that is the Casisang BHS.
-- ---------------------------------------------------------------------------
-- insert into public.users (user_id, role, full_name, facility_id, assigned_barangay_code) values
--   ('<PASTE_CAPTAIN_AUTH_UID>', 'captain', 'Test Barangay Captain',
--    '00000000-0000-0000-0000-0000000000b1', '101312012')
-- on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 0006 backfill: demo names for the TEST patients. Patients enrolled before
-- migration 0006 have full_name = null (the UI falls back to the display
-- code); this gives the seeded demo rows the design's names so the portal
-- and app show names during testing. Safe to re-run: only touches rows whose
-- name is still null, matched by display_code. Real enrollments are never
-- affected. (Birthdate is left null — the stored age was not derived from
-- one, and the UI handles a missing birthdate.)
-- ---------------------------------------------------------------------------
update public.patients p
set full_name = v.name
from (values
  ('PAT-TEST-0001', 'Maria Santos'),
  ('PAT-TEST-0002', 'Jose Ramirez'),
  ('PAT-TEST-0003', 'Elena Cruz'),
  ('PAT-TEST-0004', 'Ricardo Dela Peña'),
  ('PAT-TEST-0005', 'Luzviminda Ocampo'),
  ('PAT-TEST-0006', 'Antonio Villanueva')
) as v(code, name)
where p.display_code = v.code
  and p.full_name is null;
