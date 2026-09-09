-- ============================================================================
-- 0031_case_registry_matrix.sql — the behaviour matrix for migration 0031.
--
-- 0028's matrix proved RPCs deny the right callers. 0029's proved table rows
-- do too. This one has to prove three different things at once, because 0031
-- introduces all three:
--
--   1. ADMISSION — create_tb_case() is SECURITY DEFINER, so `p_patient_id` is
--      an unvalidated claim until the function validates it. Role alone is not
--      authorization (ARCH-02).
--   2. OWNERSHIP — appointments now carry facility_id, and a client must be
--      able to NAME it (the mobile whole-row upsert re-sends it on every
--      retry) without being able to CHANGE it (R3-01/ARCH-04). Those two are
--      different properties and privileges can only express the second, so the
--      trigger is the boundary and every one of its paths is tested
--      separately.
--   3. EFFECTIVE PRIVILEGE — not the REVOKE statements. A column revoke
--      against a table-level grant runs cleanly and changes nothing; that is
--      how the same defect survived two review rounds (R2-01, R3-02). These
--      checks ask has_column_privilege() and then PATCH for real.
--
-- ---------------------------------------------------------------------------
-- HOW TO RUN IT. This file opens no transaction and must not be run alone: it
-- needs 0031's definitions.
--
--     node scripts/build-preflight.mjs 0031
--
-- writes supabase/tests/0031_preflight.generated.sql =
--   begin; <0031> <this file> rollback;
-- Run that whole file in the SQL editor. It always rolls back, so it changes
-- nothing on the live project, and a single FAIL aborts it.
--
-- 0031 itself guards on 0018, 0020, 0028, 0029 and 0030.
-- ---------------------------------------------------------------------------
--
-- THE RULE THIS FILE OBEYS THROUGHOUT, learned the expensive way in 0029:
-- a privilege error inside an EXCEPTION block looks exactly like a successful
-- denial. So every id is resolved into a local variable BEFORE `set local
-- role`, no block touches a temp table while the role is switched, and every
-- denial check that could go green for the wrong reason is paired with a
-- POSITIVE CONTROL — the same operation by someone who should succeed.
--
-- NOT COVERED HERE, deliberately: the old-client PostgREST upsert (§3.3, the
-- mandatory implementation gate). It tests what PostgREST does with a payload,
-- not what the database does with a statement, so no amount of SQL can stand
-- in for it. See scripts/old-client-upsert-check.mjs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A world of known size.
-- ---------------------------------------------------------------------------
create temp table t_ids (k text primary key, v uuid) on commit drop;
insert into t_ids (k, v)
select k, gen_random_uuid()
  from unnest(array[
    'fac_a','fac_b','fac_bhs',
    'dots_a','dots_a2','dots_b','bhw','bhw_inactive','midwife','admin','no_profile',
    'pat_a','pat_b','pat_walkin','pat_bhw_only',
    'scr_a','scr_b','scr_w','scr_bo',
    'ref_a','ref_b','ref_w','ref_bo',
    'appt_a','appt_b','appt_legacy','appt_bhw'
  ]) as k;

create or replace function pg_temp.id(text) returns uuid
language sql stable as $$ select v from t_ids where k = $1 $$;

create temp table t_brgy (n int primary key, code text) on commit drop;
insert into t_brgy (n, code)
select row_number() over (order by barangay_code), barangay_code
  from (select barangay_code from public.ref_barangays order by barangay_code limit 2) s;

-- Two DOTS facilities and one barangay health station. The BHS exists so the
-- short-code CHECK can be tested on both arms and so "a barangay health
-- station cannot own a case" has something to deny.
insert into public.facilities (facility_id, name, type, address, short_code) values
  (pg_temp.id('fac_a'),   'Matrix DOTS A',      'tb_dots',                 'test', 'MTXA'),
  (pg_temp.id('fac_b'),   'Matrix DOTS B',      'tb_dots',                 'test', 'MTXB'),
  (pg_temp.id('fac_bhs'), 'Matrix Health Stn',  'barangay_health_station', 'test', null);

insert into auth.users (id)
select v from t_ids where k in
  ('dots_a','dots_a2','dots_b','bhw','bhw_inactive','midwife','admin','no_profile');

insert into public.users (user_id, role, full_name, facility_id, assigned_barangay_code, active) values
  (pg_temp.id('dots_a'),       'tb_dots', 'Matrix DOTS A staff',   pg_temp.id('fac_a'), null, true),
  (pg_temp.id('dots_a2'),      'tb_dots', 'Matrix DOTS A relief',  pg_temp.id('fac_a'), null, true),
  (pg_temp.id('dots_b'),       'tb_dots', 'Matrix DOTS B staff',   pg_temp.id('fac_b'), null, true),
  (pg_temp.id('bhw'),          'bhw',     'Matrix BHW',            pg_temp.id('fac_a'), (select code from t_brgy where t_brgy.n = 1), true),
  (pg_temp.id('bhw_inactive'), 'bhw',     'Matrix BHW inactive',   pg_temp.id('fac_a'), (select code from t_brgy where t_brgy.n = 1), false),
  (pg_temp.id('midwife'),      'midwife', 'Matrix midwife',        pg_temp.id('fac_a'), (select code from t_brgy where t_brgy.n = 1), true),
  (pg_temp.id('admin'),        'admin',   'Matrix admin',          pg_temp.id('fac_a'), null, true);

-- pat_a / pat_b: referred to A and B respectively.
-- pat_walkin: registered by DOTS A staff, never referred — the referral-free
--             admission arm.
-- pat_bhw_only: enrolled by the BHW at facility A, referred nowhere. It exists
--             to prove D7's narrowing: sharing a facility_id with the caller
--             through a BHW's users row is NOT an admission.
insert into public.patients
  (patient_id, display_code, enrolled_by, age, sex, barangay_code, sms_consent) values
  (pg_temp.id('pat_a'),        'MTC-0001', pg_temp.id('bhw'),    30, 'male',   (select code from t_brgy where t_brgy.n = 1), false),
  (pg_temp.id('pat_b'),        'MTC-0002', pg_temp.id('bhw'),    31, 'female', (select code from t_brgy where t_brgy.n = 1), false),
  (pg_temp.id('pat_walkin'),   'MTC-0003', pg_temp.id('dots_a'), 32, 'male',   (select code from t_brgy where t_brgy.n = 1), false),
  (pg_temp.id('pat_bhw_only'), 'MTC-0004', pg_temp.id('bhw'),    33, 'female', (select code from t_brgy where t_brgy.n = 1), false);

insert into public.screenings (screening_id, patient_id, referred) values
  (pg_temp.id('scr_a'),  pg_temp.id('pat_a'), true),
  (pg_temp.id('scr_b'),  pg_temp.id('pat_b'), true),
  (pg_temp.id('scr_w'),  pg_temp.id('pat_walkin'), true),
  (pg_temp.id('scr_bo'), pg_temp.id('pat_b'), true);

-- ref_a is `received`: the patient arrived, so it IS an admission.
-- ref_w is `submitted`: it is NOT, and create_tb_case must say so.
insert into public.referrals (referral_id, patient_id, screening_id, facility_id, status) values
  (pg_temp.id('ref_a'),  pg_temp.id('pat_a'),      pg_temp.id('scr_a'),  pg_temp.id('fac_a'), 'received'),
  (pg_temp.id('ref_b'),  pg_temp.id('pat_b'),      pg_temp.id('scr_b'),  pg_temp.id('fac_b'), 'received'),
  (pg_temp.id('ref_w'),  pg_temp.id('pat_walkin'), pg_temp.id('scr_w'),  pg_temp.id('fac_a'), 'submitted'),
  (pg_temp.id('ref_bo'), pg_temp.id('pat_b'),      pg_temp.id('scr_bo'), pg_temp.id('fac_b'), 'submitted');

insert into public.appointments
  (appointment_id, patient_id, scheduled_date, status, facility_id, referral_id) values
  (pg_temp.id('appt_a'), pg_temp.id('pat_a'), public.manila_today() + 7, 'scheduled', pg_temp.id('fac_a'), pg_temp.id('ref_a')),
  (pg_temp.id('appt_b'), pg_temp.id('pat_b'), public.manila_today() + 7, 'scheduled', pg_temp.id('fac_b'), pg_temp.id('ref_b'));

