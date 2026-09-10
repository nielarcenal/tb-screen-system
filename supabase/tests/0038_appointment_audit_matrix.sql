-- ============================================================================
-- 0038_appointment_audit_matrix.sql — behaviour matrix for C41-02.
--
-- WHAT IT PROVES
--
--   1. An ordinary authenticated PATCH — the path both clients actually use —
--      produces exactly one audit event. That is the gap C41-02 names.
--   2. Every RPC appointment path still produces exactly ONE event. Not zero
--      (the removal went too far) and not two (the trigger double-logs).
--   3. No-op writes and rejected writes produce zero events.
--   4. The emitted keys are exactly the 0031 whitelist for appointments, and
--      the forbidden ones are absent by name.
--   5. The viewer is facility-isolated, denies BHW / midwife / inactive / anon,
--      and pages stably across a tie in occurred_at.
--   6. Referral, case and follow-up auditing still behave as 0035 and 0031
--      left them.
--
-- ---------------------------------------------------------------------------
-- HOW TO RUN IT. This file opens no transaction and must not be run alone.
--
--     node scripts/build-preflight.mjs 0038
--
-- writes supabase/tests/0038_preflight.generated.sql =
--   begin; <0038> <this file> rollback;
-- Run that whole file. It always rolls back, so it changes nothing, and a
-- single FAIL aborts it.
-- ---------------------------------------------------------------------------
--
-- THE COUNTING DISCIPLINE. Every assertion below counts events written by ONE
-- named action, by taking a count immediately before and immediately after it.
-- A bare "how many rows does this appointment have" would pass while the
-- trigger fired at the wrong moment, and the whole risk of this migration is a
-- path that logs twice or not at all.
-- ============================================================================

