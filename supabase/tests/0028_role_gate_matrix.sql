-- ============================================================================
-- 0028_role_gate_matrix.sql — the denial matrix for migration 0028 (BASE-01).
--
-- WHY A SQL SCRIPT AND NOT A VITEST FILE. The defect being fixed lives in the
-- database: `NULL not in (...)` is NULL, PL/pgSQL skips an IF whose condition
-- is NULL, and the SECURITY DEFINER body runs anyway. A mocked client test
-- cannot observe any of that — it would assert against a stub of the very layer
-- that is broken. The baseline audit records that this repository has no
-- executable SQL/RLS suite; this is the first file of one.
--
-- ---------------------------------------------------------------------------
-- HOW TO RUN IT. This file does NOT open or close a transaction, and it must
-- not be run on its own: it calls definitions that only exist once 0028 has
-- run. Use one of the two supported workflows (M28-03):
--
--   A. PREFERRED — disposable Supabase branch.
--        apply 0028_null_safe_role_gates.sql, then run this file.
--      Read the matrix, then discard the branch.
--
--   B. OTHERWISE — the generated transactional preflight.
--        node scripts/build-0028-preflight.mjs
--      writes supabase/tests/0028_preflight.generated.sql:
--        begin;  <0028>  <this file>  <raise on FAIL>  rollback;
--      Run that whole file in the SQL editor. It ALWAYS rolls back, so it
--      changes nothing on the live project, and a single FAIL row aborts it.
--      Only after it reports all PASS, apply 0028 for real.
--
-- Running this file alone will fail on `current_user_active_role()` not
-- existing, which is the correct outcome and not a bug.
-- ---------------------------------------------------------------------------
--
-- WHAT IT ASSERTS
--   1. Allow/deny for all seven functions across seven personas, using real
--      database roles AND real JWT claims, so both the function ACL and the
--      in-body gate are exercised.
--   2. That the simulated identity took effect at all — `auth.uid()` must
--      equal the persona's UUID. Without this the whole matrix could pass
--      vacuously against a NULL uid.
--   3. The EXACT return of current_user_active_role() per persona: NULL for
--      anonymous, missing-profile and deactivated; the precise role string
--      otherwise. "It was callable" is not the property under test.
--   4. That anonymous denials come from the ACL, not merely from the gate.
--   5. BASE-01 by name: the two personas that used to get data must not.
--
-- ONE THING ROLLBACK DOES NOT UNDO: next_facility_patient_code() calls
-- nextval(), and sequences are non-transactional, so this test burns a handful
-- of PAT-DOTS-#### values. Harmless — the codes are cosmetic and the function
-- loops past collisions — but worth knowing before you wonder why the counter
-- moved. It is also the property that made a sequence unsuitable for case
-- numbers (ARCH-09).
--
-- SCOPE. Authorization only. Not the reporting arithmetic, and not BASE-04,
-- which 0028 deliberately leaves alone. It also does not cover BASE-06:
-- RLS policies still use the non-active-aware helper, so row access for a
-- deactivated token is out of scope here and needs its own unit.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Personas. Each gets an auth.users row (the FK target) and, except for the
-- "no profile" case, a public.users row.
-- ---------------------------------------------------------------------------
create temp table gate_persona (
  persona    text primary key,
  uid        uuid not null,
  jwt_role   text not null,   -- the database role the request runs as
  want_role  text             -- exact expected current_user_active_role()
) on commit drop;

insert into gate_persona (persona, uid, jwt_role, want_role) values
  ('anonymous',        '00000000-0000-4000-8000-000000000000', 'anon',          null),
  ('no_profile_row',   gen_random_uuid(),                      'authenticated', null),
  ('inactive_tb_dots', gen_random_uuid(),                      'authenticated', null),
  ('bhw',              gen_random_uuid(),                      'authenticated', 'bhw'),
  ('tb_dots',          gen_random_uuid(),                      'authenticated', 'tb_dots'),
  ('midwife',          gen_random_uuid(),                      'authenticated', 'midwife'),
  ('admin',            gen_random_uuid(),                      'authenticated', 'admin');

insert into auth.users (id)
select uid from gate_persona where persona <> 'anonymous';