-- A legacy row: no ownership at all, for a patient referred only to A. Under
-- §3.1 exactly one facility may claim it.
insert into public.appointments (appointment_id, patient_id, scheduled_date, status) values
  (pg_temp.id('appt_legacy'), pg_temp.id('pat_a'), public.manila_today() + 14, 'scheduled');

-- ---------------------------------------------------------------------------
-- Personas and bookkeeping.
-- ---------------------------------------------------------------------------
create temp table t_persona (persona text primary key, uid uuid, jwt_role text) on commit drop;
insert into t_persona values
  ('anonymous',    '00000000-0000-4000-8000-000000000000', 'anon'),
  ('no_profile',   pg_temp.id('no_profile'),   'authenticated'),
  ('bhw_inactive', pg_temp.id('bhw_inactive'), 'authenticated'),
  ('bhw',          pg_temp.id('bhw'),          'authenticated'),
  ('dots_a',       pg_temp.id('dots_a'),       'authenticated'),
  ('dots_a2',      pg_temp.id('dots_a2'),      'authenticated'),
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

-- Every check funnels through one of these two, so a check can never record a
-- verdict by accident and the "expected/actual" columns always mean the same
-- thing.
create or replace function pg_temp.expect_ok(
  p_kind text, p_subject text, p_persona text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into t_result values (p_kind, p_subject, p_persona, 'allowed',
    case when p_ok then 'allowed' else 'DENIED' end, p_detail,
    case when p_ok then 'PASS' else 'FAIL' end);
end;
$$;

create or replace function pg_temp.expect_denied(
  p_kind text, p_subject text, p_persona text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into t_result values (p_kind, p_subject, p_persona, 'denied',
    case when p_ok then 'ALLOWED' else 'denied' end, p_detail,
    case when p_ok then 'FAIL' else 'PASS' end);
end;
$$;


-- ===========================================================================
-- Pass 1 — the facility short-code CHECK.
--
-- This is the constraint that looked correct in revision 3 while permitting
-- exactly the row it existed to forbid: for a tb_dots row with a NULL code the
-- regex test is NULL, so the whole CHECK is NULL, and PostgreSQL ACCEPTS an
-- unknown CHECK (R3-03). The NULL case is therefore the single most important
-- row in this block, and it is asserted rather than reasoned about.
-- ===========================================================================
do $codes$
declare
  cases text[][] := array[
    ['tb_dots',                 'null',   'denied'],
    ['tb_dots',                 'mlb',    'denied'],
    ['tb_dots',                 'MTXA',   'denied'],   -- duplicate of fac_a
    ['tb_dots',                 'MTXZ',   'allowed'],
    ['barangay_health_station', 'null',   'allowed'],
    ['barangay_health_station', 'CAS',    'denied']
  ];
  i     int;
  ok    boolean;
  msg   text;
  v_typ text;
  v_cod text;
begin
  for i in 1 .. array_length(cases, 1) loop
    v_typ := cases[i][1];
    v_cod := cases[i][2];
    begin
      insert into public.facilities (name, type, short_code)
      values ('R3-03 probe ' || i, v_typ,
              case when v_cod = 'null' then null else v_cod end);
      ok := true; msg := '';
      -- Undo immediately: this block is about the constraint, not about
      -- leaving eleven probe facilities in the fixture.
      delete from public.facilities where name = 'R3-03 probe ' || i;
    exception when others then
      ok := false; msg := left(sqlerrm, 70);
    end;

    if cases[i][3] = 'allowed' then
      perform pg_temp.expect_ok('short_code CHECK',
        v_typ || ' + ' || v_cod, 'migration role', ok, msg);
    else
      perform pg_temp.expect_denied('short_code CHECK',
        v_typ || ' + ' || v_cod, 'migration role', ok, msg);
    end if;
  end loop;
end;
$codes$;

-- The eleven live TB-DOTS rows all carry a code, and nothing else does.
do $codes2$
declare n_missing bigint; n_extra bigint;
begin
  select count(*) into n_missing
    from public.facilities where type = 'tb_dots' and short_code is null;
  select count(*) into n_extra
    from public.facilities where type <> 'tb_dots' and short_code is not null;

  insert into t_result values ('short_code coverage', 'tb_dots without a code',
    'migration role', '0', n_missing::text, '',
    case when n_missing = 0 then 'PASS' else 'FAIL' end);
  insert into t_result values ('short_code coverage', 'non-DOTS with a code',
    'migration role', '0', n_extra::text, '',
    case when n_extra = 0 then 'PASS' else 'FAIL' end);
end;
$codes2$;


-- ===========================================================================
-- Pass 2 — create_tb_case: the ACL matrix and the admission predicate.
--
-- Table 8.2 of Task 1.2: anonymous, missing profile, deactivated, wrong role,
-- right role/wrong facility, right role/right facility. Then the part role
-- checks cannot cover — whether the CALLER IS ENTITLED TO THIS PATIENT.
-- ===========================================================================
do $create$
declare
  v_pat_a       uuid;
  v_pat_b       uuid;
  v_pat_walkin  uuid;
  v_pat_bhwonly uuid;
  v_ref_a       uuid;
  v_ref_b       uuid;
  v_ref_w       uuid;
  p             text;
  ok            boolean;
  msg           text;
  v_case        public.tb_cases;
begin
  select v into v_pat_a       from t_ids where k = 'pat_a';
  select v into v_pat_b       from t_ids where k = 'pat_b';
  select v into v_pat_walkin  from t_ids where k = 'pat_walkin';
  select v into v_pat_bhwonly from t_ids where k = 'pat_bhw_only';
  select v into v_ref_a       from t_ids where k = 'ref_a';
  select v into v_ref_b       from t_ids where k = 'ref_b';
  select v into v_ref_w       from t_ids where k = 'ref_w';

  -- (a) Everyone who is not an active TB-DOTS account at the owning facility.
  foreach p in array array['anonymous','no_profile','bhw_inactive','bhw',
                           'midwife','admin','dots_b'] loop
    perform pg_temp.become(p);
    begin
      perform public.create_tb_case(v_pat_a, v_ref_a, null, null);
      ok := true; msg := '';
    exception when others then
      ok := false; msg := left(sqlerrm, 70);
    end;
    reset role;
    perform pg_temp.expect_denied('create_tb_case ACL', 'referral-backed case', p, ok, msg);
  end loop;

  -- (b) The positive control for the whole block. Without this, (a) could be
  --     passing because the function is simply broken for everyone.
  -- Registered 30 days ago, not today. A case registered on the day the test
  -- runs leaves exactly one legal visit date, so Pass 8 could not correct a
  -- visit date to anything without tripping the `visit_date >=
  -- registration_date` invariant — which would look like a broken RPC rather
  -- than a fixture with no room in it.
  perform pg_temp.become('dots_a');
  begin
    v_case := public.create_tb_case(v_pat_a, v_ref_a, public.manila_today() - 30, null);
    ok := true; msg := v_case.case_number;
  exception when others then
    ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('create_tb_case ACL', 'referral-backed case', 'dots_a', ok, msg);

  -- (c) The case number is the reviewed format, prefixed with THIS facility's
  --     code and this year's Manila year.
  insert into t_result values ('case_number', 'format', 'dots_a',
    'TBC-MTXA-<year>-00001',
    coalesce(msg, '(none)'), '',
    case when msg = 'TBC-MTXA-' || extract(year from public.manila_today() - 30)::text || '-00001'
         then 'PASS' else 'FAIL' end);

  -- (d) Admission, referral-backed: the referral must belong to this patient,
  --     name this facility, and represent an arrival.
  perform pg_temp.become('dots_a');
  begin
    perform public.create_tb_case(v_pat_b, v_ref_a, null, null);   -- referral is pat_a's
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('create_tb_case admission',
    'referral belongs to another patient', 'dots_a', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    perform public.create_tb_case(v_pat_b, v_ref_b, null, null);   -- B's referral
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('create_tb_case admission',
    'referral names another facility', 'dots_a', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    perform public.create_tb_case(v_pat_walkin, v_ref_w, null, null);  -- still submitted
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('create_tb_case admission',
    'referral is still submitted', 'dots_a', ok, msg);

  -- (e) Admission, referral-free: a walk-in this facility registered is in;
  --     a BHW-enrolled barangay patient who merely shares the facility_id is
  --     not (D7).
  perform pg_temp.become('dots_a');
  begin
    perform public.create_tb_case(v_pat_bhwonly, null, null, null);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('create_tb_case admission',
    'referral-free, BHW-enrolled patient', 'dots_a', ok, msg);

  perform pg_temp.become('dots_b');
  begin
    perform public.create_tb_case(v_pat_walkin, null, null, null);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('create_tb_case admission',
    'referral-free, another facility''s walk-in', 'dots_b', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    perform public.create_tb_case(v_pat_walkin, null, null, null);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('create_tb_case admission',
    'referral-free, own walk-in', 'dots_a', ok, msg);
end;
$create$;


-- ===========================================================================
-- Pass 3 — one active case per patient, globally, and the transfer that is
-- its only remedy.
-- ===========================================================================
do $unique$
declare
  v_pat_a  uuid;
  v_ref_a  uuid;
  v_case   uuid;
  v_fac_b  uuid;
  v_fac_a  uuid;
  v_appt_a uuid;
  v_ref_bo uuid;
  n        bigint;
  ok       boolean;
  msg      text;
begin
  select v into v_pat_a from t_ids where k = 'pat_a';
  select v into v_ref_bo from t_ids where k = 'ref_bo';
  select v into v_appt_a from t_ids where k = 'appt_a';
  select v into v_ref_a from t_ids where k = 'ref_a';
  select v into v_fac_a from t_ids where k = 'fac_a';
  select v into v_fac_b from t_ids where k = 'fac_b';
  select case_id into v_case from public.tb_cases where patient_id = v_pat_a;

  -- A second case at the SAME facility.
  perform pg_temp.become('dots_a');
  begin
    perform public.create_tb_case(v_pat_a, v_ref_a, null, null);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('one active case', 'second case, same facility', 'dots_a', ok, msg);

  -- ...and the harder one: a second case at ANOTHER facility. This is the
  -- global half of the index, and the reason transfer_tb_case() had to ship in
  -- the same migration rather than in Priority B.
  update public.referrals set facility_id = v_fac_b, status = 'received'
   where referral_id = v_ref_bo;

  perform pg_temp.become('dots_b');
  begin
    perform public.create_tb_case(v_pat_a, null, null, null);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('one active case', 'second case, other facility', 'dots_b', ok, msg);

  -- Only an admin may transfer, and only an admin.
  foreach msg in array array['dots_a','dots_b','bhw','midwife','anonymous','no_profile'] loop
    perform pg_temp.become(msg);
    begin
      perform public.transfer_tb_case(v_case, v_fac_b, 'matrix');
      ok := true;
    exception when others then ok := false;
    end;
    reset role;
    perform pg_temp.expect_denied('transfer_tb_case ACL', 'transfer', msg, ok, '');
  end loop;

  -- The transfer itself, with BOTH an originating referral and a linked
  -- appointment — the shape ARCH-01 said could not execute in either order.
  select v into v_appt_a from t_ids where k = 'appt_a';
  perform pg_temp.become('dots_a');
  begin
    perform public.assign_appointment_to_case(v_appt_a, v_case);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('assign_appointment_to_case', 'link swap', 'dots_a', ok, msg);

  -- The swap CLEARS referral_id (R2-02): one facility_id can never have two
  -- live parents.
  select count(*) into n from public.appointments
   where appointment_id = v_appt_a
     and referral_id is null and tb_case_id = v_case;
  insert into t_result values ('link exclusivity', 'referral cleared on assign', 'dots_a',
    '1', n::text, 'referral_id null, tb_case_id set',
    case when n = 1 then 'PASS' else 'FAIL' end);

  perform pg_temp.become('admin');
  begin
    perform public.transfer_tb_case(v_case, v_fac_b, 'matrix transfer');
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('transfer_tb_case', 'case with referral + appointment', 'admin', ok, msg);

  -- The appointment followed the case, in the same statement.
  select count(*) into n from public.appointments
   where appointment_id = v_appt_a
     and facility_id = v_fac_b;
  insert into t_result values ('transfer cascade', 'appointment follows the case', 'admin',
    '1', n::text, 'ON UPDATE CASCADE on appointments_case_facility_agrees',
    case when n = 1 then 'PASS' else 'FAIL' end);

  -- The releasing facility loses read access immediately; the destination
  -- gains it. Two halves of one assertion — either alone can pass wrongly.
  perform pg_temp.become('dots_a');
  select count(*) into n from public.tb_cases where case_id = v_case;
  reset role;
  insert into t_result values ('transfer visibility', 'releasing facility', 'dots_a',
    '0', n::text, '', case when n = 0 then 'PASS' else 'FAIL' end);

  perform pg_temp.become('dots_b');
  select count(*) into n from public.tb_cases where case_id = v_case;
  reset role;
  insert into t_result values ('transfer visibility', 'destination facility', 'dots_b',
    '1', n::text, '', case when n = 1 then 'PASS' else 'FAIL' end);

  -- Move it home so the rest of the matrix reads normally.
  perform pg_temp.become('admin');
  perform public.transfer_tb_case(v_case, v_fac_a, 'matrix transfer back');
  reset role;
end;
$unique$;


-- ===========================================================================
-- Pass 4 — idempotency that is bound to actor, facility and payload (ARCH-07).
-- ===========================================================================
do $idem$
declare
  v_pat_w uuid;
  v_req   uuid := gen_random_uuid();
  v_first uuid;
  v_again uuid;
  ok      boolean;
  msg     text;
  n       bigint;
begin
  select v into v_pat_w from t_ids where k = 'pat_walkin';

  -- The walk-in case already exists from Pass 2, so close it out of the way
  -- and use a fresh patient for a clean replay test.
  insert into public.patients
    (patient_id, display_code, enrolled_by, age, sex, barangay_code, sms_consent)
  values (gen_random_uuid(), 'MTC-0005', (select v from t_ids where k = 'dots_a'),
          40, 'male', (select code from t_brgy where t_brgy.n = 1), false);
  select patient_id into v_pat_w from public.patients where display_code = 'MTC-0005';

  perform pg_temp.become('dots_a');
  select case_id into v_first from public.create_tb_case(v_pat_w, null, null, v_req);
  reset role;

  -- Same key, same actor, same payload: the SAME case, not a second one.
  perform pg_temp.become('dots_a');
  select case_id into v_again from public.create_tb_case(v_pat_w, null, null, v_req);
  reset role;
  insert into t_result values ('idempotency', 'replay returns the same case', 'dots_a',
    v_first::text, v_again::text, '',
    case when v_first = v_again then 'PASS' else 'FAIL' end);

  select count(*) into n from public.tb_cases where patient_id = v_pat_w;
  insert into t_result values ('idempotency', 'replay creates no second case', 'dots_a',
    '1', n::text, '', case when n = 1 then 'PASS' else 'FAIL' end);

  -- Same key, DIFFERENT payload: the uniform denial, never the stored result.
  perform pg_temp.become('dots_a');
  begin
    perform public.create_tb_case(v_pat_w, null, public.manila_today() - 3, v_req);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('idempotency', 'same key, different payload', 'dots_a', ok, msg);

  -- Same key, different ACTOR at the same facility.
  perform pg_temp.become('dots_a2');
  begin
    perform public.create_tb_case(v_pat_w, null, null, v_req);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('idempotency', 'same key, different actor', 'dots_a2', ok, msg);

  -- The denial is the UNIFORM one. A message that named the failing binding
  -- would itself tell a caller that someone else holds that key.
  insert into t_result values ('idempotency', 'denial is uniform', 'dots_a2',
    'not authorized', left(msg, 20), msg,
    case when msg like 'not authorized%' then 'PASS' else 'FAIL' end);
end;
$idem$;


-- ===========================================================================
-- Pass 5 — the lifecycle: one transition authority, symmetric invariants.
-- ===========================================================================
do $lifecycle$
declare
  v_case uuid;
  ok     boolean;
  msg    text;
  st     text;
begin
  select case_id into v_case from public.tb_cases
   where patient_id = (select v from t_ids where k = 'pat_a');

  -- Starting treatment without a date is one clinical event missing its date,
  -- not a valid intermediate state (R2-04).
  perform pg_temp.become('dots_a');
  begin
    perform public.set_tb_case_status(v_case, 'on_treatment', null, null, null);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('lifecycle', 'on_treatment without a start date', 'dots_a', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    perform public.set_tb_case_status(v_case, 'on_treatment', public.manila_today(), null, null);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('lifecycle', 'registered -> on_treatment', 'dots_a', ok, msg);

  -- An illegal edge, through the RPC.
  perform pg_temp.become('dots_a');
  begin
    perform public.set_tb_case_status(v_case, 'registered', null, null, null);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('lifecycle', 'on_treatment -> registered', 'dots_a', ok, msg);

  -- Closing needs an outcome AND its date.
  perform pg_temp.become('dots_a');
  begin
    perform public.set_tb_case_status(v_case, 'closed', null, null, null);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('lifecycle', 'closed without an outcome', 'dots_a', ok, msg);

  -- An outcome outside the NTP vocabulary.
  perform pg_temp.become('dots_a');
  begin
    perform public.set_tb_case_status(v_case, 'closed', null, 'recovered', public.manila_today());
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('lifecycle', 'outcome outside the NTP six', 'dots_a', ok, msg);

  -- The trigger is the SAME authority as the RPC, so a direct database session
  -- cannot take an edge the RPC refuses either. (auth.role() is null here, so
  -- this is the back-office path, not a client one.)
  begin
    update public.tb_cases set case_status = 'registered' where case_id = v_case;
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  perform pg_temp.expect_denied('lifecycle', 'illegal edge by direct UPDATE', 'migration role', ok, msg);

  select case_status into st from public.tb_cases where case_id = v_case;
  insert into t_result values ('lifecycle', 'status after the refused edges', 'dots_a',
    'on_treatment', st, '', case when st = 'on_treatment' then 'PASS' else 'FAIL' end);
end;
$lifecycle$;


-- ===========================================================================
-- Pass 6 — appointment ownership is not client-writable (R3-01, ARCH-04).
--
-- Every path of enforce_appointment_ownership() separately, because the
-- revision this replaces got exactly one of them wrong in a way that would
-- have broken a live workflow while looking safe.
-- ===========================================================================
do $ownership$
declare
  v_appt_a  uuid;
  v_appt_b  uuid;
  v_appt_l  uuid;
  v_fac_a   uuid;
  v_fac_b   uuid;
  v_case    uuid;
  v_row     public.appointments;
  ok        boolean;
  msg       text;
  n         bigint;
begin
  select v into v_appt_a from t_ids where k = 'appt_a';
  select v into v_appt_b from t_ids where k = 'appt_b';
  select v into v_appt_l from t_ids where k = 'appt_legacy';
  select v into v_fac_a  from t_ids where k = 'fac_a';
  select v into v_fac_b  from t_ids where k = 'fac_b';
  select case_id into v_case from public.tb_cases
   where patient_id = (select v from t_ids where k = 'pat_a');

  -- (a) A malicious PATCH of each ownership column, including to NULL — the
  --     patient-wide revival.
  perform pg_temp.become('dots_a');
  begin
    update public.appointments set facility_id = v_fac_b where appointment_id = v_appt_a;
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('ownership trigger', 'PATCH facility_id to another facility', 'dots_a', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    update public.appointments set facility_id = null where appointment_id = v_appt_a;
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('ownership trigger', 'PATCH facility_id to NULL', 'dots_a', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    update public.appointments set tb_case_id = null where appointment_id = v_appt_a;
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('ownership trigger', 'PATCH tb_case_id to NULL', 'dots_a', ok, msg);

  -- tb_case_id is not even in the column grant, so this must fail on
  -- privileges before the trigger is reached. Both layers, one assertion.
  insert into t_result values ('column grant', 'appointments.tb_case_id UPDATE', 'authenticated',
    'false', has_column_privilege('authenticated','public.appointments','tb_case_id','UPDATE')::text,
    '', case when not has_column_privilege('authenticated','public.appointments','tb_case_id','UPDATE')
             then 'PASS' else 'FAIL' end);

  -- (b) THE POSITIVE CONTROL, and the one the mobile client depends on: an
  --     identical whole-row re-send after a lost response. If this fails, a
  --     queued offline write is stranded forever.
  select * into v_row from public.appointments where appointment_id = v_appt_a;
  perform pg_temp.become('dots_a');
  begin
    update public.appointments
       set patient_id     = v_row.patient_id,
           scheduled_date = v_row.scheduled_date,
           attended_date  = v_row.attended_date,
           status         = v_row.status,
           facility_id    = v_row.facility_id,
           referral_id    = v_row.referral_id
     where appointment_id = v_appt_a;
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('ownership trigger', 'identical whole-row re-send', 'dots_a', ok, msg);

  -- (c) An ordinary clinical edit still works.
  perform pg_temp.become('dots_a');
  begin
    update public.appointments set status = 'missed' where appointment_id = v_appt_a;
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('ownership trigger', 'ordinary status edit', 'dots_a', ok, msg);
  update public.appointments set status = 'scheduled' where appointment_id = v_appt_a;

  -- (d) A link swap outside the RPC.
  perform pg_temp.become('dots_a');
  begin
    update public.appointments set tb_case_id = v_case, referral_id = null
     where appointment_id = v_appt_l;
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('ownership trigger', 'link swap outside the RPC', 'dots_a', ok, msg);

  -- (e) Claiming another facility's row, and claiming one this facility does
  --     own. §3.1's authority rule: pat_a is referred only to A.
  perform pg_temp.become('dots_b');
  begin
    perform public.claim_unassigned_appointment(v_appt_l);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('claim_unassigned', 'legacy row of another facility''s patient', 'dots_b', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    perform public.claim_unassigned_appointment(v_appt_l);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('claim_unassigned', 'sole-referral facility claims it', 'dots_a', ok, msg);

  -- (f) The one_owner CHECK.
  begin
    update public.appointments set referral_id = (select v from t_ids where k = 'ref_a')
     where appointment_id = v_appt_a;   -- already case-linked
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  perform pg_temp.expect_denied('one_owner CHECK', 'both links set', 'migration role', ok, msg);

  -- (g) Cross-facility invisibility, both ways round.
  perform pg_temp.become('dots_b');
  select count(*) into n from public.appointments where appointment_id in (v_appt_a, v_appt_l);
  reset role;
  insert into t_result values ('appointment visibility', 'A''s rows seen by B', 'dots_b',
    '0', n::text, '', case when n = 0 then 'PASS' else 'FAIL' end);

  perform pg_temp.become('dots_a');
  select count(*) into n from public.appointments where appointment_id = v_appt_b;
  reset role;
  insert into t_result values ('appointment visibility', 'B''s row seen by A', 'dots_a',
    '0', n::text, '', case when n = 0 then 'PASS' else 'FAIL' end);

  perform pg_temp.become('dots_a');
  select count(*) into n from public.appointments where appointment_id in (v_appt_a, v_appt_l);
  reset role;
  insert into t_result values ('appointment visibility', 'own rows seen by A', 'dots_a',
    '2', n::text, 'positive control for the two denials above',
    case when n = 2 then 'PASS' else 'FAIL' end);
end;
$ownership$;


-- ===========================================================================
-- Pass 7 — the referral cascade, which revision 3 would have broken outright.
--
-- A BHW re-routing a still-submitted referral issues an ordinary authenticated
-- UPDATE. The cascade fires inside that statement and carries NO privileged
-- role and NO GUC. Revision 3's auth.role() exemption would have rejected it
-- (R3-01), so this is tested as its own path with no RPC anywhere near it.
-- ===========================================================================
do $cascade$
declare
  v_pat   uuid := gen_random_uuid();
  v_scr   uuid := gen_random_uuid();
  v_ref   uuid := gen_random_uuid();
  v_appt  uuid := gen_random_uuid();
  v_fac_a uuid;
  v_fac_b uuid;
  v_ref_bo uuid;
  v_case  uuid;
  ok      boolean;
  msg     text;
  n       bigint;
begin
  select v into v_fac_a from t_ids where k = 'fac_a';
  select v into v_fac_b from t_ids where k = 'fac_b';
  select v into v_ref_bo from t_ids where k = 'ref_bo';

  insert into public.patients
    (patient_id, display_code, enrolled_by, age, sex, barangay_code, sms_consent)
  values (v_pat, 'MTC-0006', (select v from t_ids where k = 'bhw'),
          25, 'female', (select code from t_brgy where t_brgy.n = 1), false);
  insert into public.screenings (screening_id, patient_id, referred) values (v_scr, v_pat, true);
  insert into public.referrals (referral_id, patient_id, screening_id, facility_id, status)
  values (v_ref, v_pat, v_scr, v_fac_a, 'submitted');
  insert into public.appointments
    (appointment_id, patient_id, scheduled_date, status, facility_id, referral_id)
  values (v_appt, v_pat, public.manila_today() + 3, 'scheduled', v_fac_a, v_ref);

  perform pg_temp.become('bhw');
  begin
    update public.referrals set facility_id = v_fac_b where referral_id = v_ref;
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('referral cascade', 'BHW re-routes a submitted referral', 'bhw', ok, msg);

  select count(*) into n from public.appointments
   where appointment_id = v_appt and facility_id = v_fac_b;
  insert into t_result values ('referral cascade', 'appointment followed the referral', 'bhw',
    '1', n::text, 'ON UPDATE CASCADE, authorized by the parent, not by a role',
    case when n = 1 then 'PASS' else 'FAIL' end);

  -- ...but a referral a case cites is provenance and cannot be re-routed.
  --
  -- This is NOT asked as the BHW, and the reason is worth stating: once a case
  -- cites a referral the referral is `received`, and referrals_bhw_update
  -- limits a BHW to `submitted` rows. The attempt would match zero rows,
  -- raise nothing, and the check would pass while proving nothing — the
  -- vacuous-green shape this file's header is about. So the trigger is
  -- exercised from the strongest writer there is: a direct database session,
  -- which no policy filters and which every other ownership rule exempts.
  update public.referrals set facility_id = v_fac_a, status = 'received' where referral_id = v_ref;
  perform pg_temp.become('dots_a');
  select case_id into v_case from public.create_tb_case(v_pat, v_ref, null, null);
  reset role;

  begin
    update public.referrals set facility_id = v_fac_b where referral_id = v_ref;
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  perform pg_temp.expect_denied('referral provenance',
    're-route a referral cited by a case', 'migration role', ok, msg);

  -- The positive control: an UNCITED referral still re-routes from the same
  -- session, so the denial above is the trigger biting rather than the
  -- statement failing for an unrelated reason.
  begin
    update public.referrals set facility_id = v_fac_a where referral_id = v_ref_bo;
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  perform pg_temp.expect_ok('referral provenance',
    're-route an uncited referral', 'migration role', ok, msg);

  -- ...and put it back. `ref_bo` belongs to pat_b, and Pass 12 asserts that
  -- DOTS A cannot schedule pat_b because pat_b is referred only to DOTS B.
  -- Leaving this control's side effect in place would quietly hand pat_b a
  -- facility-A referral and make that admission check pass. A fixture mutation
  -- that outlives the check it serves is a trap for whoever adds the next pass.
  update public.referrals set facility_id = v_fac_b where referral_id = v_ref_bo;
end;
$cascade$;


-- ===========================================================================
-- Pass 8 — follow-ups: effective privileges, temporal bounds, void semantics.
-- ===========================================================================
do $followups$
declare
  v_case   uuid;
  v_appt   uuid := gen_random_uuid();
  v_pat    uuid;
  v_fu     uuid;
  v_fu2    uuid;
  ok       boolean;
  msg      text;
  n        bigint;
  col      text;
begin
  select case_id, patient_id into v_case, v_pat from public.tb_cases
   where patient_id = (select v from t_ids where k = 'pat_a');

  -- R3-02 — the EFFECTIVE privileges, not the REVOKE statements. A column
  -- revoke against a table-level grant runs cleanly and changes nothing, which
  -- is exactly how this survived two revisions.
  foreach col in array array['visit_date','voided_at','voided_by','void_reason'] loop
    insert into t_result values ('column grant', 'treatment_followups.' || col || ' UPDATE',
      'authenticated', 'false',
      has_column_privilege('authenticated','public.treatment_followups',col,'UPDATE')::text, '',
      case when not has_column_privilege('authenticated','public.treatment_followups',col,'UPDATE')
           then 'PASS' else 'FAIL' end);
  end loop;

  -- The positive control: `notes` IS granted, so the four above are not
  -- passing because the whole table is unreachable.
  insert into t_result values ('column grant', 'treatment_followups.notes UPDATE',
    'authenticated', 'true',
    has_column_privilege('authenticated','public.treatment_followups','notes','UPDATE')::text,
    'positive control',
    case when has_column_privilege('authenticated','public.treatment_followups','notes','UPDATE')
         then 'PASS' else 'FAIL' end);

  -- A visit, recorded atomically against an attended appointment.
  insert into public.appointments
    (appointment_id, patient_id, scheduled_date, status, facility_id, tb_case_id)
  values (v_appt, v_pat, public.manila_today(), 'scheduled',
          (select v from t_ids where k = 'fac_a'), v_case);

  perform pg_temp.become('dots_a');
  begin
    select followup_id into v_fu from public.record_visit(
      p_case_id => v_case, p_visit_date => public.manila_today(),
      p_appointment_id => v_appt, p_notes => 'matrix note');
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('record_visit', 'attended visit with a note', 'dots_a', ok, msg);

  -- record_visit marked attendance in the same transaction.
  select count(*) into n from public.appointments
   where appointment_id = v_appt and status = 'attended'
     and attended_date = public.manila_today();
  insert into t_result values ('record_visit', 'attendance marked atomically', 'dots_a',
    '1', n::text, '', case when n = 1 then 'PASS' else 'FAIL' end);

  -- A second LIVE follow-up on the same appointment is refused.
  perform pg_temp.become('dots_a');
  begin
    perform public.record_visit(
      p_case_id => v_case, p_visit_date => public.manila_today(),
      p_appointment_id => v_appt, p_notes => 'duplicate');
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('follow-up cardinality', 'second live follow-up per appointment', 'dots_a', ok, msg);

  -- A future visit date, and one before the case was registered.
  perform pg_temp.become('dots_a');
  begin
    perform public.record_visit(
      p_case_id => v_case, p_visit_date => public.manila_today() + 1);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('temporal bounds', 'visit date in the future', 'dots_a', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    perform public.record_visit(
      p_case_id => v_case, p_visit_date => public.manila_today() - 400);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('temporal bounds', 'visit date before registration', 'dots_a', ok, msg);

  -- A direct PATCH of visit_date: rejected by privilege, and it must be,
  -- because the date has to move together with the attendance date (R2-07).
  perform pg_temp.become('dots_a');
  begin
    update public.treatment_followups set visit_date = public.manila_today() - 1
     where followup_id = v_fu;
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('RPC-only column', 'direct PATCH of visit_date', 'dots_a', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    update public.treatment_followups set voided_at = now() where followup_id = v_fu;
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('RPC-only column', 'direct PATCH of voided_at', 'dots_a', ok, msg);

  -- ...while an ordinary note correction is an ordinary UPDATE.
  perform pg_temp.become('dots_a');
  begin
    update public.treatment_followups set notes = 'corrected' where followup_id = v_fu;
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('ordinary correction', 'notes', 'dots_a', ok, msg);

  -- The atomic date correction moves BOTH rows.
  perform pg_temp.become('dots_a');
  begin
    perform public.correct_followup_visit_date(v_fu, public.manila_today() - 1);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('correct_followup_visit_date', 'linked visit date', 'dots_a', ok, msg);

  select count(*) into n
    from public.treatment_followups f
    join public.appointments a on a.appointment_id = f.appointment_id
   where f.followup_id = v_fu and a.attended_date = f.visit_date;
  insert into t_result values ('correct_followup_visit_date', 'both rows agree', 'dots_a',
    '1', n::text, '', case when n = 1 then 'PASS' else 'FAIL' end);

  -- Voiding frees the slot (R2-07): the replacement can be recorded, which the
  -- plain UNIQUE would have made impossible without direct database access.
  perform pg_temp.become('dots_a');
  begin
    perform public.void_tb_followup(v_fu, 'recorded against the wrong patient');
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('void_tb_followup', 'void a live record', 'dots_a', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    select followup_id into v_fu2 from public.record_visit(
      p_case_id => v_case,
      p_visit_date => (select attended_date from public.appointments where appointment_id = v_appt),
      p_appointment_id => v_appt, p_notes => 'replacement');
    ok := v_fu2 is not null; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('void_tb_followup', 'replacement fits the freed slot', 'dots_a', ok, msg);

  -- Cross-facility: B sees no follow-up of A's case, and A does.
  perform pg_temp.become('dots_b');
  select count(*) into n from public.treatment_followups where case_id = v_case;
  reset role;
  insert into t_result values ('follow-up visibility', 'another facility''s case', 'dots_b',
    '0', n::text, '', case when n = 0 then 'PASS' else 'FAIL' end);

  perform pg_temp.become('dots_a');
  select count(*) into n from public.treatment_followups where case_id = v_case;
  reset role;
  insert into t_result values ('follow-up visibility', 'own case', 'dots_a',
    '2', n::text, 'positive control (one voided, one live)',
    case when n = 2 then 'PASS' else 'FAIL' end);

  -- Nobody else gets a policy at all — a follow-up note is the most sensitive
  -- row this migration adds.
  foreach col in array array['bhw','midwife','admin','anonymous','no_profile'] loop
    perform pg_temp.become(col);
    begin
      select count(*) into n from public.treatment_followups;
      msg := 'no policy grants them a row';
    exception when insufficient_privilege then
      -- anon holds no table privilege at all, so it is refused one layer
      -- earlier than the others. That is a stronger denial, not a weaker one,
      -- and saying which layer refused keeps this from being the "privilege
      -- error looks like a policy denial" trap.
      n := 0; msg := 'refused at the privilege layer, before RLS';
    end;
    reset role;
    insert into t_result values ('follow-up visibility', 'any follow-up row', col,
      '0', n::text, msg, case when n = 0 then 'PASS' else 'FAIL' end);
  end loop;
end;
$followups$;


-- ===========================================================================
-- Pass 9 — closing a case, and what it does to the schedule (gate decision 6).
-- ===========================================================================
do $closing$
declare
  v_case   uuid;
  v_pat    uuid;
  v_fac_a  uuid;
  v_past   uuid := gen_random_uuid();
  v_future uuid := gen_random_uuid();
  v_ref_a  uuid;
  ok       boolean;
  msg      text;
  st_past  text;
  st_fut   text;
begin
  select case_id, patient_id into v_case, v_pat from public.tb_cases
   where patient_id = (select v from t_ids where k = 'pat_a');
  select v into v_fac_a from t_ids where k = 'fac_a';
  select v into v_ref_a from t_ids where k = 'ref_a';

  insert into public.appointments
    (appointment_id, patient_id, scheduled_date, status, facility_id, tb_case_id) values
    (v_past,   v_pat, public.manila_today() - 5, 'scheduled', v_fac_a, v_case),
    (v_future, v_pat, public.manila_today() + 5, 'scheduled', v_fac_a, v_case);

  perform pg_temp.become('dots_a');
  begin
    perform public.set_tb_case_status(
      v_case, 'closed', null, 'treatment_completed', public.manila_today());
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('closing', 'on_treatment -> closed', 'dots_a', ok, msg);

  select status into st_past from public.appointments where appointment_id = v_past;
  select status into st_fut  from public.appointments where appointment_id = v_future;

  -- Past scheduled rows are the input to missed-visit handling. Erasing them
  -- would hide a real gap in care, so the sweep is bounded at manila_today().
  insert into t_result values ('closing', 'past scheduled row untouched', 'dots_a',
    'scheduled', st_past, '', case when st_past = 'scheduled' then 'PASS' else 'FAIL' end);
  insert into t_result values ('closing', 'future scheduled row cancelled', 'dots_a',
    'cancelled', st_fut, '', case when st_fut = 'cancelled' then 'PASS' else 'FAIL' end);

  -- A closed case never reopens, and takes no new appointments.
  perform pg_temp.become('dots_a');
  begin
    perform public.set_tb_case_status(v_case, 'on_treatment', public.manila_today(), null, null);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('closing', 'closed -> on_treatment', 'dots_a', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    insert into public.appointments
      (patient_id, scheduled_date, status, facility_id, tb_case_id)
    values (v_pat, public.manila_today() + 20, 'scheduled', v_fac_a, v_case);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('closing', 'schedule against a closed case', 'dots_a', ok, msg);

  -- A relapse is a NEW case for the same patient — the reason patient_id is
  -- not unique on tb_cases and the partial index excludes terminal rows.
  perform pg_temp.become('dots_a');
  begin
    perform public.create_tb_case(v_pat, v_ref_a, null, null);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('closing', 'a new episode after the old one closed', 'dots_a', ok, msg);
end;
$closing$;


-- ===========================================================================
-- Pass 10 — table grants, audit whitelist, and the helper surface.
-- ===========================================================================
do $surface$
declare
  v_case  uuid;
  v_pat_a uuid;
  v_pat_b uuid;
  v_fac_a uuid;
  v_dots  uuid;
  ok      boolean;
  msg     text;
  n       bigint;
  p       text;
begin
  -- Every id this block needs, resolved while the role is still the migration
  -- role. Touching a temp table after `set local role` raises a PRIVILEGE
  -- error, which inside an EXCEPTION block is indistinguishable from the
  -- policy denial the check is looking for.
  select v into v_pat_a from t_ids where k = 'pat_a';
  select v into v_pat_b from t_ids where k = 'pat_b';
  select v into v_fac_a from t_ids where k = 'fac_a';
  select v into v_dots  from t_ids where k = 'dots_a';
  select case_id into v_case from public.tb_cases
   where patient_id = v_pat_a and case_status <> 'closed' limit 1;

  -- tb_cases is SELECT-only for every client role (ARCH-03). A direct PATCH of
  -- case_status must fail on privileges before RLS or the trigger is reached.
  perform pg_temp.become('dots_a');
  begin
    update public.tb_cases set case_status = 'cancelled' where case_id = v_case;
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('tb_cases write surface', 'direct PATCH of case_status', 'dots_a', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    insert into public.tb_cases
      (patient_id, facility_id, case_number, created_by)
    values (v_pat_b, v_fac_a, 'TBC-FAKE-2026-99999', v_dots);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('tb_cases write surface', 'direct INSERT', 'dots_a', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    delete from public.tb_cases where case_id = v_case;
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('tb_cases write surface', 'direct DELETE', 'dots_a', ok, msg);

  -- The audit whitelist. `notes` is the column the whole construct exists to
  -- keep out of the log.
  begin
    insert into public.audit_logs (entity_table, entity_id, action, changes)
    values ('treatment_followups', gen_random_uuid(), 'updated',
            jsonb_build_object('notes', jsonb_build_object('from','a','to','b')));
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  perform pg_temp.expect_denied('audit whitelist', 'notes in changes', 'migration role', ok, msg);

  begin
    insert into public.audit_logs (entity_table, entity_id, action, changes)
    values ('treatment_followups', gen_random_uuid(), 'updated',
            jsonb_build_object('visit_date', jsonb_build_object('from','2026-01-01','to','2026-01-02')));
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  perform pg_temp.expect_ok('audit whitelist', 'visit_date in changes', 'migration role', ok, msg);

  -- Audit rows exist and are scoped. A' sees its facility's; B sees none of
  -- them; the admin sees them (whitelisted metadata only).
  perform pg_temp.become('dots_a');
  select count(*) into n from public.audit_logs where entity_table = 'tb_cases';
  reset role;
  insert into t_result values ('audit read', 'own facility tb_cases events', 'dots_a',
    '>0', n::text, '', case when n > 0 then 'PASS' else 'FAIL' end);

  perform pg_temp.become('dots_b');
  select count(*) into n from public.audit_logs where facility_id = v_fac_a;
  reset role;
  insert into t_result values ('audit read', 'another facility''s events', 'dots_b',
    '0', n::text, '', case when n = 0 then 'PASS' else 'FAIL' end);

  perform pg_temp.become('bhw');
  select count(*) into n from public.audit_logs;
  reset role;
  insert into t_result values ('audit read', 'any audit row', 'bhw',
    '0', n::text, '', case when n = 0 then 'PASS' else 'FAIL' end);

  -- No client role can write the log at all.
  perform pg_temp.become('dots_a');
  begin
    insert into public.audit_logs (entity_table, entity_id, action)
    values ('tb_cases', v_case, 'closed');
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('audit write surface', 'client INSERT', 'dots_a', ok, msg);

  -- The enumerating helper is not reachable as an RPC (R3-05). `public` has no
  -- copy of it at all, and app_private is not an exposed schema — but the
  -- policy path must still work, which the follow-up counts above prove.
  perform pg_temp.become('dots_a');
  begin
    execute 'select count(*) from public.own_facility_case_ids()';
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('helper surface', 'public.own_facility_case_ids', 'dots_a', ok, msg);

  -- caller_owns_unassigned_appointment() must be false for everyone who is not
  -- an active TB-DOTS caller at the sole referral facility, and true for the
  -- one who is.
  foreach p in array array['anonymous','no_profile','bhw_inactive','bhw','midwife','admin','dots_b'] loop
    perform pg_temp.become(p);
    begin
      select public.caller_owns_unassigned_appointment(v_pat_a) into ok;
      msg := '';
    exception when others then ok := false; msg := left(sqlerrm, 70);
    end;
    reset role;
    insert into t_result values ('legacy authority', 'caller_owns_unassigned_appointment', p,
      'false', coalesce(ok::text, 'null'), msg,
      case when coalesce(ok, false) = false then 'PASS' else 'FAIL' end);
  end loop;

  perform pg_temp.become('dots_a');
  select public.caller_owns_unassigned_appointment(v_pat_a) into ok;
  reset role;
  insert into t_result values ('legacy authority', 'caller_owns_unassigned_appointment', 'dots_a',
    'true', coalesce(ok::text, 'null'), 'positive control',
    case when coalesce(ok, false) then 'PASS' else 'FAIL' end);

  -- rpc_requests and case_number_counters are reachable by nobody.
  foreach p in array array['rpc_requests','case_number_counters'] loop
    perform pg_temp.become('dots_a');
    begin
      execute format('select count(*) from public.%I', p);
      ok := true; msg := '';
    exception when others then ok := false; msg := left(sqlerrm, 70);
    end;
    reset role;
    perform pg_temp.expect_denied('internal table', p, 'dots_a', ok, msg);
  end loop;
end;
$surface$;


-- ===========================================================================
-- Pass 11 — the BHW's server-side column boundary (Task 1.2 §8.1).
-- ===========================================================================
do $bhw$
declare
  v_pat uuid;
  r     record;
  n     int;
  cols  text;
begin
  select v into v_pat from t_ids where k = 'pat_a';

  perform pg_temp.become('bhw');
  select count(*) into n from public.bhw_case_summary(v_pat);
  reset role;
  insert into t_result values ('bhw_case_summary', 'rows for a visible patient', 'bhw',
    '>0', n::text, '', case when n > 0 then 'PASS' else 'FAIL' end);

  -- ...and it exposes four columns, none of them clinical.
  select string_agg(a.attname, ',' order by a.attnum) into cols
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    cross join lateral unnest(p.proargnames) with ordinality as a(attname, attnum)
   where ns.nspname = 'public' and p.proname = 'bhw_case_summary'
     and a.attname <> 'p_patient_id';
  insert into t_result values ('bhw_case_summary', 'returned columns', 'bhw',
    'patient_id,case_status,facility_name,registration_date', coalesce(cols, '(none)'),
    'no outcome, no dates beyond registration, no notes',
    case when cols = 'patient_id,case_status,facility_name,registration_date'
         then 'PASS' else 'FAIL' end);

  -- A TB-DOTS caller gets nothing from it: it is the BHW's window, not a
  -- second way into case data.
  perform pg_temp.become('dots_a');
  select count(*) into n from public.bhw_case_summary(v_pat);
  reset role;
  insert into t_result values ('bhw_case_summary', 'rows for a non-BHW caller', 'dots_a',
    '0', n::text, '', case when n = 0 then 'PASS' else 'FAIL' end);
end;
$bhw$;


-- ===========================================================================
-- Pass 12 — appointment links preserve patient identity as well as facility.
--
-- A facility-only composite FK permits an appointment for patient A to cite
-- patient B's referral or case at the same facility. That corrupts the care
-- timeline and lets assign_appointment_to_case() mark the wrong patient's
-- appointment attended through record_visit(). The unlinked insert check also
-- preserves 0011's admission boundary: naming one's own facility is not enough
-- to schedule an arbitrary patient.
-- ===========================================================================
do $appointment_patient_agreement$
declare
  v_appt       uuid;
  v_case       public.tb_cases;
  v_pat_a      uuid;
  v_pat_b      uuid;
  v_ref_b      uuid;
  v_fac_a      uuid;
  v_fac_b      uuid;
  ok           boolean;
  msg          text;
begin
  select v into v_pat_a from t_ids where k = 'pat_a';
  select v into v_pat_b from t_ids where k = 'pat_b';
  select v into v_ref_b from t_ids where k = 'ref_b';
  select v into v_fac_a from t_ids where k = 'fac_a';
  select v into v_fac_b from t_ids where k = 'fac_b';
  select * into v_case from public.tb_cases
   where case_status not in ('closed','cancelled')
   order by created_at limit 1;

  -- The referral and facility agree with each other, but the patient does not.
  -- A declarative patient/facility link must reject this even for the migration
  -- owner, where RLS and client privileges cannot manufacture a denial.
  v_appt := gen_random_uuid();
  begin
    insert into public.appointments
      (appointment_id, patient_id, scheduled_date, status, facility_id, referral_id)
    values
      (v_appt, v_pat_a, public.manila_today() + 20, 'scheduled', v_fac_b, v_ref_b);
    ok := true; msg := '';
    delete from public.appointments where appointment_id = v_appt;
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  perform pg_temp.expect_denied('appointment patient agreement',
    'referral belongs to another patient', 'migration role', ok, msg);

  -- The same invariant must hold for the case link used by record_visit().
  v_appt := gen_random_uuid();
  begin
    insert into public.appointments
      (appointment_id, patient_id, scheduled_date, status, facility_id, tb_case_id)
    values
      (v_appt,
       case when v_case.patient_id = v_pat_a then v_pat_b else v_pat_a end,
       public.manila_today() + 21, 'scheduled', v_case.facility_id, v_case.case_id);
    ok := true; msg := '';
    delete from public.appointments where appointment_id = v_appt;
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  perform pg_temp.expect_denied('appointment patient agreement',
    'case belongs to another patient', 'migration role', ok, msg);

  -- Preserve the pre-0031 admission boundary for unlinked facility-created
  -- appointments. pat_b is referred only to facility B, so DOTS A must not be
  -- able to claim it merely by supplying its own facility_id.
  v_appt := gen_random_uuid();
  perform pg_temp.become('dots_a');
  begin
    insert into public.appointments
      (appointment_id, patient_id, scheduled_date, status, facility_id)
    values (v_appt, v_pat_b, public.manila_today() + 22, 'scheduled', v_fac_a);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  delete from public.appointments where appointment_id = v_appt;
  perform pg_temp.expect_denied('appointment admission',
    'unlinked patient outside caller facility scope', 'dots_a', ok, msg);

  -- Positive control: DOTS A can still create the same unlinked shape for a
  -- patient whose referral names DOTS A.
  v_appt := gen_random_uuid();
  perform pg_temp.become('dots_a');
  begin
    insert into public.appointments
      (appointment_id, patient_id, scheduled_date, status, facility_id)
    values (v_appt, v_pat_a, public.manila_today() + 23, 'scheduled', v_fac_a);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  delete from public.appointments where appointment_id = v_appt;
  perform pg_temp.expect_ok('appointment admission',
    'unlinked patient referred to caller facility', 'dots_a', ok, msg);
end;
$appointment_patient_agreement$;


-- ===========================================================================
-- Pass 13 — closing against recorded visits (M31-04), record_visit()'s
-- advertised transitions (M31-05), and the RPC half of patient agreement
-- (M31-02).
--
-- These three findings share one shape: a rule that was enforced on ONE side of
-- a pair. The follow-up trigger checked `visit_date <= outcome_date` when the
-- follow-up moved but not when the case did; the appointment FK checked the
-- facility but not the patient; record_visit() advertised transitions it had no
-- inputs to perform. Each check below therefore comes with the control that
-- proves it is the new rule biting and not the operation being broken outright.
-- ===========================================================================
do $m31$
declare
  v_fac_a   uuid;
  v_pat_a   uuid;
  v_case_a  uuid;
  v_brgy    text;
  v_pat13   uuid := gen_random_uuid();
  v_scr13   uuid := gen_random_uuid();
  v_ref13   uuid := gen_random_uuid();
  v_case13  uuid;
  v_pat14   uuid := gen_random_uuid();
  v_scr14   uuid := gen_random_uuid();
  v_ref14   uuid := gen_random_uuid();
  v_case14  uuid;
  v_fu14    uuid;
  v_appt_x  uuid := gen_random_uuid();
  v_appt_y  uuid := gen_random_uuid();
  ok        boolean;
  msg       text;
  st        text;
  oc        text;
begin
  select v into v_fac_a from t_ids where k = 'fac_a';
  select v into v_pat_a from t_ids where k = 'pat_a';
  select code into v_brgy from t_brgy where t_brgy.n = 1;
  select case_id into v_case_a from public.tb_cases
   where patient_id = v_pat_a and case_status not in ('closed','cancelled');

  -- A patient of our own, so nothing here disturbs the earlier passes.
  insert into public.patients
    (patient_id, display_code, enrolled_by, age, sex, barangay_code, sms_consent)
  values (v_pat13, 'MTC-0013', (select v from t_ids where k = 'dots_a'),
          44, 'male', v_brgy, false);
  insert into public.screenings (screening_id, patient_id, referred)
  values (v_scr13, v_pat13, true);
  insert into public.referrals (referral_id, patient_id, screening_id, facility_id, status)
  values (v_ref13, v_pat13, v_scr13, v_fac_a, 'received');

  perform pg_temp.become('dots_a');
  select case_id into v_case13 from public.create_tb_case(
    v_pat13, v_ref13, public.manila_today() - 60, null);
  reset role;

  -- -------------------------------------------------------------------------
  -- M31-02, RPC half: assign_appointment_to_case() must compare PATIENTS.
  -- The patient-aware FK would reject the write anyway; this asserts the RPC
  -- refuses it as an authorization question, before the constraint is reached.
  -- -------------------------------------------------------------------------
  insert into public.appointments
    (appointment_id, patient_id, scheduled_date, status, facility_id) values
    (v_appt_x, v_pat_a,  public.manila_today() + 30, 'scheduled', v_fac_a),
    (v_appt_y, v_pat13, public.manila_today() + 30, 'scheduled', v_fac_a);

  perform pg_temp.become('dots_a');
  begin
    perform public.assign_appointment_to_case(v_appt_x, v_case13);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('appointment patient agreement',
    'assign another patient''s appointment to this case', 'dots_a', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    perform public.assign_appointment_to_case(v_appt_y, v_case13);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('appointment patient agreement',
    'assign this patient''s own appointment', 'dots_a', ok, msg);

  -- -------------------------------------------------------------------------
  -- M31-05: every transition record_visit() advertises, and every one it does
  -- not. The first version silently advertised all five and could perform two.
  -- -------------------------------------------------------------------------
  perform pg_temp.become('dots_a');
  begin
    perform public.record_visit(
      p_case_id => v_case13, p_visit_date => public.manila_today() - 3,
      p_new_case_status => 'cancelled');
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('record_visit transitions',
    'cancelled — an episode opened in error has no visits', 'dots_a', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    perform public.record_visit(
      p_case_id => v_case13, p_visit_date => public.manila_today() - 3,
      p_new_case_status => 'registered');
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('record_visit transitions',
    'a status this call cannot set', 'dots_a', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    perform public.record_visit(
      p_case_id => v_case13, p_visit_date => public.manila_today() - 3,
      p_new_case_status => 'closed');
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('record_visit transitions',
    'closed without an outcome', 'dots_a', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    perform public.record_visit(
      p_case_id => v_case13, p_visit_date => public.manila_today() - 3,
      p_next_scheduled_date => public.manila_today() + 7,
      p_new_case_status => 'closed',
      p_outcome => 'cured', p_outcome_date => public.manila_today() - 3);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('record_visit transitions',
    'book a next visit while closing (D6)', 'dots_a', ok, msg);

  -- Nothing above may have left a follow-up behind: a rejected call must write
  -- nothing at all, which is the entire argument for one atomic RPC.
  insert into t_result
  select 'record_visit transitions', 'refused calls wrote nothing', 'dots_a',
         '0', count(*)::text, '',
         case when count(*) = 0 then 'PASS' else 'FAIL' end
    from public.treatment_followups where case_id = v_case13;

  -- registered -> on_treatment, WITH the start date the transition needs.
  perform pg_temp.become('dots_a');
  begin
    perform public.record_visit(
      p_case_id => v_case13, p_visit_date => public.manila_today() - 3,
      p_notes => 'treatment started',
      p_new_case_status => 'on_treatment',
      p_treatment_start_date => public.manila_today() - 3);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('record_visit transitions',
    'registered -> on_treatment with a start date', 'dots_a', ok, msg);

  select case_status into st from public.tb_cases where case_id = v_case13;
  insert into t_result values ('record_visit transitions', 'the status actually moved',
    'dots_a', 'on_treatment', st, '',
    case when st = 'on_treatment' then 'PASS' else 'FAIL' end);

  perform pg_temp.become('dots_a');
  begin
    perform public.record_visit(
      p_case_id => v_case13, p_visit_date => public.manila_today() - 2,
      p_new_case_status => 'interrupted');
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('record_visit transitions',
    'on_treatment -> interrupted', 'dots_a', ok, msg);

  perform pg_temp.become('dots_a');
  begin
    perform public.record_visit(
      p_case_id => v_case13, p_visit_date => public.manila_today() - 1,
      p_new_case_status => 'closed',
      p_outcome => 'treatment_completed', p_outcome_date => public.manila_today() - 1);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('record_visit transitions',
    'interrupted -> closed with an outcome', 'dots_a', ok, msg);

  select case_status, outcome into st, oc from public.tb_cases where case_id = v_case13;
  insert into t_result values ('record_visit transitions', 'the outcome was stored',
    'dots_a', 'closed/treatment_completed', st || '/' || coalesce(oc, 'null'), '',
    case when st = 'closed' and oc = 'treatment_completed' then 'PASS' else 'FAIL' end);

  -- -------------------------------------------------------------------------
  -- M31-04: a case may not be closed with an outcome dated before a visit it
  -- has already recorded.
  -- -------------------------------------------------------------------------
  insert into public.patients
    (patient_id, display_code, enrolled_by, age, sex, barangay_code, sms_consent)
  values (v_pat14, 'MTC-0014', (select v from t_ids where k = 'dots_a'),
          45, 'female', v_brgy, false);
  insert into public.screenings (screening_id, patient_id, referred)
  values (v_scr14, v_pat14, true);
  insert into public.referrals (referral_id, patient_id, screening_id, facility_id, status)
  values (v_ref14, v_pat14, v_scr14, v_fac_a, 'received');

  perform pg_temp.become('dots_a');
  select case_id into v_case14 from public.create_tb_case(
    v_pat14, v_ref14, public.manila_today() - 60, null);
  perform public.set_tb_case_status(
    v_case14, 'on_treatment', public.manila_today() - 30, null, null);
  select followup_id into v_fu14 from public.record_visit(
    p_case_id => v_case14, p_visit_date => public.manila_today() - 1,
    p_notes => 'the last visit');
  reset role;

  perform pg_temp.become('dots_a');
  begin
    perform public.set_tb_case_status(
      v_case14, 'closed', null, 'cured', public.manila_today() - 5);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('closing vs recorded visits',
    'outcome dated before a live follow-up', 'dots_a', ok, msg);

  -- The same correction through the other RPC that can move the date.
  perform pg_temp.become('dots_a');
  begin
    perform public.correct_tb_case_dates(
      v_case14, public.manila_today() - 30, public.manila_today() - 5);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_denied('closing vs recorded visits',
    'correct the outcome date to before a live follow-up', 'dots_a', ok, msg);

  -- Voiding the visit frees the date: the check counts LIVE rows, and saying
  -- so is the difference between a scoped rule and a blanket one.
  perform pg_temp.become('dots_a');
  begin
    perform public.void_tb_followup(v_fu14, 'recorded on the wrong case');
    perform public.set_tb_case_status(
      v_case14, 'closed', null, 'cured', public.manila_today() - 5);
    ok := true; msg := '';
  exception when others then ok := false; msg := left(sqlerrm, 70);
  end;
  reset role;
  perform pg_temp.expect_ok('closing vs recorded visits',
    'the same close, after the follow-up is voided', 'dots_a', ok, msg);

  select case_status into st from public.tb_cases where case_id = v_case14;
  insert into t_result values ('closing vs recorded visits', 'the case did close',
    'dots_a', 'closed', st, 'positive control for both denials above',
    case when st = 'closed' then 'PASS' else 'FAIL' end);
end;
$m31$;


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
    raise exception '0031 matrix produced no rows at all — the harness did not run';
  end if;
  if n_fail > 0 then
    raise exception '0031 matrix: % of % checks FAILED — do not apply 0031', n_fail, n_all;
  end if;
  raise notice '0031 matrix: all % checks PASSED', n_all;
end;
$verdict$;