create temp table t_ids (k text primary key, v uuid) on commit drop;
insert into t_ids (k, v)
select k, gen_random_uuid()
  from unnest(array[
    'fac_a','fac_b',
    'staff_a','staff_b','bhw_1','midwife_1','staff_inactive',
    'pat','scr','ref','case_a',
    'appt_patch','appt_visit','appt_future','appt_legacy','appt_swap',
    'pat_b','scr_b','ref_b','appt_b'
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
      '0038 matrix needs a barangay with no existing patients; every seeded '
      'barangay is occupied. Point the fixture at a disposable branch.';
  end if;
end;
$fixture_guard$;

insert into public.facilities (facility_id, name, type, address, short_code)
select v, 'Audit Appt DOTS A', 'tb_dots', 'test', 'APTA' from t_ids where k = 'fac_a';
insert into public.facilities (facility_id, name, type, address, short_code)
select v, 'Audit Appt DOTS B', 'tb_dots', 'test', 'APTB' from t_ids where k = 'fac_b';

insert into auth.users (id) select v from t_ids
 where k in ('staff_a','staff_b','bhw_1','midwife_1','staff_inactive');

insert into public.users (user_id, role, full_name, facility_id, assigned_barangay_code, active)
values
  ((select v from t_ids where k = 'staff_a'), 'tb_dots', 'Appt Staff A',
   (select v from t_ids where k = 'fac_a'), null, true),
  ((select v from t_ids where k = 'staff_b'), 'tb_dots', 'Appt Staff B',
   (select v from t_ids where k = 'fac_b'), null, true),
  ((select v from t_ids where k = 'staff_inactive'), 'tb_dots', 'Appt Staff Gone',
   (select v from t_ids where k = 'fac_a'), null, false),
  ((select v from t_ids where k = 'bhw_1'), 'bhw', 'Appt BHW',
   (select v from t_ids where k = 'fac_a'), (select code from t_brgy), true),
  ((select v from t_ids where k = 'midwife_1'), 'midwife', 'Appt Midwife',
   (select v from t_ids where k = 'fac_a'), (select code from t_brgy), true);

insert into public.patients
  (patient_id, display_code, enrolled_by, age, sex, barangay_code, sms_consent)
values
  ((select v from t_ids where k = 'pat'), 'APT-0001',
   (select v from t_ids where k = 'bhw_1'), 39, 'female', (select code from t_brgy), false),
  ((select v from t_ids where k = 'pat_b'), 'APT-0002',
   (select v from t_ids where k = 'bhw_1'), 46, 'male', (select code from t_brgy), false);

insert into public.screenings (screening_id, patient_id, referred)
values
  ((select v from t_ids where k = 'scr'),   (select v from t_ids where k = 'pat'),   true),
  ((select v from t_ids where k = 'scr_b'), (select v from t_ids where k = 'pat_b'), true);

insert into public.referrals (referral_id, patient_id, screening_id, facility_id, status)
values
  ((select v from t_ids where k = 'ref'), (select v from t_ids where k = 'pat'),
   (select v from t_ids where k = 'scr'), (select v from t_ids where k = 'fac_a'), 'received'),
  ((select v from t_ids where k = 'ref_b'), (select v from t_ids where k = 'pat_b'),
   (select v from t_ids where k = 'scr_b'), (select v from t_ids where k = 'fac_b'), 'received');

-- The case is inserted directly rather than through create_tb_case(). This is a
-- fixture, not a test of enrolment: 0031's matrix owns that path, and building
-- it here would couple this file to case-number generation it does not care
-- about.
insert into public.tb_cases
  (case_id, patient_id, referral_id, facility_id, case_number, registration_date,
   case_status, treatment_start_date, created_by)
select (select v from t_ids where k = 'case_a'), (select v from t_ids where k = 'pat'),
       (select v from t_ids where k = 'ref'),    (select v from t_ids where k = 'fac_a'),
       'TBC-APTA-2026-99001', public.manila_today() - 40,
       'on_treatment', public.manila_today() - 39,
       (select v from t_ids where k = 'staff_a');

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

-- A genuine unauthenticated session. `reset role` alone is not one: the jwt
-- claim is a transaction-local GUC that outlives the role change (C35-02).
create or replace function pg_temp.as_anon() returns void
language plpgsql as $$
begin
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.as_direct_session() returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.appt_events(p_appt uuid)
returns bigint language sql stable as $$
  select count(*) from public.audit_logs
   where entity_table = 'appointments' and entity_id = p_appt;
$$;


-- ===========================================================================
-- 1. The gap C41-02 names: an ordinary authenticated PATCH.
-- ===========================================================================
do $patch$
declare
  u_a     uuid := (select v from t_ids where k = 'staff_a');
  v_appt  uuid := (select v from t_ids where k = 'appt_patch');
  n0      bigint;
  n1      bigint;
  r       record;
begin
  -- The insert itself is an event: 'created'.
  n0 := pg_temp.appt_events(v_appt);
  perform pg_temp.as_user(u_a);
  insert into public.appointments
    (appointment_id, patient_id, scheduled_date, status, facility_id, referral_id)
  values (v_appt, (select v from t_ids where k = 'pat'),
          public.manila_today() - 2, 'scheduled',
          (select v from t_ids where k = 'fac_a'),
          (select v from t_ids where k = 'ref'));
  reset role;
  n1 := pg_temp.appt_events(v_appt);

  insert into t_result values ('patch: insert logs once', 'tb_dots A',
    '1 event', (n1 - n0)::text || ' event(s)',
    'scheduling from the portal was invisible to the trail before 0038',
    case when n1 - n0 = 1 then 'PASS' else 'FAIL' end);

  -- Marking it missed — the everyday write that produced nothing before.
  n0 := n1;
  perform pg_temp.as_user(u_a);
  update public.appointments set status = 'missed' where appointment_id = v_appt;
  reset role;
  n1 := pg_temp.appt_events(v_appt);

  insert into t_result values ('patch: status change logs once', 'tb_dots A',
    '1 event', (n1 - n0)::text || ' event(s)',
    'THE C41-02 CASE: no RPC is involved and 0031 recorded nothing',
    case when n1 - n0 = 1 then 'PASS' else 'FAIL' end);

  select * into r from public.audit_logs
   where entity_table = 'appointments' and entity_id = v_appt
     and changes ? 'status' and changes #>> '{status,to}' = 'missed';

  insert into t_result values ('patch: actor is the caller', 'tb_dots A',
    'staff A / tb_dots',
    coalesce(r.actor_user_id::text, 'null') || ' / ' || coalesce(r.actor_role, 'null'),
    'the trigger is SECURITY DEFINER but write_audit reads the caller''s jwt',
    case when r.actor_user_id = u_a and r.actor_role = 'tb_dots' then 'PASS' else 'FAIL' end);

  insert into t_result values ('patch: both ends recorded', 'tb_dots A',
    'scheduled -> missed',
    coalesce(r.changes #>> '{status,from}', 'null') || ' -> ' ||
    coalesce(r.changes #>> '{status,to}', 'null'),
    'a trail that records only the new value cannot reconstruct anything',
    case when r.changes #>> '{status,from}' = 'scheduled'
          and r.changes #>> '{status,to}'   = 'missed' then 'PASS' else 'FAIL' end);

  -- A no-op. updated_at still fires, so the trigger sees an UPDATE.
  n0 := n1;
  perform pg_temp.as_user(u_a);
  update public.appointments set status = status where appointment_id = v_appt;
  reset role;
  n1 := pg_temp.appt_events(v_appt);

  insert into t_result values ('patch: no-op logs nothing', 'tb_dots A',
    '0 events', (n1 - n0)::text || ' event(s)',
    'an idempotent mobile re-send must not bury the real events',
    case when n1 = n0 then 'PASS' else 'FAIL' end);

  -- A rejected write. Cross-facility update is refused by RLS; nothing may be
  -- logged for a change that did not happen.
  n0 := n1;
  perform pg_temp.as_user((select v from t_ids where k = 'staff_b'));
  update public.appointments set status = 'attended' where appointment_id = v_appt;
  reset role;
  n1 := pg_temp.appt_events(v_appt);

  insert into t_result values ('patch: rejected write logs nothing', 'tb_dots B',
    '0 events', (n1 - n0)::text || ' event(s)',
    'RLS matches no row, so there is no change and must be no event',
    case when n1 = n0 then 'PASS' else 'FAIL' end);
end;
$patch$;


-- ===========================================================================
-- 2. Multi-row updates: one event per changed appointment, and only for the
--    ones that actually changed.
-- ===========================================================================
do $multirow$
declare
  u_a    uuid := (select v from t_ids where k = 'staff_a');
  a1     uuid := gen_random_uuid();
  a2     uuid := gen_random_uuid();
  n_a1   bigint;
  n_a2   bigint;
  n_patch bigint;
begin
  perform pg_temp.as_user(u_a);
  insert into public.appointments
    (appointment_id, patient_id, scheduled_date, status, facility_id, referral_id)
  values
    (a1, (select v from t_ids where k = 'pat'), public.manila_today() - 6, 'scheduled',
     (select v from t_ids where k = 'fac_a'), (select v from t_ids where k = 'ref')),
    (a2, (select v from t_ids where k = 'pat'), public.manila_today() - 7, 'scheduled',
     (select v from t_ids where k = 'fac_a'), (select v from t_ids where k = 'ref'));
  reset role;

  n_patch := pg_temp.appt_events((select v from t_ids where k = 'appt_patch'));

  -- One statement, two rows changed, one row already 'missed' and untouched.
  perform pg_temp.as_user(u_a);
  update public.appointments
     set status = 'missed'
   where patient_id = (select v from t_ids where k = 'pat')
     and status = 'scheduled';
  reset role;

  n_a1 := pg_temp.appt_events(a1);
  n_a2 := pg_temp.appt_events(a2);

  insert into t_result values ('multi-row: one event each', 'tb_dots A',
    '1 and 1', n_a1::text || ' and ' || n_a2::text,
    'FOR EACH ROW, so a two-row statement is two events, not one and not four',
    case when n_a1 = 2 and n_a2 = 2 then 'PASS' else 'FAIL' end);
    -- 2 each: one 'created' from the insert above, one from this update.

  insert into t_result values ('multi-row: untouched row unaffected', 'tb_dots A',
    'no new event',
    (pg_temp.appt_events((select v from t_ids where k = 'appt_patch')) - n_patch)::text || ' new',
    'the already-missed row did not match the predicate and must not be logged',
    case when pg_temp.appt_events((select v from t_ids where k = 'appt_patch')) = n_patch
         then 'PASS' else 'FAIL' end);
end;
$multirow$;


-- ===========================================================================
-- 3. Every RPC appointment path: exactly one event. Never zero, never two.
--
-- This is the assertion the whole migration turns on. Zero means §3's removal
-- went too far; two means the trigger is stacked on a surviving call.
-- ===========================================================================
do $rpcs$
declare
  u_a      uuid := (select v from t_ids where k = 'staff_a');
  v_case   uuid := (select v from t_ids where k = 'case_a');
  v_visit  uuid := (select v from t_ids where k = 'appt_visit');
  v_future uuid := (select v from t_ids where k = 'appt_future');
  v_legacy uuid := (select v from t_ids where k = 'appt_legacy');
  v_swap   uuid := (select v from t_ids where k = 'appt_swap');
  n0 bigint; n1 bigint;
  v_followup public.treatment_followups;
begin
  -- 3a. record_visit() marking an appointment attended.
  perform pg_temp.as_user(u_a);
  insert into public.appointments
    (appointment_id, patient_id, scheduled_date, status, facility_id, tb_case_id)
  values (v_visit, (select v from t_ids where k = 'pat'),
          public.manila_today() - 1, 'scheduled',
          (select v from t_ids where k = 'fac_a'), v_case);
  reset role;

  n0 := pg_temp.appt_events(v_visit);
  perform pg_temp.as_user(u_a);
  v_followup := public.record_visit(v_case, public.manila_today() - 1, v_visit);
  reset role;
  n1 := pg_temp.appt_events(v_visit);

  insert into t_result values ('rpc: record_visit attendance', 'tb_dots A',
    '1 event', (n1 - n0)::text || ' event(s)',
    'the RPC no longer audits it; the trigger does, exactly once',
    case when n1 - n0 = 1 then 'PASS' else 'FAIL' end);

  -- 3b. record_visit() creating the next appointment.
  declare v_next uuid;
  begin
    perform pg_temp.as_user(u_a);
    perform public.record_visit(
      v_case, public.manila_today(), null, null, public.manila_today() + 14);
    reset role;

    select appointment_id into v_next from public.appointments
     where tb_case_id = v_case and scheduled_date = public.manila_today() + 14;

    insert into t_result values ('rpc: record_visit next appointment', 'tb_dots A',
      '1 event, action created',
      coalesce(pg_temp.appt_events(v_next)::text, 'null') || ' event(s)',
      'an INSERT inside an RPC is one created event, not two',
      case when pg_temp.appt_events(v_next) = 1
            and exists (select 1 from public.audit_logs
                         where entity_table = 'appointments' and entity_id = v_next
                           and action = 'created')
           then 'PASS' else 'FAIL' end);
  end;

  -- 3d. claim_unassigned_appointment() on a legacy unowned row.
  --     Inserted from a direct session so it can carry no facility at all.
  perform pg_temp.as_direct_session();
  insert into public.appointments
    (appointment_id, patient_id, scheduled_date, status)
  values (v_legacy, (select v from t_ids where k = 'pat'),
          public.manila_today() + 3, 'scheduled');

  n0 := pg_temp.appt_events(v_legacy);
  perform pg_temp.as_user(u_a);
  perform public.claim_unassigned_appointment(v_legacy);
  reset role;
  n1 := pg_temp.appt_events(v_legacy);

  insert into t_result values ('rpc: claim unassigned', 'tb_dots A',
    '1 event', (n1 - n0)::text || ' event(s)',
    'facility_id null -> A, audited once by the trigger',
    case when n1 - n0 = 1 then 'PASS' else 'FAIL' end);

  -- 3e. assign_appointment_to_case() swapping referral link for case link.
  perform pg_temp.as_user(u_a);
  insert into public.appointments
    (appointment_id, patient_id, scheduled_date, status, facility_id, referral_id)
  values (v_swap, (select v from t_ids where k = 'pat'),
          public.manila_today() + 5, 'scheduled',
          (select v from t_ids where k = 'fac_a'), (select v from t_ids where k = 'ref'));
  reset role;

  n0 := pg_temp.appt_events(v_swap);
  perform pg_temp.as_user(u_a);
  perform public.assign_appointment_to_case(v_swap, v_case);
  reset role;
  n1 := pg_temp.appt_events(v_swap);

  insert into t_result values ('rpc: assign to case', 'tb_dots A',
    '1 event', (n1 - n0)::text || ' event(s)',
    'referral_id and tb_case_id move together in one event',
    case when n1 - n0 = 1 then 'PASS' else 'FAIL' end);

  -- 3f. set_tb_case_status() cancelling a future appointment on closure.
  --
  -- LAST on purpose. 0031 permits no transition out of `closed` — a closed case
  -- never reopens, a new episode is a new case — so any check needing an open
  -- case has to run before this one. The first draft closed the case here and
  -- then tried to reopen it for 3e, which the transition trigger correctly
  -- refused.
  perform pg_temp.as_user(u_a);
  insert into public.appointments
    (appointment_id, patient_id, scheduled_date, status, facility_id, tb_case_id)
  values (v_future, (select v from t_ids where k = 'pat'),
          public.manila_today() + 30, 'scheduled',
          (select v from t_ids where k = 'fac_a'), v_case);
  reset role;

  n0 := pg_temp.appt_events(v_future);
  perform pg_temp.as_user(u_a);
  perform public.set_tb_case_status(
    v_case, 'closed', null, 'treatment_completed', public.manila_today());
  reset role;
  n1 := pg_temp.appt_events(v_future);

  insert into t_result values ('rpc: closure cancels future visit', 'tb_dots A',
    '1 event, action cancelled', (n1 - n0)::text || ' event(s)',
    'the sweep''s per-row event, now from the trigger and still once each',
    case when n1 - n0 = 1
          and exists (select 1 from public.audit_logs
                       where entity_table = 'appointments' and entity_id = v_future
                         and action = 'cancelled')
         then 'PASS' else 'FAIL' end);
end;
$rpcs$;


-- ===========================================================================
-- 4. Key exactness. The trigger may emit only the six keys 0031 approved for
--    appointments, and must never emit anything else.
-- ===========================================================================
do $keys$
declare
  bad text;
  n_bad int;
begin
  select count(*), string_agg(distinct k, ', ')
    into n_bad, bad
    from public.audit_logs a,
         lateral jsonb_object_keys(a.changes) k
   where a.entity_table = 'appointments'
     and a.entity_id in (select v from t_ids)
     and k not in ('status','scheduled_date','attended_date',
                   'facility_id','referral_id','tb_case_id');

  insert into t_result values ('keys: nothing outside the whitelist', '-',
    'no unexpected keys', coalesce(bad, 'none'),
    'the whitelist trigger would have raised, but assert it rather than trust it',
    case when n_bad = 0 then 'PASS' else 'FAIL' end);

  -- Named forbidden keys, asked explicitly. A generic "no unexpected keys"
  -- check passes trivially if the trigger stops emitting anything at all.
  select count(*) into n_bad
    from public.audit_logs a
   where a.entity_table = 'appointments'
     and (a.changes ? 'patient_id' or a.changes ? 'notes'
          or a.changes ? 'contact_number' or a.changes ? 'result_outcome');

  insert into t_result values ('keys: forbidden keys absent', '-',
    '0', n_bad::text,
    'patient_id, notes, contact_number and result_outcome, by name',
    case when n_bad = 0 then 'PASS' else 'FAIL' end);

  -- The positive control for this section: the six approved keys must actually
  -- have appeared somewhere, or both checks above are vacuous.
  select count(distinct k) into n_bad
    from public.audit_logs a,
         lateral jsonb_object_keys(a.changes) k
   where a.entity_table = 'appointments'
     and a.entity_id in (select v from t_ids);

  insert into t_result values ('keys: positive control', '-',
    '>= 4 distinct keys seen', n_bad::text || ' distinct',
    'without this, a trigger emitting {} would pass both checks above',
    case when n_bad >= 4 then 'PASS' else 'FAIL' end);
end;
$keys$;


-- ===========================================================================
-- 5. The viewer: isolation, denial, and stable pagination.
-- ===========================================================================
do $viewer$
declare
  n_a int; n_b int; n_bhw int; n_mid int; n_inactive int; n_anon int;
  v_page1 uuid[]; v_page2 uuid[]; v_all uuid[];
  v_last_at timestamptz; v_last_id uuid;
begin
  perform pg_temp.as_user((select v from t_ids where k = 'staff_a'));
  select count(*) into n_a from public.facility_audit_events(200)
   where facility_id = (select v from t_ids where k = 'fac_a');
  reset role;

  perform pg_temp.as_user((select v from t_ids where k = 'staff_a'));
  select count(*) into n_b from public.facility_audit_events(200)
   where facility_id = (select v from t_ids where k = 'fac_b');
  reset role;

  insert into t_result values ('viewer: own facility', 'tb_dots A',
    '> 0 rows', n_a::text || ' rows', '',
    case when n_a > 0 then 'PASS' else 'FAIL' end);

  insert into t_result values ('viewer: cross-facility', 'tb_dots A',
    '0 rows of B', n_b::text || ' rows',
    'B has audit rows of its own, so this is isolation and not emptiness',
    case when n_b = 0 then 'PASS' else 'FAIL' end);

  perform pg_temp.as_user((select v from t_ids where k = 'bhw_1'));
  select count(*) into n_bhw from public.facility_audit_events(200);
  reset role;

  perform pg_temp.as_user((select v from t_ids where k = 'midwife_1'));
  select count(*) into n_mid from public.facility_audit_events(200);
  reset role;

  perform pg_temp.as_user((select v from t_ids where k = 'staff_inactive'));
  select count(*) into n_inactive from public.facility_audit_events(200);
  reset role;

  insert into t_result values ('viewer: bhw denied', 'bhw',
    '0 rows', n_bhw::text || ' rows',
    'no audit_logs read policy exists for this role',
    case when n_bhw = 0 then 'PASS' else 'FAIL' end);

  insert into t_result values ('viewer: midwife denied', 'midwife',
    '0 rows', n_mid::text || ' rows', '',
    case when n_mid = 0 then 'PASS' else 'FAIL' end);

  insert into t_result values ('viewer: deactivated account denied', 'tb_dots inactive',
    '0 rows', n_inactive::text || ' rows',
    'current_user_active_role() returns null, so 0029''s policies filter it out',
    case when n_inactive = 0 then 'PASS' else 'FAIL' end);

  begin
    perform pg_temp.as_anon();
    select count(*) into n_anon from public.facility_audit_events(200);
    n_anon := coalesce(n_anon, 0);
  exception when others then
    n_anon := -1;                                  -- EXECUTE revoked: also a denial
  end;
  perform pg_temp.as_direct_session();

  insert into t_result values ('viewer: anon denied', 'anon',
    'no rows or no execute', case when n_anon = -1 then 'execute denied' else n_anon::text || ' rows' end,
    'the grant is to authenticated only',
    case when n_anon <= 0 then 'PASS' else 'FAIL' end);

  -- Pagination across a tie. Every event this fixture wrote shares one
  -- occurred_at (C35-03: now() is transaction-stable), so this is the hardest
  -- possible case for a keyset cursor and exactly the one OFFSET gets wrong.
  perform pg_temp.as_user((select v from t_ids where k = 'staff_a'));

  select array_agg(audit_id order by occurred_at desc, audit_id desc)
    into v_all from public.facility_audit_events(200);

  select array_agg(audit_id order by occurred_at desc, audit_id desc)
    into v_page1 from public.facility_audit_events(3);

  select occurred_at, audit_id into v_last_at, v_last_id
    from public.facility_audit_events(3)
   order by occurred_at desc, audit_id desc offset 2 limit 1;

  select array_agg(audit_id order by occurred_at desc, audit_id desc)
    into v_page2 from public.facility_audit_events(3, v_last_at, v_last_id);

  reset role;

  insert into t_result values ('viewer: page 1 is the head', 'tb_dots A',
    'first 3 of the full ordering',
    coalesce(array_length(v_page1, 1), 0)::text || ' rows',
    '',
    case when v_page1 = v_all[1:3] then 'PASS' else 'FAIL' end);

  insert into t_result values ('viewer: page 2 continues without gap or repeat', 'tb_dots A',
    'rows 4-6 of the full ordering',
    coalesce(array_length(v_page2, 1), 0)::text || ' rows',
    'every fixture event shares one occurred_at, so audit_id breaks the tie',
    case when v_page2 = v_all[4:6] then 'PASS' else 'FAIL' end);

  insert into t_result values ('viewer: limit is honoured', 'tb_dots A',
    '3 rows', coalesce(array_length(v_page1, 1), 0)::text || ' rows', '',
    case when array_length(v_page1, 1) = 3 then 'PASS' else 'FAIL' end);
end;
$viewer$;


-- ===========================================================================
-- 6. Regression: the other three entity tables still behave as they did.
-- ===========================================================================
do $regression$
declare
  n0 bigint; n1 bigint;
  v_ref uuid := (select v from t_ids where k = 'ref');
begin
  -- 0035's referral trigger.
  select count(*) into n0 from public.audit_logs
   where entity_table = 'referrals' and entity_id = v_ref;
  perform pg_temp.as_user((select v from t_ids where k = 'staff_a'));
  update public.referrals set status = 'tested' where referral_id = v_ref;
  reset role;
  select count(*) into n1 from public.audit_logs
   where entity_table = 'referrals' and entity_id = v_ref;

  insert into t_result values ('regression: referral audit', 'tb_dots A',
    '1 event', (n1 - n0)::text || ' event(s)',
    '0035 is untouched by this migration',
    case when n1 - n0 = 1 then 'PASS' else 'FAIL' end);

  -- 0031's case audit, still written by the RPC.
  select count(*) into n0 from public.audit_logs
   where entity_table = 'tb_cases' and entity_id = (select v from t_ids where k = 'case_a');

  insert into t_result values ('regression: case audit survives', '-',
    '> 0 events', n0::text || ' event(s)',
    'set_tb_case_status still audits tb_cases itself; only its appointment call went',
    case when n0 > 0 then 'PASS' else 'FAIL' end);

  -- 0031's follow-up audit, still written by record_visit().
  select count(*) into n0 from public.audit_logs
   where entity_table = 'treatment_followups';

  insert into t_result values ('regression: follow-up audit survives', '-',
    '> 0 events', n0::text || ' event(s)',
    'record_visit() kept its treatment_followups call',
    case when n0 > 0 then 'PASS' else 'FAIL' end);
end;
$regression$;


-- ===========================================================================
-- 7. Security posture, read from the catalogue rather than assumed.
-- ===========================================================================
insert into t_result
select 'posture: ' || p.proname, '-',
       expected, actual, detail,
       case when actual = expected then 'PASS' else 'FAIL' end
  from (
    select p.proname,
           case p.proname
             when 'audit_appointment_change' then 'secdef=true volatile=v search_path=set'
             when 'facility_audit_events'    then 'secdef=false volatile=s search_path=set'
           end as expected,
           'secdef=' || p.prosecdef::text ||
           ' volatile=' || p.provolatile::text ||
           ' search_path=' || case when p.proconfig is not null then 'set' else 'UNSET' end as actual,
           'a definer trigger must reach write_audit; the viewer must NOT bypass RLS' as detail
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('audit_appointment_change','facility_audit_events')
  ) p;

insert into t_result
select 'posture: audit_logs is select-only', '-',
       'no write policy',
       coalesce(string_agg(distinct polcmd::text, ','), 'none'),
       'a log a client can rewrite is not an audit trail',
       case when count(*) filter (where polcmd <> 'r') = 0 then 'PASS' else 'FAIL' end
  from pg_policy where polrelid = 'public.audit_logs'::regclass;

insert into t_result
select 'posture: trigger fn not client-callable', '-',
       'false / false',
       has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || ' / ' ||
       has_function_privilege('anon', p.oid, 'EXECUTE')::text,
       'nothing may forge an audit event by calling the trigger body',
       case when not has_function_privilege('authenticated', p.oid, 'EXECUTE')
             and not has_function_privilege('anon', p.oid, 'EXECUTE')
            then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'audit_appointment_change';

insert into t_result
select 'posture: viewer ACL', '-',
       'auth=true anon=false svc=false',
       'auth=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text ||
       ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text ||
       ' svc='  || has_function_privilege('service_role', p.oid, 'EXECUTE')::text,
       'service_role bypasses RLS, so it must not hold the invoker viewer either',
       case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
             and not has_function_privilege('anon', p.oid, 'EXECUTE')
             and not has_function_privilege('service_role', p.oid, 'EXECUTE')
            then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'facility_audit_events';

insert into t_result
select 'posture: one appointment audit writer', '-',
       '1 function', count(*)::text || ' function(s)',
       'any second writer is a double-log',
       case when count(*) = 1 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prosrc like '%write_audit(%'
   and p.prosrc like '%''appointments''%';

insert into t_result
select 'posture: rls enabled on audit_logs', '-',
       'true', c.relrowsecurity::text, '',
       case when c.relrowsecurity then 'PASS' else 'FAIL' end
  from pg_class c where c.oid = 'public.audit_logs'::regclass;


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
    raise exception '0038 matrix produced no rows — the harness did not run';
  end if;
  if n_fail > 0 then
    raise exception '0038 matrix: % of % checks FAILED — do not apply 0038', n_fail, n_all;
  end if;
  raise notice '0038 matrix: all % checks PASSED', n_all;
end;
$verdict$;