-- 'no_profile_row' is skipped on purpose — that persona is the authenticated
-- but unprovisioned caller that made current_user_role() return NULL and the
-- old gates fall open. 'inactive_tb_dots' gets a real tb_dots row with
-- active = false, which is the other half of the same defect.
insert into public.users (user_id, role, full_name, facility_id, assigned_barangay_code, active)
select
  p.uid,
  case p.persona when 'inactive_tb_dots' then 'tb_dots' else p.persona end,
  'Gate matrix ' || p.persona,
  (select facility_id from public.facilities where type = 'tb_dots' order by name limit 1),
  case when p.persona in ('bhw', 'midwife')
       then (select barangay_code from public.ref_barangays order by barangay_code limit 1)
       else null end,
  p.persona <> 'inactive_tb_dots'
from gate_persona p
where p.persona not in ('anonymous', 'no_profile_row');

-- ---------------------------------------------------------------------------
-- The calls under test, and who is supposed to get through each one.
-- ---------------------------------------------------------------------------
create temp table gate_call (
  fn       text primary key,
  stmt     text not null,
  allowed  text[] not null
) on commit drop;

insert into gate_call (fn, stmt, allowed) values
  ('current_user_active_role',
   'select public.current_user_active_role()',
   -- No role gate of its own: it ANSWERS the role question. Every signed-in
   -- caller may ask about themselves; anon may not call it at all. What it
   -- RETURNS for each persona is asserted separately below.
   array['no_profile_row','inactive_tb_dots','bhw','tb_dots','midwife','admin']),

  ('barangay_report',
   'select count(*) from public.barangay_report(current_date, current_date) t',
   array['tb_dots','admin']),

  ('admin_overview',
   'select count(*) from public.admin_overview() t',
   array['admin']),

  ('bhw_activity',
   'select count(*) from public.bhw_activity(30) t',
   array['midwife','admin']),

  ('dashboard_counts',
   'select count(*) from public.dashboard_counts() t',
   array['tb_dots']),

  ('hotspot_counts',
   'select count(*) from public.hotspot_counts(current_date, current_date) t',
   array['tb_dots']),

  ('next_facility_patient_code',
   'select public.next_facility_patient_code()',
   array['tb_dots']);

create temp table gate_result (
  check_kind text,
  fn         text,
  persona    text,
  expected   text,
  actual     text,
  sqlstate   text,
  detail     text,
  verdict    text
) on commit drop;

-- ---------------------------------------------------------------------------
-- Pass 1 — identity. If the simulated JWT does not actually drive auth.uid(),
-- every gate below sees a NULL uid and the whole matrix passes for the wrong
-- reason. Assert the identity took effect before trusting anything else.
-- ---------------------------------------------------------------------------
do $identity$
declare
  p       record;
  v_uid   uuid;
  v_want  text;
begin
  for p in select * from gate_persona order by persona loop
    execute format('set local role %I', p.jwt_role);
    if p.persona = 'anonymous' then
      perform set_config('request.jwt.claims', '', true);
    else
      perform set_config('request.jwt.claims',
                         json_build_object('sub', p.uid, 'role', p.jwt_role)::text, true);
    end if;

    select auth.uid() into v_uid;
    reset role;

    v_want := case when p.persona = 'anonymous' then '(null)' else p.uid::text end;

    insert into gate_result values (
      'auth.uid()', 'auth.uid', p.persona, v_want, coalesce(v_uid::text, '(null)'), '', '',
      case when coalesce(v_uid::text, '(null)') = v_want then 'PASS' else 'FAIL' end);
  end loop;
end;
$identity$;

-- ---------------------------------------------------------------------------
-- Pass 2 — the exact return of the new helper, per persona. The three NULL
-- rows ARE the BASE-01 fix: anonymous, unprovisioned and deactivated must be
-- indistinguishable from each other and from "no role".
-- ---------------------------------------------------------------------------
do $helper$
declare
  p      record;
  v_got  text;
begin
  for p in select * from gate_persona where persona <> 'anonymous' order by persona loop
    execute format('set local role %I', p.jwt_role);
    perform set_config('request.jwt.claims',
                       json_build_object('sub', p.uid, 'role', p.jwt_role)::text, true);

    select public.current_user_active_role() into v_got;
    reset role;

    insert into gate_result values (
      'helper returns', 'current_user_active_role', p.persona,
      coalesce(p.want_role, '(null)'), coalesce(v_got, '(null)'), '', '',
      case when coalesce(v_got, '(null)') = coalesce(p.want_role, '(null)')
           then 'PASS' else 'FAIL' end);
  end loop;
