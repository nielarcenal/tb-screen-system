-- ============================================================================
-- 0035_referral_audit_trail.sql — Task 6.2, "major referral status changes".
--
-- ---------------------------------------------------------------------------
-- THE GAP
--
-- 0031 built audit_logs and covers the case triad well: create_tb_case(),
-- set_tb_case_status(), transfer_tb_case(), record_visit() and the follow-up
-- RPCs all call app_private.write_audit().
--
-- REFERRALS ARE ENTIRELY OUTSIDE IT. The `entity_table` CHECK admits only
-- 'tb_cases', 'treatment_followups' and 'appointments', and no referral write
-- path calls write_audit() at all. So a referral moving submitted → received →
-- tested → closed, a facility recording that the patient did not present, and a
-- re-route to a different facility all leave no trace beyond a single mutable
-- `updated_at` that names the most recent write of any kind.
--
-- Two consequences already documented elsewhere in this branch:
--
--   * Task 6.2 asks for "major referral status changes" and nothing records
--     them.
--   * Task 4.1 §2 could not date `referral_received`, `referral_closed` or
--     `patient_did_not_present` on the patient timeline, because the schema
--     holds no moment for any of them, and audit_logs could not fill the gap
--     for exactly the reason above.
--
-- This migration closes that, FORWARD ONLY. It adds no nullable `received_at`
-- column and backfills nothing: a historical transition genuinely has no
-- recorded moment, and inventing one from `updated_at` would put a guess in a
-- column whose name reads as a fact. Transitions from here on are dated; older
-- ones stay honestly absent. That was the alternative Task 4.1 §2 said it would
-- take if the column-adding option were rejected, and it is strictly better
-- than either — an audit row needs no backfill to be truthful.
--
-- ---------------------------------------------------------------------------
-- WHY A TRIGGER AND NOT RPC CALL SITES
--
-- Referrals are written by ordinary PostgREST PATCHes from both the portal and
-- the mobile app; there is no referral RPC to add a write_audit() call to.
-- A trigger captures the change whatever path made it, which is the property
-- an audit trail needs, and it requires no client change on either side — so
-- rule 20 is not engaged and no build has to ship for this to start working.
--
-- Appointments have the same hole (a PATCH to 'attended' or 'missed' writes no
-- audit row; only the 0031 RPC paths do) and are DELIBERATELY NOT FIXED HERE.
-- The same trigger on appointments would double-log every RPC-driven change,
-- because those functions already write their own audit rows. Reconciling that
-- means either replacing five applied functions to drop their explicit calls,
-- or introducing a transaction-local "already audited" flag — a real unit with
-- its own review, not a rider on this one. It is recorded in ISSUES.md instead.
--
-- ---------------------------------------------------------------------------
-- THE LATENT BUG THIS FILE HAD TO FIX FIRST
--
-- enforce_audit_changes_whitelist() (0031) builds its allowed-key list with a
-- CASE over entity_table that has no ELSE. For an unlisted table `allowed` is
-- NULL, `k = any(NULL)` is NULL, `not NULL` is NULL, and `if NULL then raise`
-- does not fire — so the whitelist ACCEPTS EVERY KEY. Today that is invisible,
-- because the entity_table CHECK rejects the row a moment later. The instant
-- this migration adds 'referrals' to that CHECK, the guard would have gone
-- quiet for the very table being added.
--
-- This is the same shape as R3-03 (a CHECK that evaluates to NULL is accepted)
-- and it is fixed the same way: spell out the unknown case and make it raise.
-- §4 of the matrix proves the guard fires for referrals, and proves an
-- unrecognised entity_table now fails loudly instead of passing.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT AUDITED
--
-- `result` is free clinical text and is excluded, as everywhere else.
--
-- `result_outcome` — positive/negative — is excluded too, and that is the
-- decision in this file most worth arguing with. audit_logs is readable by
-- `admin`, a role that holds NO clinical read policy at all: it cannot read a
-- patients row, a referral or a case. Putting a TB result into `changes` would
-- hand every patient's TB status to that role through the audit viewer, which
-- is precisely the disclosure 0031's own comment on the admin policy warns
-- about ("If the whitelist is ever widened, this policy must be revisited in
-- the same migration").
--
-- So the trail records THAT an outcome was recorded and WHEN — `result_date`
-- moves from null to a date, under action 'updated' — and never what it said.
-- Task 4.1 drew the same line for the timeline's `lab_result_recorded`, for
-- the same reason. The audit answers "who touched this referral, when, and
-- what stage did it move to", which is what an audit trail is for.
--
-- Per that pinned obligation, §5 revisits the admin policy explicitly rather
-- than leaving it to be inferred.
--
-- ---------------------------------------------------------------------------
-- Verified by supabase/tests/0035_referral_audit_matrix.sql. Run
--     node scripts/build-preflight.mjs 0035
-- and execute the generated file; it wraps both in one rolled-back transaction.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Admit referrals to the audit surface.
--
-- Widening a CHECK never invalidates existing rows, so this needs no scan-free
-- caveat: every current row already satisfies the narrower predicate.
-- ---------------------------------------------------------------------------
alter table public.audit_logs drop constraint if exists audit_logs_entity_table_check;
alter table public.audit_logs
  add constraint audit_logs_entity_table_check
  check (entity_table in ('tb_cases','treatment_followups','appointments','referrals'));


-- ---------------------------------------------------------------------------
-- 2. The whitelist, with the NULL hole closed.
--
-- Transcribed from 0031 §3 with two changes and nothing else: a 'referrals'
-- arm, and an ELSE that raises. The three existing arms are byte-identical to
-- the applied version — verify with scripts/verify-0035-whitelist.mjs, which
-- diffs them against 0031's source and self-tests by mutating its own input.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_audit_changes_whitelist()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  allowed text[];
  k       text;
begin
  if new.changes is null then
    new.changes := '{}'::jsonb;
  end if;

  if jsonb_typeof(new.changes) <> 'object' then
    raise exception 'audit_logs.changes must be a JSON object, got %',
      jsonb_typeof(new.changes)
      using errcode = '22023';
  end if;

  allowed := case new.entity_table
    when 'tb_cases' then array[
      'case_status','treatment_start_date','outcome','outcome_date',
      'registration_date','facility_id','case_number']
    when 'treatment_followups' then array[
      'visit_date','voided_at','void_reason']
    when 'appointments' then array[
      'status','scheduled_date','attended_date',
      'facility_id','referral_id','tb_case_id']
    -- 0035. `result` and `result_outcome` are absent on purpose — see this
    -- file's header for why a TB finding must not reach an admin-readable log.
    when 'referrals' then array[
      'status','presented','result_date','facility_id','lab_sample_id']
  end;

  -- 0035. Without this, an entity_table the CASE does not name leaves `allowed`
  -- NULL, every `k = any(allowed)` evaluates to NULL, and the loop below raises
  -- nothing — the whitelist silently accepts anything. It was masked only by
  -- the entity_table CHECK, which is not a guarantee this function may rely on:
  -- the CHECK is evaluated AFTER this BEFORE trigger, and widening it (as §1
  -- just did) is exactly when the two disagree.
  if allowed is null then
    raise exception 'audit_logs: no whitelist is defined for entity_table %',
      new.entity_table
      using errcode = '22023',
            hint = 'Add an arm to enforce_audit_changes_whitelist() in the same '
                   'migration that widens the entity_table CHECK.';
  end if;

  for k in select jsonb_object_keys(new.changes) loop
    if not (k = any(allowed)) then
      raise exception
        'audit_logs: column %.% is not on the audit whitelist',
        new.entity_table, k
        using errcode = '42501',
              hint = 'Clinical free text and contact data must never be audited. '
                     'Widening the whitelist takes a migration and a review.';
    end if;
  end loop;

  return new;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 3. The referral audit trigger.
--
-- SECURITY DEFINER because app_private.write_audit() is revoked from every
-- role including `authenticated`; the trigger must be able to reach it however
-- the referral was written. write_audit() still reads auth.uid() and
-- current_user_active_role() from the CALLER's JWT, so the actor recorded is
-- whoever made the change, not the definer. A service-role or direct-session
-- write records a null actor, which is the truth about such a write.
--
-- AFTER UPDATE only:
--
--   * INSERT is not audited. A referral's creation already has an immutable
--     `created_at` that nothing can move, so an audit row would restate a fact
--     the table already holds honestly. (Contrast the transitions, which have
--     no column at all — that asymmetry is the whole reason this file exists.)
--   * DELETE is not audited because nothing may delete a referral: there is no
--     DELETE policy for any client role, and tb_cases.referral_id is
--     ON DELETE RESTRICT.
--
-- The trigger writes ONLY when a watched column actually moved. `referrals` has
-- an updated_at trigger, so a no-op PATCH and a stray touch both produce an
-- UPDATE; auditing those would fill the trail with rows that record nothing.
-- ---------------------------------------------------------------------------
create or replace function public.audit_referral_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_changes jsonb := '{}'::jsonb;
  v_action  text;
begin
  if new.status is distinct from old.status then
    v_changes := v_changes || jsonb_build_object(
      'status', jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.presented is distinct from old.presented then
    v_changes := v_changes || jsonb_build_object(
      'presented', jsonb_build_object('from', old.presented, 'to', new.presented));
  end if;

  -- The DATE only. Whether the finding was positive or negative is not
  -- recorded here and must not be added without revisiting audit_logs_admin_read
  -- in the same migration — see the header.
  if new.result_date is distinct from old.result_date then
    v_changes := v_changes || jsonb_build_object(
      'result_date', jsonb_build_object('from', old.result_date, 'to', new.result_date));
  end if;

  -- A re-route. This is the referral-level counterpart of a case transfer and
  -- is the change most worth being able to reconstruct later.
  if new.facility_id is distinct from old.facility_id then
    v_changes := v_changes || jsonb_build_object(
      'facility_id', jsonb_build_object('from', old.facility_id, 'to', new.facility_id));
  end if;

  if new.lab_sample_id is distinct from old.lab_sample_id then
    v_changes := v_changes || jsonb_build_object(
      'lab_sample_id', jsonb_build_object('from', old.lab_sample_id, 'to', new.lab_sample_id));
  end if;

  if v_changes = '{}'::jsonb then
    return null;                       -- AFTER trigger: the return is ignored
  end if;

  -- 'status_changed' is reserved for an actual stage move, so the audit viewer
  -- can filter the referral's life story from its clerical corrections.
  v_action := case
    when new.status is distinct from old.status then 'status_changed'
    else 'updated'
  end;

  -- facility_id is the NEW owner. On a re-route that files the row with the
  -- facility that now holds the referral; the previous owner is inside
  -- `changes`, so nothing is lost, and audit_logs_tbdots_read scopes by this
  -- column — filing it under the old facility would make the receiving one
  -- unable to see how it arrived.
  perform app_private.write_audit(
    'referrals', new.referral_id, v_action,
    new.patient_id, new.facility_id, v_changes);

  return null;
end;
$fn$;

revoke all on function public.audit_referral_change() from public, anon, authenticated, service_role;

drop trigger if exists referrals_audit on public.referrals;
create trigger referrals_audit
  after update on public.referrals
  for each row execute function public.audit_referral_change();

comment on function public.audit_referral_change() is
  'Writes an audit_logs row when a referral''s stage, presentation, result '
  'DATE, owning facility or lab sample id changes (0035, Task 6.2). Never '
  'records `result` or `result_outcome`: audit_logs is admin-readable and '
  'admin holds no clinical read policy.';


-- ---------------------------------------------------------------------------
-- 4. The admin read policy, revisited as 0031 required.
--
-- 0031's comment on audit_logs_admin_read is explicit: "If the whitelist is
-- ever widened, this policy must be revisited in the same migration." §2 widens
-- it, so here is the review rather than an inference.
--
-- The policy is LEFT UNCHANGED, and the reasoning it rests on still holds: an
-- admin sees who changed what stage and when, and no clinical value. The five
-- referral keys are a stage name, a boolean about attendance, a date, a
-- facility uuid and a lab sample identifier. None of them is a finding, none is
-- free text, and none is contact data.
--
-- The one that deserved a second look is `presented = false`. It says a patient
-- did not attend a TB test — operational, not diagnostic, and already visible
-- to the admin overview as a count. Recording who marked it and when does not
-- change what an admin may learn about that patient's health, only about the
-- clinic's record-keeping.
--
-- Restated for the next person who widens this whitelist: the moment a value
-- that implies a diagnosis lands in `changes`, this policy has to become
-- facility-scoped or the key has to be dropped. That decision cannot be
-- deferred to the reader of a future migration.
-- ---------------------------------------------------------------------------


-- ============================================================================
-- POST-CHECKS (run separately — the SQL editor returns only the last result).
--
-- The behaviour matrix is supabase/tests/0035_referral_audit_matrix.sql, run
-- through `node scripts/build-preflight.mjs 0035`.
--
-- 1. The CHECK admits four tables now:
--
--    select pg_get_constraintdef(oid) from pg_constraint
--     where conname = 'audit_logs_entity_table_check';
--
-- 2. The trigger exists and is AFTER UPDATE on referrals:
--
--    select tgname, pg_get_triggerdef(oid) from pg_trigger
--     where tgrelid = 'public.referrals'::regclass and not tgisinternal;
--
-- 3. No client role can execute the trigger function directly:
--
--    select has_function_privilege('authenticated',
--             'public.audit_referral_change()', 'EXECUTE');   -- expect false
--
-- 4. Nothing was written by the migration itself. It creates no audit row; the
--    count must be unchanged across application:
--
--    select entity_table, count(*) from public.audit_logs
--     group by entity_table order by 1;
--
-- 5. AFTER application, the first real transition proves the trail is live:
--
--    select entity_table, action, changes, occurred_at
--      from public.audit_logs
--     where entity_table = 'referrals'
--     order by occurred_at desc limit 5;
--
--    Expect this to stay EMPTY until a referral actually moves. A row
--    appearing with a `result` or `result_outcome` key is a defect — §2's
--    whitelist should have made that impossible, so investigate rather than
--    widen.
-- ============================================================================
