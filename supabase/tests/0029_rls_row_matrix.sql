-- ============================================================================
-- 0029_rls_row_matrix.sql — the row-access matrix for migration 0029 (BASE-06).
--
-- 0028's matrix proved that RPCs deny the right callers. This one proves the
-- harder half: that TABLE ROWS do too, and specifically that deactivating an
-- account revokes its access immediately rather than at token expiry.
--
-- It builds a small, self-contained world — two facilities, two barangays,
-- patients enrolled by different BHWs, referrals pointing at one facility only
-- — and then asks, as each persona and using real database roles and real JWT
-- claims, exactly how many rows are visible and which writes succeed.
--
-- ---------------------------------------------------------------------------
-- HOW TO RUN IT. This file opens no transaction and must not be run alone: it
-- needs 0029's definitions.
--
--     node scripts/build-preflight.mjs 0029
--
-- writes supabase/tests/0029_preflight.generated.sql =
--   begin; <0029> <this file> rollback;
-- Run that whole file in the SQL editor. It always rolls back, so it changes
-- nothing on the live project, and a single FAIL aborts it.
--
-- 0029 itself requires 0028 to be applied first; its own guard raises if not.
-- ---------------------------------------------------------------------------
--
-- THE ASSERTION THAT MATTERS MOST, and the one that is easy to get backwards:
-- a deactivated BHW must still be able to READ THEIR OWN users ROW, while
-- seeing no clinical row and writing nothing. Both clients detect deactivation
-- by reading that row (web/src/App.tsx:143, mobile/src/lib/accountGate.ts).
-- RLS filters rather than raising, so a hidden row returns
-- `data: null, error: null` — which mobile/src/domain/accountAccess.ts maps to
-- `{ kind: 'unknown' }`, documented there as blocking nothing and revoking
-- nothing. Hiding the row would therefore make the ban WEAKER. The carve-out
-- is pinned by a test so a future "tighten this" commit fails loudly.
--
-- SCOPE. Row authorization only. Not reporting arithmetic, not BASE-04, and
-- not BASE-02 — appointments remain patient-wide until 0030, and this file
-- asserts the CURRENT scope rather than the intended one, so it does not
-- pass vacuously against a hole 0029 was never meant to close.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A world of known size, so every expected count below is arithmetic rather
-- than a guess about existing data.
-- ---------------------------------------------------------------------------
create temp table t_ids (k text primary key, v uuid) on commit drop;
insert into t_ids (k, v)
select k, gen_random_uuid()
  from unnest(array[
    'fac_dots_a','fac_dots_b',
    'bhw_active','bhw_inactive','dots_a','dots_b','midwife','admin','no_profile',
    'pat_brgy1_by_active','pat_brgy1_by_other','pat_brgy2_by_other','pat_walkin_dots_a',
    'scr_1','scr_2','scr_3','scr_w',
    'ref_1','ref_w',
    'appt_1','appt_w'
  ]) as k;

create or replace function pg_temp.id(text) returns uuid
language sql stable as $$ select v from t_ids where k = $1 $$;

-- Two barangays from the seeded PSGC set, in a deterministic order.
create temp table t_brgy (n int primary key, code text) on commit drop;
insert into t_brgy (n, code)
select row_number() over (order by barangay_code), barangay_code
  from (select barangay_code from public.ref_barangays order by barangay_code limit 2) s;

insert into public.facilities (facility_id, name, type, address) values
  (pg_temp.id('fac_dots_a'), 'Matrix DOTS A', 'tb_dots', 'test'),
  (pg_temp.id('fac_dots_b'), 'Matrix DOTS B', 'tb_dots', 'test');

insert into auth.users (id)
select v from t_ids where k in
  ('bhw_active','bhw_inactive','dots_a','dots_b','midwife','admin','no_profile');

