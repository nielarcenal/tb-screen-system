-- ============================================================================
-- TB-Screen — 0020_immutable_identity_columns.sql
-- D-09, as it turned out to actually be.
--
-- WHAT THE AUDIT SAID, AND WHY IT WAS WRONG: the finding was "three UPDATE
-- policies in 0007 are missing WITH CHECK". They are (four, in fact — it also
-- missed appointments_tbdots_update, from 0005) — but that is not a hole.
-- PostgreSQL's CREATE POLICY docs are explicit:
--
--   "if no WITH CHECK expression is defined, then the USING expression will be
--    used both to determine which rows are visible (normal USING case) and
--    which new rows will be allowed to be added (WITH CHECK case)."
--
-- So the post-update row is already checked. Mirroring USING into WITH CHECK
-- would have been a cosmetic no-op. DO NOT "finish" D-09 by adding one.
--
-- THE REAL HOLE, found while verifying that: the effective check IS the USING
-- expression, and `authenticated` holds UPDATE grants on the very columns those
-- expressions test. A holder of a BHW token driving PostgREST directly (not the
-- app — the app has no UI for any of this) can move a row and then satisfy the
-- check from its new position:
--
--   1. patients: set enrolled_by = auth.uid() AND barangay_code = <somewhere
--      else>. Passes via the enrolled_by branch of patients_bhw_read/update.
--      The patient leaves their barangay's roster and, more to the point, the
--      GROUP BY barangay_code aggregate the hotspot view reports.
--   2. patients: set enrolled_by = <any uuid> on any patient in own barangay.
--      Passes via the barangay_code branch. Rewrites the enrolling-BHW name the
--      portal displays (ReferralDetail embeds users!patients_enrolled_by_fkey).
--   3. screenings / appointments / referrals: patient_id is granted, and the
--      policies only require the NEW parent to be visible. A symptom checklist
--      and its `referred` flag can be re-parented onto a different patient.
--   4. appointments_tbdots_update: same re-parenting for facility staff, among
--      the patients referred to their facility.
--
-- WHY NOT WITH CHECK: an RLS policy cannot see OLD, so it cannot express
-- "this column did not change". The property we need is not about the row's
-- destination — every destination above is one the caller may legitimately
-- reach — it is about the MOVE. Only a trigger can see a move.
--
-- WHY NOT REVOKE THE COLUMN GRANTS (the 0017 technique): mobile pushes
-- whole-row upserts (syncEngine.ts PATIENTS_PUSH et al), so patient_id and
-- enrolled_by land in the ON CONFLICT DO UPDATE SET list on every re-push of an
-- edited row. Revoking UPDATE on them would break sync for every patient edit.
-- A trigger comparing OLD to NEW passes those idempotent re-sends untouched and
-- rejects only genuine changes.
--
-- SCOPE — this one IS server-enforced, unlike D-05 and D-06. A trigger fires
-- for every caller that is not exempted below; no client-side trick avoids it.
--
-- POSITIONING (§1) unchanged: this constrains who may rewrite an identifier.
-- Nothing is computed, scored or diagnostic.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- enforce_immutable_columns()
--
-- Generic: the pinned column names come from the trigger's arguments, so one
-- function serves all four tables and adding a column later is a CREATE TRIGGER
-- change, not a rewrite. Compares OLD to NEW through to_jsonb() so the columns
-- can be named as strings; `is distinct from` on jsonb gets NULL handling right
-- (a SQL NULL becomes jsonb 'null' on BOTH sides, so it compares equal to
-- itself and unequal to a value — which is what we want). Each name is also
-- checked for existence first, because the failure mode of a typo here is
-- silent: two missing keys both read as SQL NULL and every row looks unchanged.
--
-- SECURITY INVOKER (the default) is deliberate: this function grants nothing,
-- it only refuses. It must run with the caller's identity so auth.role() below
-- reads the caller's JWT.
--
-- WHO IS EXEMPT, AND WHY:
--   * no JWT at all (auth.role() is null) — a direct database session: the SQL
--     editor, psql, a migration. Back-office repair has to stay possible, and
--     anyone with a direct session is past every other boundary already.
--   * role = 'service_role' — the Edge Functions. This is NOT theoretical:
--     manage-bhw's deactivate handler reassigns a departing BHW's caseload with
--     `update patients set enrolled_by = <successor>` (index.ts ~373). Without
--     this exemption, deactivating a BHW would fail outright.
-- Everything else — 'authenticated' and 'anon' alike — is enforced.
--
-- errcode 42501 (insufficient_privilege) is chosen so PostgREST returns 403 and
-- the mobile sync classifies it PERMANENT (syncErrors.ts): the row stays pending
-- and is reported as "could not be uploaded" rather than aborting the pass. In
-- practice the app can never trigger it — no screen writes any of these columns.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_immutable_columns()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  jwt_role   text := auth.role();
  before_row jsonb;
  after_row  jsonb;
  col        text;
