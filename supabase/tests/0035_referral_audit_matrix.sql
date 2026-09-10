-- ============================================================================
-- 0035_referral_audit_matrix.sql — behaviour matrix for the referral audit trail.
--
-- WHAT IT PROVES
--
--   1. Each watched transition writes exactly one audit row, with the right
--      action, the right from/to pair, and the right owner.
--   2. A write that moves nothing watched writes NOTHING — including a touch of
--      `result`, which must never produce a row or a key.
--   3. The actor recorded is the caller, not the definer.
--   4. The whitelist guard actually fires for referrals, and an unrecognised
--      entity_table now raises instead of passing silently. This is the NULL
--      hole 0035 §2 closes, and it is asked with a POSITIVE CONTROL so it
--      cannot pass because the insert failed for some unrelated reason.
--   5. Scoping: a TB-DOTS facility reads its own referral audit rows and not
--      another facility's.
--
-- ---------------------------------------------------------------------------
-- HOW TO RUN IT. This file opens no transaction and must not be run alone.
--
--     node scripts/build-preflight.mjs 0035
--
-- writes supabase/tests/0035_preflight.generated.sql =
--   begin; <0035> <this file> rollback;
-- Run that whole file. It always rolls back, so it changes nothing, and a
-- single FAIL aborts it.
-- ---------------------------------------------------------------------------
--
-- SCOPE. The trigger and the whitelist. NOT the audit_logs policies themselves
-- (0031 owns those) beyond the one scoping question in §5, and NOT appointment
-- auditing, which 0035 deliberately leaves alone — see that file's header.
-- ============================================================================

create temp table t_ids (k text primary key, v uuid) on commit drop;
insert into t_ids (k, v)
select k, gen_random_uuid()
  from unnest(array[
    'fac_a','fac_b','staff_a','staff_b','bhw_1',
    'pat','scr','ref',
    'pat_b','scr_b','ref_b'
  ]) as k;

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
      '0035 matrix needs a barangay with no existing patients; every seeded '
      'barangay is occupied. Point the fixture at a disposable branch.';
  end if;
end;
$fixture_guard$;

insert into public.facilities (facility_id, name, type, address, short_code)
select v, 'Audit DOTS A', 'tb_dots', 'test', 'AUDA' from t_ids where k = 'fac_a';
insert into public.facilities (facility_id, name, type, address, short_code)
select v, 'Audit DOTS B', 'tb_dots', 'test', 'AUDB' from t_ids where k = 'fac_b';

insert into auth.users (id) select v from t_ids where k in ('staff_a','staff_b','bhw_1');

insert into public.users (user_id, role, full_name, facility_id, assigned_barangay_code, active)
values
  ((select v from t_ids where k = 'staff_a'), 'tb_dots', 'Audit Staff A',
   (select v from t_ids where k = 'fac_a'), null, true),
  ((select v from t_ids where k = 'staff_b'), 'tb_dots', 'Audit Staff B',
   (select v from t_ids where k = 'fac_b'), null, true),
  ((select v from t_ids where k = 'bhw_1'), 'bhw', 'Audit BHW',
   (select v from t_ids where k = 'fac_a'), (select code from t_brgy), true);

insert into public.patients
  (patient_id, display_code, enrolled_by, age, sex, barangay_code, sms_consent)
values
  ((select v from t_ids where k = 'pat'), 'AUD-0001',
   (select v from t_ids where k = 'bhw_1'), 33, 'female',
   (select code from t_brgy), false),
  ((select v from t_ids where k = 'pat_b'), 'AUD-0002',
   (select v from t_ids where k = 'bhw_1'), 44, 'male',
   (select code from t_brgy), false);

insert into public.screenings (screening_id, patient_id, referred)
values
  ((select v from t_ids where k = 'scr'),   (select v from t_ids where k = 'pat'),   true),
  ((select v from t_ids where k = 'scr_b'), (select v from t_ids where k = 'pat_b'), true);