-- 'no_profile' deliberately gets no public.users row.
insert into public.users (user_id, role, full_name, facility_id, assigned_barangay_code, active) values
  (pg_temp.id('bhw_active'),   'bhw',     'Matrix BHW active',   pg_temp.id('fac_dots_a'), (select code from t_brgy where n = 1), true),
  (pg_temp.id('bhw_inactive'), 'bhw',     'Matrix BHW inactive', pg_temp.id('fac_dots_a'), (select code from t_brgy where n = 1), false),
  (pg_temp.id('dots_a'),       'tb_dots', 'Matrix DOTS A staff', pg_temp.id('fac_dots_a'), null, true),
  (pg_temp.id('dots_b'),       'tb_dots', 'Matrix DOTS B staff', pg_temp.id('fac_dots_b'), null, true),
  (pg_temp.id('midwife'),      'midwife', 'Matrix midwife',      pg_temp.id('fac_dots_a'), (select code from t_brgy where n = 1), true),
  (pg_temp.id('admin'),        'admin',   'Matrix admin',        pg_temp.id('fac_dots_a'), null, true);

-- Patients: two in barangay 1 (one enrolled by the active BHW, one by the
-- inactive one), one in barangay 2, and one walk-in registered by DOTS A.
insert into public.patients
  (patient_id, display_code, enrolled_by, age, sex, barangay_code, sms_consent) values
  (pg_temp.id('pat_brgy1_by_active'), 'MTX-0001', pg_temp.id('bhw_active'),   30, 'male',   (select code from t_brgy where n = 1), false),
  (pg_temp.id('pat_brgy1_by_other'),  'MTX-0002', pg_temp.id('bhw_inactive'), 31, 'female', (select code from t_brgy where n = 1), false),
  (pg_temp.id('pat_brgy2_by_other'),  'MTX-0003', pg_temp.id('bhw_inactive'), 32, 'male',   (select code from t_brgy where n = 2), false),
  (pg_temp.id('pat_walkin_dots_a'),   'MTX-0004', pg_temp.id('dots_a'),       33, 'female', (select code from t_brgy where n = 1), false);

insert into public.screenings (screening_id, patient_id, referred) values
  (pg_temp.id('scr_1'), pg_temp.id('pat_brgy1_by_active'), true),
  (pg_temp.id('scr_2'), pg_temp.id('pat_brgy1_by_other'),  false),
  (pg_temp.id('scr_3'), pg_temp.id('pat_brgy2_by_other'),  false),
  (pg_temp.id('scr_w'), pg_temp.id('pat_walkin_dots_a'),   true);

-- Only DOTS A ever receives a referral, so DOTS B must see nothing at all.
insert into public.referrals (referral_id, patient_id, screening_id, facility_id, status) values
  (pg_temp.id('ref_1'), pg_temp.id('pat_brgy1_by_active'), pg_temp.id('scr_1'), pg_temp.id('fac_dots_a'), 'submitted'),
  (pg_temp.id('ref_w'), pg_temp.id('pat_walkin_dots_a'),   pg_temp.id('scr_w'), pg_temp.id('fac_dots_a'), 'received');

insert into public.appointments (appointment_id, patient_id, scheduled_date, status) values
  (pg_temp.id('appt_1'), pg_temp.id('pat_brgy1_by_active'), current_date + 7, 'scheduled'),
  (pg_temp.id('appt_w'), pg_temp.id('pat_walkin_dots_a'),   current_date + 7, 'scheduled');

-- ---------------------------------------------------------------------------
-- Personas.
-- ---------------------------------------------------------------------------
create temp table t_persona (persona text primary key, uid uuid, jwt_role text) on commit drop;
insert into t_persona values
  ('anonymous',    '00000000-0000-4000-8000-000000000000', 'anon'),
  ('no_profile',   pg_temp.id('no_profile'),   'authenticated'),
  ('bhw_inactive', pg_temp.id('bhw_inactive'), 'authenticated'),
  ('bhw_active',   pg_temp.id('bhw_active'),   'authenticated'),
  ('dots_a',       pg_temp.id('dots_a'),       'authenticated'),
  ('dots_b',       pg_temp.id('dots_b'),       'authenticated'),
  ('midwife',      pg_temp.id('midwife'),      'authenticated'),
  ('admin',        pg_temp.id('admin'),        'authenticated');

create temp table t_result (
  check_kind text, subject text, persona text,
  expected text, actual text, detail text, verdict text
) on commit drop;