begin
  if jwt_role is null or jwt_role = '' or jwt_role = 'service_role' then
    return new;
  end if;

  before_row := to_jsonb(old);
  after_row  := to_jsonb(new);

  foreach col in array tg_argv loop
    -- A misspelled column name would otherwise compare SQL NULL to SQL NULL on
    -- every row — silently protecting nothing. Fail loudly instead. Note this
    -- must be jsonb_exists() and not a NULL test: a real column holding NULL is
    -- present as jsonb 'null', which is exactly the case we still want checked.
    if not jsonb_exists(before_row, col) then
      raise exception
        'enforce_immutable_columns: %.% does not exist', tg_table_name, col
        using errcode = '42703',
              hint = 'Fix the column name in the CREATE TRIGGER arguments.';
    end if;

    if before_row -> col is distinct from after_row -> col then
      raise exception
        'column %.% cannot be changed once the row exists', tg_table_name, col
        using errcode = '42501',
              hint = 'Identity and parent-row columns are fixed at creation.';
    end if;
  end loop;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The triggers.
--
-- Named *_immutable_columns, which sorts before *_set_updated_at (0001) — BEFORE
-- ROW triggers fire in alphabetical order. The order does not actually matter
-- here (updated_at is not pinned), but the two must never be merged: one
-- rewrites the row, this one only inspects it.
--
-- NOT pinned, deliberately:
--   * referrals.facility_id — referrals_tbdots_update's WITH CHECK already pins
--     it to the staff member's own facility, and a BHW re-routing their own
--     not-yet-received referral to a different DOTS centre is a real workflow
--     (the patient chose to go elsewhere). referrals_bhw_update already limits
--     that to status='submitted' with no result recorded.
--   * every clinical/demographic column — those are what the edit screens are
--     FOR. This migration is about identity and parentage only.
-- ---------------------------------------------------------------------------

drop trigger if exists patients_immutable_columns on public.patients;
create trigger patients_immutable_columns
  before update on public.patients
  for each row execute function public.enforce_immutable_columns(
    'patient_id', 'display_code', 'enrolled_by', 'barangay_code'
  );

drop trigger if exists screenings_immutable_columns on public.screenings;
create trigger screenings_immutable_columns
  before update on public.screenings
  for each row execute function public.enforce_immutable_columns(
    'screening_id', 'patient_id'
  );

drop trigger if exists appointments_immutable_columns on public.appointments;
create trigger appointments_immutable_columns
  before update on public.appointments
  for each row execute function public.enforce_immutable_columns(
    'appointment_id', 'patient_id'
  );

drop trigger if exists referrals_immutable_columns on public.referrals;
create trigger referrals_immutable_columns
  before update on public.referrals
  for each row execute function public.enforce_immutable_columns(
    'referral_id', 'patient_id', 'screening_id'
  );

-- ============================================================================
-- POST-CHECKS (run separately — the SQL editor returns only the last result).
--
-- 1. All four triggers exist, with the right pinned columns:
--
--    select c.relname as tbl, t.tgname, t.tgargs
--      from pg_trigger t
--      join pg_class c on c.oid = t.tgrelid
--      join pg_namespace n on n.oid = c.relnamespace
--     where n.nspname = 'public'
--       and not t.tgisinternal
--       and t.tgname like '%_immutable_columns'
--     order by 1;
--
--    Expect 4 rows: appointments, patients, referrals, screenings.
--
-- 2. The function is SECURITY INVOKER (prosecdef = false) — if this ever reads
--    true, auth.role() stops seeing the caller and every session looks exempt:
--
--    select proname, prosecdef, proconfig
--      from pg_proc p
--      join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and proname = 'enforce_immutable_columns';
--
--    Expect prosecdef = false, proconfig = {search_path=public}.
--
-- No backfill and no data migration: this constrains future UPDATEs only.
-- ============================================================================