insert into public.referrals (referral_id, patient_id, screening_id, facility_id, status)
values
  ((select v from t_ids where k = 'ref'), (select v from t_ids where k = 'pat'),
   (select v from t_ids where k = 'scr'), (select v from t_ids where k = 'fac_a'), 'submitted'),
  ((select v from t_ids where k = 'ref_b'), (select v from t_ids where k = 'pat_b'),
   (select v from t_ids where k = 'scr_b'), (select v from t_ids where k = 'fac_b'), 'submitted');

create temp table t_result (
  check_kind text, persona text,
  expected text, actual text, detail text, verdict text
) on commit drop;

do $temp_grant$
declare s text := pg_my_temp_schema()::regnamespace::text;
begin
  execute format('grant usage on schema %s to authenticated', s);
  execute format('grant select on %s.t_ids to authenticated', s);
end;
$temp_grant$;

create or replace function pg_temp.as_user(p_uid uuid) returns void
language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end;
$$;

-- Count only the rows this fixture produced. The live table has case rows in it
-- and a bare count(*) would drift with the data.
create or replace function pg_temp.audit_rows(p_ref uuid)
returns setof public.audit_logs
language sql stable as $$
  select * from public.audit_logs
   where entity_table = 'referrals' and entity_id = p_ref;
$$;

-- Pick a row by WHAT IT RECORDS, never by position.
--
-- The first draft used `offset N limit 1` over `order by occurred_at`, and every
-- positional assertion read the wrong row. `occurred_at` defaults to now(),
-- which is TRANSACTION-stable in PostgreSQL, so every audit row written inside
-- one transaction — and this whole preflight is one transaction — carries the
-- identical timestamp. The ordering then fell back to a random uuid.
--
-- Worth carrying beyond this file: two audit rows written by one statement or
-- one RPC are indistinguishable by occurred_at in the real system too, so
-- nothing may sequence them by that column alone.
create or replace function pg_temp.audit_row_with(p_ref uuid, p_key text)
returns public.audit_logs
language sql stable as $$
  select * from public.audit_logs
   where entity_table = 'referrals' and entity_id = p_ref and changes ? p_key
   limit 1;
$$;

-- A genuine direct session. `reset role` alone is NOT one: set_config(...,true)
-- writes a transaction-local GUC that outlives the role change, so auth.uid()
-- keeps returning the last persona and every "unauthenticated" assertion
-- silently tests an authenticated one. The claim has to be cleared too.
create or replace function pg_temp.as_direct_session() returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;


-- ===========================================================================
-- 0. The fixture inserts wrote nothing. INSERT is not audited (0035 §3): a
--    referral's creation already has an immutable created_at.
-- ===========================================================================
insert into t_result
select 'insert is not audited', 'migration role',
       '0 rows', count(*)::text || ' rows',
       'creation is already dated by created_at; an audit row would restate it',
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from pg_temp.audit_rows((select v from t_ids where k = 'ref'));


-- ===========================================================================
-- 1. Each watched transition, as the facility that owns the referral.
-- ===========================================================================
do $transitions$
declare
  u_staff_a uuid := (select v from t_ids where k = 'staff_a');
  v_ref     uuid := (select v from t_ids where k = 'ref');
  r         record;
  n         int;