create or replace function pg_temp.become(p_persona text) returns void
language plpgsql as $$
declare r record;
begin
  select * into r from t_persona where persona = p_persona;
  execute format('set local role %I', r.jwt_role);
  if p_persona = 'anonymous' then
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.uid, 'role', r.jwt_role)::text, true);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- A NOTE ON WHY EVERY ID IS READ INTO A LOCAL FIRST.
--
-- `set local role authenticated` switches the role for the rest of the
-- transaction, and the temp tables above are owned by the migration role. A
-- query that touched t_ids, t_brgy or pg_temp.id() while the role was switched
-- would fail on privileges, not on policy — and a privilege error inside an
-- EXCEPTION block reads exactly like a successful denial, so the matrix would
-- go green for the wrong reason.
--
-- So every block resolves the ids it needs BEFORE becoming someone, and then
-- touches nothing but real tables and local variables. Same reason 0028's
-- matrix does all its bookkeeping after `reset role`.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Pass 1 — visible row counts, per persona per table.
--
-- Counts are stated as literals derived from the world above, not computed by
-- re-running the policy logic. A test that asks the same question the policy
-- asks proves only that the policy equals itself.
-- ---------------------------------------------------------------------------
create temp table t_expect (persona text, subject text, want bigint) on commit drop;
insert into t_expect values
  -- Nobody unauthenticated or unprovisioned sees anything.
  ('anonymous',    'patients', 0), ('anonymous',    'screenings', 0), ('anonymous',    'referrals', 0), ('anonymous',    'appointments', 0),
  ('no_profile',   'patients', 0), ('no_profile',   'screenings', 0), ('no_profile',   'referrals', 0), ('no_profile',   'appointments', 0),

  -- BASE-06, the whole point: identical scope to bhw_active, except deactivated.
  ('bhw_inactive', 'patients', 0), ('bhw_inactive', 'screenings', 0), ('bhw_inactive', 'referrals', 0), ('bhw_inactive', 'appointments', 0),

  -- Active BHW: barangay 1 holds three patients (two enrolled there plus the
  -- DOTS walk-in, who lives in barangay 1); barangay 2's patient is invisible.
  ('bhw_active',   'patients', 3), ('bhw_active',   'screenings', 3), ('bhw_active',   'referrals', 2), ('bhw_active',   'appointments', 2),

  -- DOTS A: both referred patients (one of them its own walk-in).
  ('dots_a',       'patients', 2), ('dots_a',       'screenings', 2), ('dots_a',       'referrals', 2), ('dots_a',       'appointments', 2),

  -- DOTS B: no referral points at it.
  ('dots_b',       'patients', 0), ('dots_b',       'screenings', 0), ('dots_b',       'referrals', 0), ('dots_b',       'appointments', 0),

  -- Midwife and admin hold no patient-level clinical access, by design.
  ('midwife',      'patients', 0), ('midwife',      'screenings', 0), ('midwife',      'referrals', 0), ('midwife',      'appointments', 0),
  ('admin',        'patients', 0), ('admin',        'screenings', 0), ('admin',        'referrals', 0), ('admin',        'appointments', 0);

do $counts$
declare
  e     record;
  n     bigint;
  v_ids uuid[];
  v_pk  text;
begin
  select array_agg(v) into v_ids from t_ids;

  for e in select * from t_expect order by persona, subject loop
    v_pk := case e.subject
              when 'patients'   then 'patient_id'
              when 'screenings' then 'screening_id'
              when 'referrals'  then 'referral_id'
              else                   'appointment_id'
            end;

    perform pg_temp.become(e.persona);
    execute format('select count(*) from public.%I where %I = any($1)', e.subject, v_pk)
      into n using v_ids;
    reset role;

    insert into t_result values ('rows visible', e.subject, e.persona,
      e.want::text, n::text, '',
      case when n = e.want then 'PASS' else 'FAIL' end);
  end loop;
end;
$counts$;

-- ---------------------------------------------------------------------------
-- Pass 2 — the users carve-out and its limits.
-- ---------------------------------------------------------------------------
do $users$
declare
  n            bigint;
  ok           boolean;
  msg          text := '';
  u_inactive   uuid;
  u_active     uuid;
  u_dots_a     uuid;
  brgy2        text;