end;
$helper$;

-- ---------------------------------------------------------------------------
-- Pass 3 — the allow/deny grid. Each call sits in its own BEGIN/EXCEPTION
-- block, which is a subtransaction, so a raised gate does not poison the run.
-- ---------------------------------------------------------------------------
do $matrix$
declare
  c          record;
  p          record;
  v_expected text;
  v_actual   text;
  v_state    text := '';
  v_detail   text := '';
begin
  for c in select * from gate_call order by fn loop
    for p in select * from gate_persona order by persona loop

      v_expected := case when p.persona = any (c.allowed) then 'allow' else 'deny' end;

      execute format('set local role %I', p.jwt_role);
      if p.persona = 'anonymous' then
        perform set_config('request.jwt.claims', '', true);
      else
        perform set_config('request.jwt.claims',
                           json_build_object('sub', p.uid, 'role', p.jwt_role)::text, true);
      end if;

      begin
        execute c.stmt;
        v_actual := 'allow';
        v_state  := '';
        v_detail := '';
      exception when others then
        v_actual := 'deny';
        v_state  := sqlstate;
        v_detail := left(sqlerrm, 90);
      end;

      reset role;

      insert into gate_result values (
        'allow/deny', c.fn, p.persona, v_expected, v_actual, v_state, v_detail,
        case when v_expected = v_actual then 'PASS' else 'FAIL' end);

    end loop;
  end loop;
end;
$matrix$;

-- ---------------------------------------------------------------------------
-- Pass 4 — two assertions the grid cannot express on its own.
-- ---------------------------------------------------------------------------

-- (a) Anonymous denials must come from the ACL — a missing EXECUTE grant — not
--     merely from the in-body gate. If a future migration re-granted EXECUTE to
--     anon, the gate would still deny, every grid cell would still read PASS,
--     and the ACL regression would pass unnoticed. 42501 with a
--     permission-denied message is what distinguishes the two.
insert into gate_result
select 'anon denied by ACL', fn, 'anonymous', 'acl_denial',
       case when sqlstate = '42501' and detail ilike 'permission denied%'
            then 'acl_denial' else coalesce(nullif(detail, ''), 'no error') end,
       sqlstate, detail,
       case when sqlstate = '42501' and detail ilike 'permission denied%'
            then 'PASS' else 'FAIL' end
from gate_result
where check_kind = 'allow/deny' and persona = 'anonymous' and verdict = 'PASS';

-- (b) BASE-01 by name. Before 0028, both of these personas received data from
--     barangay_report and admin_overview.
insert into gate_result
select 'BASE-01 closed', fn, persona, 'denied',
       case when actual = 'deny' then 'denied' else 'STILL OPEN' end,
       sqlstate, detail,
       case when actual = 'deny' then 'PASS' else 'FAIL' end
from gate_result
where check_kind = 'allow/deny'
  and persona in ('no_profile_row', 'inactive_tb_dots')
  and fn in ('barangay_report', 'admin_overview')
  and expected = 'deny';

-- ---------------------------------------------------------------------------
-- THE MATRIX. Every row must read PASS. Failures sort to the top.
-- ---------------------------------------------------------------------------
select verdict, check_kind, fn, persona, expected, actual, sqlstate, detail
  from gate_result
 order by (verdict = 'PASS'), check_kind, fn, persona;

-- ---------------------------------------------------------------------------
-- And fail loudly. A human skimming a long result set will miss one FAIL row;
-- an aborted transaction is unmissable. In the generated preflight this also
-- guarantees the rollback, since an error ends the transaction either way.
-- ---------------------------------------------------------------------------
do $verdict$
declare
  n_fail int;
  n_all  int;
begin
  select count(*) filter (where verdict = 'FAIL'), count(*) into n_fail, n_all
    from gate_result;

  if n_all = 0 then
    raise exception '0028 matrix produced no rows at all — the harness did not run';
  end if;

  if n_fail > 0 then
    raise exception '0028 matrix: % of % checks FAILED — do not apply 0028', n_fail, n_all;
  end if;

  raise notice '0028 matrix: all % checks PASSED', n_all;
end;
$verdict$;