begin
  -- submitted -> received. A stage move, so action must be 'status_changed'.
  perform pg_temp.as_user(u_staff_a);
  update public.referrals set status = 'received' where referral_id = v_ref;
  reset role;

  r := pg_temp.audit_row_with(v_ref, 'status');

  insert into t_result values ('status move: action', 'tb_dots A',
    'status_changed', coalesce(r.action, '(no row)'),
    'a stage move is not a clerical correction',
    case when r.action = 'status_changed' then 'PASS' else 'FAIL' end);

  insert into t_result values ('status move: changes', 'tb_dots A',
    'submitted -> received',
    coalesce(r.changes #>> '{status,from}', 'null') || ' -> ' ||
    coalesce(r.changes #>> '{status,to}', 'null'),
    'both ends of the transition are recorded, not just the new value',
    case when r.changes #>> '{status,from}' = 'submitted'
          and r.changes #>> '{status,to}'   = 'received' then 'PASS' else 'FAIL' end);

  insert into t_result values ('status move: actor', 'tb_dots A',
    'the caller, role tb_dots',
    coalesce(r.actor_user_id::text, 'null') || ' / ' || coalesce(r.actor_role, 'null'),
    'write_audit is SECURITY DEFINER but reads the CALLER''s jwt',
    case when r.actor_user_id = u_staff_a and r.actor_role = 'tb_dots'
         then 'PASS' else 'FAIL' end);

  insert into t_result values ('status move: owner', 'tb_dots A',
    'patient and facility of the referral',
    coalesce(r.patient_id::text, 'null') || ' / ' || coalesce(r.facility_id::text, 'null'),
    'audit_logs_tbdots_read scopes on facility_id, so it must be filled',
    case when r.patient_id  = (select v from t_ids where k = 'pat')
          and r.facility_id = (select v from t_ids where k = 'fac_a')
         then 'PASS' else 'FAIL' end);

  -- presented = false. Not a stage move, so 'updated'.
  perform pg_temp.as_user(u_staff_a);
  update public.referrals set presented = false where referral_id = v_ref;
  reset role;

  r := pg_temp.audit_row_with(v_ref, 'presented');

  insert into t_result values ('did not present', 'tb_dots A',
    'updated, null -> false',
    coalesce(r.action, '(no row)') || ', ' ||
    coalesce(r.changes #>> '{presented,from}', 'null') || ' -> ' ||
    coalesce(r.changes #>> '{presented,to}', 'null'),
    'a no-show is recorded as an ordinary update, not a stage change',
    case when r.action = 'updated'
          and r.changes #>> '{presented,from}' is null
          and r.changes #>> '{presented,to}' = 'false' then 'PASS' else 'FAIL' end);

  -- A re-route, performed from a DIRECT SESSION rather than as staff_a.
  --
  -- That is not a convenience: `referrals_tbdots_update` scopes to the caller's
  -- own facility on both sides, so a facility CANNOT hand a referral to another
  -- one, and the first draft of this test failed with 42501 for exactly that
  -- reason. A re-route of a non-'submitted' referral is a support action taken
  -- with a direct session, which is also the case 0035's header describes as
  -- recording a null actor. So the fixture now models the real path and gets an
  -- extra assertion out of it.
  perform pg_temp.as_direct_session();
  update public.referrals
     set facility_id = (select v from t_ids where k = 'fac_b')
   where referral_id = v_ref;

  r := pg_temp.audit_row_with(v_ref, 'facility_id');

  insert into t_result values ('re-route: filed to new owner', 'direct session',
    'facility_id = B',
    coalesce(r.facility_id::text, 'null'),
    'filing it under the old owner would hide the arrival from the new one',
    case when r.facility_id = (select v from t_ids where k = 'fac_b')
         then 'PASS' else 'FAIL' end);

  insert into t_result values ('re-route: both ends kept', 'direct session',
    'A -> B in changes',
    coalesce(r.changes #>> '{facility_id,from}', 'null') || ' -> ' ||
    coalesce(r.changes #>> '{facility_id,to}', 'null'),
    'the previous owner survives inside the row it was moved off',
    case when r.changes #>> '{facility_id,from}' = (select v from t_ids where k = 'fac_a')::text
          and r.changes #>> '{facility_id,to}'   = (select v from t_ids where k = 'fac_b')::text
         then 'PASS' else 'FAIL' end);

  -- A direct session has no JWT, so there is no actor to record. Recording one
  -- would mean write_audit() had fallen back to the definer, which is the bug
  -- its SECURITY DEFINER header warns about.
  insert into t_result values ('re-route: no actor for a direct session', 'direct session',
    'null actor and null role',
    coalesce(r.actor_user_id::text, 'null') || ' / ' || coalesce(r.actor_role, 'null'),
    'the truth about a support write; a definer identity here would be a lie',
    case when r.actor_user_id is null and r.actor_role is null
         then 'PASS' else 'FAIL' end);

  select count(*) into n from pg_temp.audit_rows(v_ref);
  insert into t_result values ('one row per change', '-',
    '3 rows', n::text || ' rows',
    'three watched writes so far, and no extras from the updated_at trigger',
    case when n = 3 then 'PASS' else 'FAIL' end);
end;
$transitions$;


-- ===========================================================================
-- 2. Writes that must produce nothing.
--
-- `result` is the free clinical text. Touching it must not write a row and must
-- not smuggle a key. This is the assertion that would fail first if someone
-- widened the trigger without reading the header.
-- ===========================================================================
do $silence$
declare
  u_staff_b uuid := (select v from t_ids where k = 'staff_b');   -- owns it now
  v_ref     uuid := (select v from t_ids where k = 'ref');
  n_before  int;
  n_after   int;
  has_key   boolean;
begin
  select count(*) into n_before from pg_temp.audit_rows(v_ref);

  perform pg_temp.as_user(u_staff_b);
  update public.referrals
     set result = 'sputum smear notes, free text'
   where referral_id = v_ref;
  reset role;

  select count(*) into n_after from pg_temp.audit_rows(v_ref);

  insert into t_result values ('free text writes nothing', 'tb_dots B',
    'no new row', (n_after - n_before)::text || ' new row(s)',
    'result is clinical free text and audit_logs is admin-readable',
    case when n_after = n_before then 'PASS' else 'FAIL' end);

  -- A no-op write. updated_at still fires, so the trigger sees an UPDATE.
  perform pg_temp.as_user(u_staff_b);
  update public.referrals set status = status where referral_id = v_ref;
  reset role;

  select count(*) into n_after from pg_temp.audit_rows(v_ref);

  insert into t_result values ('no-op writes nothing', 'tb_dots B',
    'no new row', (n_after - n_before)::text || ' new row(s)',
    'a touch that moves nothing must not fill the trail with empty rows',
    case when n_after = n_before then 'PASS' else 'FAIL' end);

  -- result_date, the one result-shaped thing that IS recorded.
  perform pg_temp.as_user(u_staff_b);
  update public.referrals
     set result_date = public.manila_day_start(public.manila_today()),
         result_outcome = 'positive'
   where referral_id = v_ref;
  reset role;

  select exists (
    select 1 from pg_temp.audit_rows(v_ref) a
     where a.changes ? 'result_date'
  ) into has_key;

  insert into t_result values ('result_date is recorded', 'tb_dots B',
    'present', case when has_key then 'present' else 'ABSENT' end,
    'THAT an outcome was recorded, and when',
    case when has_key then 'PASS' else 'FAIL' end);

  -- ...and the finding beside it is not. Written in the SAME statement as the
  -- date, so this cannot pass by the update having been skipped.
  select exists (
    select 1 from pg_temp.audit_rows(v_ref) a
     where a.changes ? 'result_outcome' or a.changes ? 'result'
  ) into has_key;

  insert into t_result values ('the finding is not recorded', 'tb_dots B',
    'absent', case when has_key then 'PRESENT' else 'absent' end,
    'positive/negative would reach admin, who holds no clinical read policy',
    case when has_key then 'FAIL' else 'PASS' end);
end;
$silence$;


-- ===========================================================================
-- 3. The whitelist guard, asked directly.
--
-- §2 above proves the TRIGGER does not emit a banned key. This proves the
-- WHITELIST would refuse one even if a future writer tried, which is a
-- different question and the one that survives a rewrite of the trigger.
-- ===========================================================================
do $whitelist$
declare
  v_ref   uuid := (select v from t_ids where k = 'ref');
  v_pat   uuid := (select v from t_ids where k = 'pat');
  v_fac   uuid := (select v from t_ids where k = 'fac_a');
  ok      boolean;
begin
  -- POSITIVE CONTROL FIRST. If an allowed key could not be written either, then
  -- every rejection below would be passing for an unrelated reason — the trap
  -- HANDOFF §6 records ("a denial check can pass because the statement matched
  -- zero rows" / "a privilege error looks exactly like a successful denial").
  begin
    insert into public.audit_logs (entity_table, entity_id, action, patient_id, facility_id, changes)
    values ('referrals', v_ref, 'updated', v_pat, v_fac,
            jsonb_build_object('status', jsonb_build_object('from', 'a', 'to', 'b')));
    ok := true;
  exception when others then
    ok := false;
  end;

  insert into t_result values ('guard: allowed key accepted', 'migration role',
    'accepted', case when ok then 'accepted' else 'REJECTED' end,
    'the positive control — without it the two rejections below prove nothing',
    case when ok then 'PASS' else 'FAIL' end);

  -- A banned key on the new arm.
  begin
    insert into public.audit_logs (entity_table, entity_id, action, patient_id, facility_id, changes)
    values ('referrals', v_ref, 'updated', v_pat, v_fac,
            jsonb_build_object('result_outcome', 'positive'));
    ok := true;
  exception when others then
    ok := false;
  end;

  insert into t_result values ('guard: banned key rejected', 'migration role',
    'rejected', case when ok then 'ACCEPTED' else 'rejected' end,
    'this is what the NULL hole would have let through once referrals was admitted',
    case when ok then 'FAIL' else 'PASS' end);

  -- An entity_table with no arm. Before 0035 this passed the whitelist silently
  -- and was caught only by the CHECK; now the guard itself must refuse it.
  -- The CHECK also rejects it, so this assertion is about WHICH error arrives:
  -- 22023 from the guard, not 23514 from the constraint.
  declare sqlst text;
  begin
    begin
      insert into public.audit_logs (entity_table, entity_id, action, patient_id, facility_id, changes)
      values ('patients', v_pat, 'updated', v_pat, v_fac,
              jsonb_build_object('anything', 'at all'));
      sqlst := 'none';
    exception when others then
      sqlst := sqlstate;
    end;

    insert into t_result values ('guard: unknown table raises', 'migration role',
      '22023 from the guard', sqlst,
      'not 23514 from the CHECK — the guard must not depend on the constraint',
      case when sqlst = '22023' then 'PASS' else 'FAIL' end);
  end;
end;
$whitelist$;


-- ===========================================================================
-- 4. Scoping. Facility B owns the referral now, so B reads the trail and A
--    does not. Asked both ways so "sees nothing" is distinguishable from
--    "there is nothing to see".
-- ===========================================================================
do $scoping$
declare
  v_ref uuid := (select v from t_ids where k = 'ref');
  n_a   int;
  n_b   int;
  n_bhw int;
begin
  perform pg_temp.as_user((select v from t_ids where k = 'staff_b'));
  select count(*) into n_b from public.audit_logs
   where entity_table = 'referrals' and entity_id = v_ref;
  reset role;

  perform pg_temp.as_user((select v from t_ids where k = 'staff_a'));
  select count(*) into n_a from public.audit_logs
   where entity_table = 'referrals' and entity_id = v_ref;
  reset role;

  perform pg_temp.as_user((select v from t_ids where k = 'bhw_1'));
  select count(*) into n_bhw from public.audit_logs
   where entity_table = 'referrals' and entity_id = v_ref;
  reset role;

  insert into t_result values ('scope: owning facility reads', 'tb_dots B',
    '> 0 rows', n_b::text || ' rows',
    'the rows filed to B after the re-route',
    case when n_b > 0 then 'PASS' else 'FAIL' end);

  insert into t_result values ('scope: former owner', 'tb_dots A',
    'only its own', n_a::text || ' rows',
    'A keeps the rows written while it owned the referral, and gains none after',
    case when n_a > 0 and n_a < n_b + n_a then 'PASS' else 'FAIL' end);

  insert into t_result values ('scope: bhw sees no audit', 'bhw',
    '0 rows', n_bhw::text || ' rows',
    'audit_logs has read policies for tb_dots and admin only (0031)',
    case when n_bhw = 0 then 'PASS' else 'FAIL' end);
end;
$scoping$;


-- ---------------------------------------------------------------------------
-- THE MATRIX. Every row must read PASS. Failures sort to the top.
-- ---------------------------------------------------------------------------
select verdict, check_kind, persona, expected, actual, detail
  from t_result
 order by (verdict = 'PASS'), check_kind, persona;

do $verdict$
declare n_fail int; n_all int;
begin
  select count(*) filter (where verdict = 'FAIL'), count(*) into n_fail, n_all from t_result;

  if n_all = 0 then
    raise exception '0035 matrix produced no rows — the harness did not run';
  end if;
  if n_fail > 0 then
    raise exception '0035 matrix: % of % checks FAILED — do not apply 0035', n_fail, n_all;
  end if;
  raise notice '0035 matrix: all % checks PASSED', n_all;
end;
$verdict$;