begin
  select v into u_inactive from t_ids where k = 'bhw_inactive';
  select v into u_active   from t_ids where k = 'bhw_active';
  select v into u_dots_a   from t_ids where k = 'dots_a';
  select code into brgy2   from t_brgy where t_brgy.n = 2;

  -- (a) A deactivated account STILL reads its own row, and can see `active`.
  --     If this ever fails, the ban gets weaker, not stronger. Read the header.
  perform pg_temp.become('bhw_inactive');
  select count(*) into n from public.users u where u.user_id = u_inactive;
  reset role;
  insert into t_result values ('carve-out', 'own users row', 'bhw_inactive',
    '1', n::text,
    'deactivation must remain self-discoverable; see 0029 header',
    case when n = 1 then 'PASS' else 'FAIL' end);

  -- (b) ...but sees no colleague's row.
  perform pg_temp.become('bhw_inactive');
  select count(*) into n from public.users u where u.user_id in (u_active, u_dots_a);
  reset role;
  insert into t_result values ('carve-out limit', 'colleague users rows', 'bhw_inactive',
    '0', n::text, '', case when n = 0 then 'PASS' else 'FAIL' end);

  -- (c) An ACTIVE colleague at the same facility still sees them - proof that
  --     (b) is the active check biting, not the whole policy being broken.
  perform pg_temp.become('bhw_active');
  select count(*) into n from public.users u where u.user_id = u_inactive;
  reset role;
  insert into t_result values ('carve-out limit', 'colleague users rows', 'bhw_active',
    '1', n::text, 'same facility', case when n = 1 then 'PASS' else 'FAIL' end);

  -- (d) A deactivated account cannot write its own row
  --     (syncManager.pushAssignedBarangayIfDirty).
  perform pg_temp.become('bhw_inactive');
  begin
    update public.users set assigned_barangay_code = brgy2 where user_id = u_inactive;
    ok := found;
    msg := '';
  exception when others then
    ok := false; msg := left(sqlerrm, 60);
  end;
  reset role;
  insert into t_result values ('write denied', 'update own users row', 'bhw_inactive',
    'no rows updated', case when ok then 'UPDATED' else 'blocked' end, msg,
    case when ok then 'FAIL' else 'PASS' end);

  -- Positive control: the policy still permits an active account to update its
  -- own row. Without this, a missing grant or an always-false policy would make
  -- the inactive denial above pass for the wrong reason.
  perform pg_temp.become('bhw_active');
  update public.users
     set assigned_barangay_code = assigned_barangay_code
   where user_id = u_active;
  get diagnostics n = row_count;
  reset role;
  insert into t_result values ('write allowed', 'update own users row', 'bhw_active',
    '1 row', n::text || ' rows', '', case when n = 1 then 'PASS' else 'FAIL' end);
end;
$users$;

-- ---------------------------------------------------------------------------
-- Pass 3 — clinical writes. RLS refuses an INSERT by raising, and silently
-- matches zero rows on an UPDATE; both are checked.
-- ---------------------------------------------------------------------------
do $writes$
declare
  ok         boolean;
  msg        text;
  n          int;
  u_inactive uuid;
  u_active   uuid;
  p_other    uuid;
  p_own      uuid;
  r_1        uuid;
  p_new      uuid;
  brgy1      text;
begin
  select v into u_inactive from t_ids where k = 'bhw_inactive';
  select v into u_active   from t_ids where k = 'bhw_active';
  select v into p_other    from t_ids where k = 'pat_brgy1_by_other';
  select v into p_own      from t_ids where k = 'pat_brgy1_by_active';
  select v into r_1        from t_ids where k = 'ref_1';
  p_new := gen_random_uuid();
  select code into brgy1   from t_brgy where t_brgy.n = 1;

  -- A deactivated BHW cannot enrol a patient.
  perform pg_temp.become('bhw_inactive');
  begin
    insert into public.patients
      (patient_id, display_code, enrolled_by, age, sex, barangay_code, sms_consent)
    values (gen_random_uuid(), 'MTX-DENY-1', u_inactive, 40, 'male', brgy1, false);
    ok := true; msg := '';
  exception when others then
    ok := false; msg := left(sqlerrm, 60);
  end;
  reset role;
  insert into t_result values ('write denied', 'insert patient', 'bhw_inactive',
    'blocked', case when ok then 'INSERTED' else 'blocked' end, msg,
    case when ok then 'FAIL' else 'PASS' end);

  -- Positive control: an active BHW can still insert. This distinguishes the
  -- inactive policy denial from a missing table/column privilege.
  perform pg_temp.become('bhw_active');
  begin
    insert into public.patients
      (patient_id, display_code, enrolled_by, age, sex, barangay_code, sms_consent)
    values (p_new, 'MTX-ALLOW-1', u_active, 40, 'male', brgy1, false);
    ok := true; msg := '';
  exception when others then
    ok := false; msg := left(sqlerrm, 60);
  end;
  reset role;
  insert into t_result values ('write allowed', 'insert patient', 'bhw_active',
    'inserted', case when ok then 'inserted' else 'BLOCKED' end, msg,
    case when ok then 'PASS' else 'FAIL' end);

  -- ...nor edit one they enrolled while active.
  perform pg_temp.become('bhw_inactive');
  update public.patients set sitio = 'moved' where patient_id = p_other;
  get diagnostics n = row_count;
  reset role;
  insert into t_result values ('write denied', 'update own patient', 'bhw_inactive',
    '0 rows', n::text || ' rows', '', case when n = 0 then 'PASS' else 'FAIL' end);

  -- The active BHW can, so the denial above is deactivation and not breakage.
  perform pg_temp.become('bhw_active');
  update public.patients set sitio = 'ok' where patient_id = p_own;
  get diagnostics n = row_count;
  reset role;
  insert into t_result values ('write allowed', 'update own patient', 'bhw_active',
    '1 row', n::text || ' rows', '', case when n = 1 then 'PASS' else 'FAIL' end);

  -- Cross-facility: DOTS B cannot touch DOTS A's referral.
  perform pg_temp.become('dots_b');
  update public.referrals set status = 'received' where referral_id = r_1;
  get diagnostics n = row_count;
  reset role;
  insert into t_result values ('write denied', 'update other facility referral', 'dots_b',
    '0 rows', n::text || ' rows', '', case when n = 0 then 'PASS' else 'FAIL' end);
end;
$writes$;

-- ---------------------------------------------------------------------------
-- Pass 4 — the enumerating helpers are no longer callable from `public`
-- (R3-05). Before 0029 any authenticated caller could ask for a facility's
-- whole patient id list without passing through a policy.
--
-- The expected failure here IS a privilege error, which is why this is the one
-- block where "denied by privileges" is the pass condition rather than a
-- false green.
-- ---------------------------------------------------------------------------
do $helpers$
declare fn text; ok boolean; msg text;
begin
  foreach fn in array array['referred_patient_ids','referred_screening_ids',
                            'bhw_visible_patient_ids','own_enrolled_patient_ids'] loop
    perform pg_temp.become('dots_a');
    begin
      execute format('select count(*) from public.%I()', fn);
      ok := true; msg := '';
    exception when others then
      ok := false; msg := left(sqlerrm, 60);
    end;
    reset role;
    insert into t_result values ('helper not callable', 'public.' || fn, 'dots_a',
      'blocked', case when ok then 'CALLABLE' else 'blocked' end, msg,
      case when ok then 'FAIL' else 'PASS' end);
  end loop;

  -- And the app_private replacements ARE reachable for policy evaluation,
  -- so Pass 1's non-zero counts are not passing because the helpers are broken.
  perform pg_temp.become('dots_a');
  begin
    execute 'select count(*) from app_private.referred_patient_ids()';
    ok := true; msg := '';
  exception when others then
    ok := false; msg := left(sqlerrm, 60);
  end;
  reset role;
  insert into t_result values ('helper usable by policy', 'app_private.referred_patient_ids',
    'dots_a', 'callable', case when ok then 'callable' else 'BLOCKED' end, msg,
    case when ok then 'PASS' else 'FAIL' end);
end;
$helpers$;

-- ---------------------------------------------------------------------------
-- THE MATRIX. Every row must read PASS. Failures sort to the top.
-- ---------------------------------------------------------------------------
select verdict, check_kind, subject, persona, expected, actual, detail
  from t_result
 order by (verdict = 'PASS'), check_kind, subject, persona;

do $verdict$
declare n_fail int; n_all int;
begin
  select count(*) filter (where verdict = 'FAIL'), count(*) into n_fail, n_all from t_result;

  if n_all = 0 then
    raise exception '0029 matrix produced no rows at all — the harness did not run';
  end if;
  if n_fail > 0 then
    raise exception '0029 matrix: % of % checks FAILED — do not apply 0029', n_fail, n_all;
  end if;
  raise notice '0029 matrix: all % checks PASSED', n_all;
end;
$verdict$;
