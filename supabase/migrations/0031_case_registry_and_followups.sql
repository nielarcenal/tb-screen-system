-- ============================================================================
-- TB-Screen — 0031_case_registry_and_followups.sql
--
-- Tasks 1.2 and 1.3, approved at Revision 4 (CODEX_REVIEW.md, "Migration 0030,
-- BASE-05, and migration 0031 inputs"). This is the first migration that
-- creates mutable clinical case data, so it also carries every dependency
-- those designs put inside it: the audit table, the idempotency table, the
-- facility short codes and the appointment ownership boundary (BASE-02).
--
-- WHAT THIS MIGRATION IS FOR, in one line each:
--
--   * BASE-02 — appointments have no facility boundary of their own. Three
--     ownership columns, composite FKs that keep them honest, a trigger that
--     makes them not client-writable, and policies keyed on facility_id
--     instead of on "any patient referred to us".
--   * tb_cases — one treatment episode at one owning facility. A case is data
--     entry: a clinician has already decided. Nothing here scores, infers or
--     creates a case automatically (positioning §1/§5, architecture rule 12).
--   * treatment_followups — what happened at one visit inside one case. It
--     holds no scheduled_date, no attendance flag and no status of its own;
--     `appointments` remains the only scheduler (Task 1.3 §1, §7).
--   * audit_logs — server-written, whitelisted change history. Ships here
--     because every RPC below is specified to write to it (R2-03).
--   * rpc_requests — operation-namespaced, actor-bound, payload-bound
--     idempotency, so a lost response cannot mint a second case (ARCH-07).
--
-- THE SHAPE OF THE WRITE SURFACE. Case and follow-up data is RPC-only
-- (ARCH-03). `authenticated` holds SELECT on tb_cases and treatment_followups
-- and nothing else, apart from two ordinary correction columns on follow-ups.
-- There is no INSERT/UPDATE/DELETE policy on either table for any client role,
-- so a PostgREST PATCH has nothing to land on even before RLS is consulted.
--
-- FOUR CONSTRUCTS THIS FILE GETS RIGHT ON PURPOSE, each of which cost a review
-- round somewhere in this branch's history:
--
--   1. A column REVOKE does not subtract from a table-level grant. Every
--      column boundary below is `revoke ... on <table>` first, then `grant
--      (cols)` back — 0017's pattern (R2-01, R3-02).
--   2. A CHECK that evaluates to NULL is ACCEPTED. `facilities_short_code_scope`
--      spells out `short_code is not null` rather than letting a NULL regex
--      test make the whole constraint unknown (R3-03).
--   3. PUBLIC is grantee OID 0 and has no pg_roles row, and Supabase's default
--      privileges grant EXECUTE to `anon` and `service_role` BY NAME. Every
--      function below names all three in its revoke (M28-01).
--   4. Authorize a cascaded UPDATE by what the row ends up saying, not by who
--      appears to be calling. A referral re-route cascade is an ordinary
--      `authenticated` UPDATE and carries no privileged role (R3-01).
--
-- DELIBERATE DEVIATIONS FROM THE APPROVED DESIGN — flagged for review, not
-- slipped in. Each is a place where two approved sections could not both be
-- implemented, or where a section's own remedy needed a door left open:
--
--   D1. `correct_tb_case_dates()` does NOT take `p_registration_date`.
--       Task 1.2 §7.2's signature lists it, but §4 pins `registration_date`
--       in the immutable-column set, and the 0020 trigger is SECURITY INVOKER
--       — it reads the CALLER's `auth.role()`, which is still `authenticated`
--       inside a SECURITY DEFINER RPC. The parameter could therefore only
--       ever raise. §4's immutability is the load-bearing statement, so the
--       parameter is dropped rather than shipped as a guaranteed error.
--   D2. `enforce_appointment_ownership()` exempts a direct database session
--       (`auth.role()` null) and `service_role`, exactly as 0020 does. Task
--       1.3 §3.2 resolves ambiguous legacy rows "from a direct database
--       session"; without this exemption that remedy is unavailable and the
--       rows are unrepairable. Client callers are unaffected.
--   D3. Cancelling a case cancels its future scheduled appointments, the same
--       way closing one does. Task 1.3 §5 states the rule only for `closed`,
--       but `cancelled` is equally terminal and the no-terminal-scheduling
--       trigger treats them alike; leaving live appointments pointing at a
--       cancelled episode would be incoherent.
--   D4. `rpc_requests.operation` and `.result_kind` gain `record_visit` /
--       `treatment_followup`. Task 1.2 §7.3 fixed the vocabulary at two
--       operations before Task 1.3 §4.4 gave `record_visit()` an idempotency
--       key. Both are approved; the CHECK has to hold both.
--   D5. `record_visit()` takes no `p_weight_kg`, and `treatment_followups`
--       has no `weight_kg` column — Task 1.3 §4.5, gate item 4.
--   D6. `record_visit()` rejects a call that both books a next appointment and
--       closes the case. The two instructions contradict each other and D3
--       would immediately cancel what was just booked. It also refuses
--       `p_new_case_status = 'cancelled'` outright: an episode declared opened
--       in error cannot simultaneously have one of its visits written up. It
--       does carry `p_treatment_start_date`, `p_outcome` and `p_outcome_date`,
--       so the transitions it advertises are the ones it can actually perform
--       (M31-05).
--   D7. `create_tb_case()`'s referral-free admission arm is facility-scoped,
--       not caller-scoped. Task 1.2 §7.1 rule 4 names own_enrolled_patient_ids()
--       — `enrolled_by = auth.uid()` — while the same sentence describes the
--       rule as "this facility registered them as a walk-in". A walk-in
--       enrolled by a colleague is the same admission, so the arm matches the
--       sentence; it is narrowed to enrolment by TB-DOTS staff so a BHW's
--       barangay patient does not become admissible by sharing a facility_id.
--
-- WHAT IS NOT DONE HERE. `facility_id NOT NULL` on appointments is NOT set
-- (Task 1.3 §3.4): old mobile builds still insert rows without it, and the
-- window closes in a later migration once the minimum supported build is
-- enforced. The backfill below assigns every row that can be assigned
-- deterministically and reports what is left.
--
-- POSITIONING (§1, §5) unchanged. No score, no probability, no system-formed
-- clinical conclusion, and no automatic case creation from a positive result.
-- ============================================================================

-- No `begin;` / `commit;` here, deliberately — the preflight wraps this file in
-- a transaction it can roll back. See 0028's header for why.

-- ---------------------------------------------------------------------------
-- 0. Guards. This migration is meaningless, or actively wrong, without its
--    three predecessors. Each is detected by an object it introduced rather
--    than by a version table, because these migrations are hand-applied.
-- ---------------------------------------------------------------------------
do $guard$
begin
  if to_regprocedure('public.manila_today()') is null
     or to_regprocedure('public.manila_day_start(date)') is null then
    raise exception '0031 requires migration 0018 (Manila business calendar)';
  end if;

  if to_regprocedure('public.current_user_active_role()') is null then
    raise exception '0031 requires migration 0028 (current_user_active_role)';
  end if;

  if to_regnamespace('app_private') is null then
    raise exception '0031 requires migration 0029 (app_private schema, BASE-06)';
  end if;

  -- 0030 replaced barangay_report's body; there is no separate object to probe,
  -- so probe the body itself. A report still comparing timestamptz to a bare
  -- date is BASE-04 unfixed, and this migration adds more Manila-dated columns
  -- on top of it.
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'barangay_report'
       and p.prosrc like '%manila_day_start%'
  ) then
    raise exception '0031 requires migration 0030 (barangay_report Manila bounds)';
  end if;

  if to_regprocedure('public.enforce_immutable_columns()') is null then
    raise exception '0031 requires migration 0020 (enforce_immutable_columns)';
  end if;
end;
$guard$;


-- ===========================================================================
-- 1. facilities.short_code — the case-number prefix.
--
-- Order is load-bearing and is stated in the short-code proposal §1: add the
-- nullable column, populate the eleven reviewed rows, VERIFY, and only then
-- add the unique index and the CHECK. Adding the CHECK first would fail
-- against the existing rows; adding it without the verification step would let
-- an unseen live row slip through. These migrations are hand-applied, so a
-- live TB-DOTS facility absent from the mapping must STOP this migration, not
-- receive an invented code.
--
-- The eleven codes are reviewed project data (CLAUDE_FACILITY_SHORT_CODES_
-- PROPOSAL.md §2), keyed to the LGU rather than to the facility name — 0009
-- itself renamed `…d1`, and a code already printed on a patient record must
-- not follow a rename. Nothing derives a code from `facilities.name`.
-- ===========================================================================
alter table public.facilities add column if not exists short_code text;

update public.facilities set short_code = v.code
  from (values
    ('00000000-0000-0000-0000-0000000000d1'::uuid, 'BPMC'),
    ('00000000-0000-0000-0000-0000000000d2'::uuid, 'MLB'),
    ('00000000-0000-0000-0000-0000000000d3'::uuid, 'VAL'),
    ('00000000-0000-0000-0000-0000000000d4'::uuid, 'DCL'),
    ('00000000-0000-0000-0000-0000000000d5'::uuid, 'KLL'),
    ('00000000-0000-0000-0000-0000000000d6'::uuid, 'KTO'),
    ('00000000-0000-0000-0000-0000000000d7'::uuid, 'MFT'),
    ('00000000-0000-0000-0000-0000000000d8'::uuid, 'MRM'),
    ('00000000-0000-0000-0000-0000000000d9'::uuid, 'PNG'),
    ('00000000-0000-0000-0000-0000000000da'::uuid, 'SFD'),
    ('00000000-0000-0000-0000-0000000000db'::uuid, 'TLK')
  ) as v(facility_id, code)
 where facilities.facility_id = v.facility_id
   and facilities.type = 'tb_dots';

do $codes$
declare
  n_missing int;
  n_extra   int;
  names     text;
begin
  select count(*) into n_missing
    from public.facilities where type = 'tb_dots' and short_code is null;

  if n_missing > 0 then
    select string_agg(name, '; ' order by name) into names
      from public.facilities where type = 'tb_dots' and short_code is null;
    raise exception
      '0031: % TB-DOTS facility/facilities have no reviewed short code: %',
      n_missing, names
      using hint = 'Add the mapping to CLAUDE_FACILITY_SHORT_CODES_PROPOSAL.md '
                   'and to this migration. Do not invent a code here.';
  end if;

  select count(*) into n_extra
    from public.facilities where type <> 'tb_dots' and short_code is not null;

  if n_extra > 0 then
    raise exception
      '0031: % non-TB-DOTS facility/facilities carry a short code', n_extra
      using hint = 'short_code is a case-number prefix; only TB-DOTS rows have one.';
  end if;

  raise notice '0031: short codes populated for % TB-DOTS facilities',
    (select count(*) from public.facilities where type = 'tb_dots');
end;
$codes$;

-- NULLs do not collide in a PostgreSQL unique index, so barangay health
-- stations are simply absent from it.
create unique index if not exists facilities_short_code_uniq
  on public.facilities (short_code) where short_code is not null;

alter table public.facilities drop constraint if exists facilities_short_code_scope;
alter table public.facilities
  add constraint facilities_short_code_scope check (
    (type =  'tb_dots' and short_code is not null
                       and short_code ~ '^[A-Z0-9]{2,8}$')
    or
    (type <> 'tb_dots' and short_code is null)
  );

comment on column public.facilities.short_code is
  'Case-number prefix for a TB-DOTS facility, e.g. VAL in TBC-VAL-2026-00017 '
  '(0031). Required for tb_dots, forbidden elsewhere, unique where present, '
  'immutable once set. Reviewed data — never derived from facilities.name.';

-- A prefix already printed on a patient's record cannot be redefined later.
drop trigger if exists facilities_immutable_columns on public.facilities;
create trigger facilities_immutable_columns
  before update on public.facilities
  for each row execute function public.enforce_immutable_columns(
    'facility_id', 'short_code'
  );


-- ===========================================================================
-- 2. case_number_counters — a TRANSACTIONAL counter.
--
-- Task 1.2 §6 withdrew the sequence-based design: PostgreSQL sequences are
-- non-transactional, so a rolled-back insert still burns a value. An
-- `insert ... on conflict do update ... returning` takes a row lock instead,
-- which serialises concurrent creators at one facility AND rolls back with the
-- rest of the transaction. At this system's scale the lock is not contention.
--
-- No client touches this table; it is written only by create_tb_case().
-- ===========================================================================
create table if not exists public.case_number_counters (
  facility_id uuid not null references public.facilities(facility_id),
  year        int  not null,
  next_seq    int  not null default 1,
  primary key (facility_id, year)
);

alter table public.case_number_counters enable row level security;
revoke all on public.case_number_counters from anon;
revoke all on public.case_number_counters from authenticated;

comment on table public.case_number_counters is
  'Per-facility, per-year case-number counter (0031). Transactional, unlike a '
  'sequence: a rolled-back create_tb_case() gives the number back. RLS is on '
  'with no policy, so no client can read or write it under any role.';


-- ===========================================================================
-- 3. audit_logs — server-produced, whitelisted change history.
--
-- Ships here, not on Day 6 (R2-03): every RPC below is specified to write an
-- audit event, so scheduling the table later would leave them failing outright
-- or silently unaudited, with the early history unreconstructable afterwards.
-- The Day-6 task adds the VIEWER and widens coverage; it does not create this.
--
-- `changes` is a constrained whitelist, not a row dump, and the whitelist is
-- enforced by a trigger rather than by convention — so widening it takes a
-- migration and a review. It never holds treatment_followups.notes,
-- referrals.result or patients.contact_number.
--
-- patient_id and facility_id are denormalised onto the row on purpose: an
-- audit read must be authorizable without joining back into tables the reader
-- may not be allowed to see.
-- ===========================================================================
create table if not exists public.audit_logs (
  audit_id      uuid primary key default gen_random_uuid(),
  entity_table  text not null
                  check (entity_table in ('tb_cases','treatment_followups','appointments')),
  entity_id     uuid not null,
  action        text not null
                  check (action in ('created','updated','status_changed',
                                    'transferred','cancelled','closed','voided')),
  actor_user_id uuid references public.users(user_id),
  actor_role    text,
  patient_id    uuid references public.patients(patient_id),
  facility_id   uuid references public.facilities(facility_id),
  changes       jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now()
);

create index if not exists audit_logs_entity_idx   on public.audit_logs (entity_table, entity_id, occurred_at desc);
create index if not exists audit_logs_facility_idx on public.audit_logs (facility_id, occurred_at desc);
create index if not exists audit_logs_patient_idx  on public.audit_logs (patient_id, occurred_at desc);

-- The whitelist. A key outside it is a bug in a future writer, and the only
-- moment it can be caught cheaply is on the way in.
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
  end;

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

drop trigger if exists audit_logs_changes_whitelist on public.audit_logs;
create trigger audit_logs_changes_whitelist
  before insert or update on public.audit_logs
  for each row execute function public.enforce_audit_changes_whitelist();

alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon;
revoke all on public.audit_logs from authenticated;
grant  select on public.audit_logs to authenticated;

-- Reads only. There is no INSERT, UPDATE or DELETE policy for any client role:
-- a log a client can rewrite is not an audit trail.
drop policy if exists audit_logs_tbdots_read on public.audit_logs;
create policy audit_logs_tbdots_read on public.audit_logs
  for select to authenticated
  using (
    public.current_user_active_role() = 'tb_dots'
    and facility_id = public.current_user_facility()
  );

-- Admin-wide read is acceptable BECAUSE of the whitelist: an admin sees who
-- changed a status and when, never clinical free text or contact data. If the
-- whitelist is ever widened, this policy must be revisited in the same
-- migration (Task 1.2 §9, gate decision 4).
drop policy if exists audit_logs_admin_read on public.audit_logs;
create policy audit_logs_admin_read on public.audit_logs
  for select to authenticated
  using (public.current_user_active_role() = 'admin');

comment on table public.audit_logs is
  'Server-written change history for the case triad (0031). Rows come only '
  'from SECURITY DEFINER RPCs and triggers; no client role holds INSERT, '
  'UPDATE or DELETE. `changes` is whitelisted per table by '
  'enforce_audit_changes_whitelist() and never carries clinical free text.';

-- The one writer. SECURITY DEFINER so it can insert past RLS; auth.uid() and
-- current_user_active_role() still read the CALLER's JWT, so the actor
-- snapshot is the caller's, not the definer's.
create or replace function app_private.write_audit(
  p_entity_table text,
  p_entity_id    uuid,
  p_action       text,
  p_patient_id   uuid,
  p_facility_id  uuid,
  p_changes      jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.audit_logs
    (entity_table, entity_id, action, actor_user_id, actor_role,
     patient_id, facility_id, changes)
  values
    (p_entity_table, p_entity_id, p_action,
     auth.uid(), public.current_user_active_role(),
     p_patient_id, p_facility_id, coalesce(p_changes, '{}'::jsonb));
end;
$fn$;

revoke all on function app_private.write_audit(text, uuid, text, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;


-- ===========================================================================
-- 4. rpc_requests — idempotency that is bound to something.
--
-- ARCH-07: a caller-supplied key with no operation namespace, no actor binding
-- and no payload binding can return another operation's result or suppress a
-- legitimate one. All three bindings are checked on every hit, and a mismatch
-- raises the SAME uniform 42501 as any other authorization failure — it never
-- reveals which check failed and never returns the stored result.
--
-- Retention is bounded at 7 days (§7.3). A retry window is minutes; after the
-- purge a replayed key simply creates a new record, which is correct for a key
-- that is no longer meaningful.
-- ===========================================================================
create table if not exists public.rpc_requests (
  operation           text not null
                        check (operation in ('create_tb_case','register_walkin','record_visit')),
  request_id          uuid not null,
  actor_user_id       uuid not null references public.users(user_id),
  facility_id         uuid not null references public.facilities(facility_id),
  payload_fingerprint text not null,
  result_kind         text not null
                        check (result_kind in ('tb_case','patient','treatment_followup')),
  result_id           uuid not null,
  created_at          timestamptz not null default now(),
  primary key (operation, request_id)
);

create index if not exists rpc_requests_created_idx on public.rpc_requests (created_at);

alter table public.rpc_requests enable row level security;
revoke all on public.rpc_requests from anon;
revoke all on public.rpc_requests from authenticated;

comment on table public.rpc_requests is
  'Idempotency ledger for write RPCs (0031). The key is namespaced by '
  'operation and bound to actor, facility and a payload fingerprint; any '
  'mismatch raises 42501 rather than returning the stored result. RLS is on '
  'with no policy — no client reads or writes this table. Purged after 7 days.';

create or replace function public.purge_expired_rpc_requests()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare n integer;
begin
  delete from public.rpc_requests where created_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end;
$fn$;

revoke all on function public.purge_expired_rpc_requests()
  from public, anon, authenticated, service_role;

comment on function public.purge_expired_rpc_requests() is
  'Deletes rpc_requests older than 7 days (0031). Scheduled by pg_cron; not '
  'callable by any client role.';

-- pg_cron arrived with 0003. If it is somehow absent, say so loudly rather
-- than shipping an unbounded ledger and calling it bounded.
do $cron$
begin
  if to_regnamespace('cron') is null then
    raise exception '0031: pg_cron is not installed; rpc_requests would grow without bound'
      using hint = 'Migration 0003 creates the extension. Apply it first.';
  end if;

  perform cron.unschedule('rpc-requests-purge')
   where exists (select 1 from cron.job where jobname = 'rpc-requests-purge');

  perform cron.schedule(
    'rpc-requests-purge',
    '15 2 * * *',                       -- 02:15 UTC = 10:15 Asia/Manila
    'select public.purge_expired_rpc_requests();'
  );
end;
$cron$;


-- ===========================================================================
-- 5. tb_cases — one treatment episode at one owning facility.
--
-- facility_id is the AUTHORIZATION KEY. Every policy on this table compares it
-- to current_user_facility() directly: no referred_patient_ids() indirection,
-- no patient-wide scope. That is the structural answer to BASE-02 for case
-- data.
--
-- referral_id is PROVENANCE ONLY. It is validated once, at creation, and
-- pinned immutable thereafter. It participates in no lifetime constraint on
-- facility_id — that was ARCH-01, and the composite FK to referrals is
-- withdrawn. The referral cannot be re-routed out from under the case; a
-- trigger on `referrals` handles that (§6), which constrains the referral
-- rather than the case and leaves facility_id free to move.
-- ===========================================================================
create table if not exists public.tb_cases (
  case_id              uuid primary key default gen_random_uuid(),
  patient_id           uuid not null references public.patients(patient_id)   on delete restrict,
  referral_id          uuid          references public.referrals(referral_id) on delete restrict,
  facility_id          uuid not null references public.facilities(facility_id) on delete restrict,
  case_number          text not null unique,
  registration_date    date not null default public.manila_today(),
  case_status          text not null default 'registered'
                         check (case_status in ('registered','on_treatment',
                                                'interrupted','closed','cancelled')),
  treatment_start_date date,
  -- The six patient-level treatment outcomes of the Philippine DOH NTP Manual
  -- of Procedures, 6th Edition, consistent with WHO's 2013 reporting
  -- framework. `treatment_success` is an AGGREGATE of cured +
  -- treatment_completed, not a seventh patient-level outcome, so it is
  -- deliberately absent here.
  outcome              text
                         check (outcome is null or outcome in
                                ('cured','treatment_completed','treatment_failed',
                                 'died','lost_to_follow_up','not_evaluated')),
  outcome_date         date,
  created_by           uuid not null references public.users(user_id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- The invariants are SYMMETRIC over the whole lifecycle, so no state can
  -- hold the wrong shape regardless of which path reached it (R2-04). Stating
  -- only the on_treatment half let a date-correcting RPC clear the start date
  -- out of an interrupted or closed case without violating anything.
  constraint tb_cases_start_date_states check (
    (case_status in ('on_treatment','interrupted','closed') and treatment_start_date is not null)
    or
    (case_status in ('registered','cancelled') and treatment_start_date is null)
  ),
  constraint tb_cases_closed_has_outcome check (
    (case_status = 'closed') = (outcome is not null)
  ),
  constraint tb_cases_outcome_has_date check (
    (outcome is not null) = (outcome_date is not null)
  ),
  constraint tb_cases_start_after_registration check (
    treatment_start_date is null or treatment_start_date >= registration_date
  ),
  constraint tb_cases_outcome_after_start check (
    outcome_date is null
    or outcome_date >= coalesce(treatment_start_date, registration_date)
  )
);

-- A DUPLICATE is a second NON-TERMINAL case for the same patient, REGARDLESS
-- OF FACILITY. A patient is on TB treatment in one place at a time; two
-- facilities each holding an open episode for one person is a data error, not
-- a workflow. Terminal rows are excluded, so treatment history accumulates
-- without limit and a relapse is simply a new case.
--
-- This is global, so a patient who moves blocks the receiving facility until
-- the case is transferred. transfer_tb_case() (§10) is therefore the
-- operational remedy for this index and SHIPS IN THE SAME MIGRATION. Shipping
-- the constraint without the remedy would be a dead end.
create unique index if not exists tb_cases_one_active_per_patient
  on public.tb_cases (patient_id)
  where case_status in ('registered','on_treatment','interrupted');

create index if not exists tb_cases_facility_idx on public.tb_cases (facility_id, case_status);
create index if not exists tb_cases_patient_idx  on public.tb_cases (patient_id);
create index if not exists tb_cases_referral_idx on public.tb_cases (referral_id);

-- The composite target that makes appointment ownership cascade on transfer.
--
-- M31-02: `patient_id` is part of the key. A (case_id, facility_id) key only
-- says "this appointment's facility matches this case's facility", which two
-- DIFFERENT patients at one facility both satisfy — so PostgreSQL accepted an
-- appointment for patient A citing patient B's case, and record_visit() would
-- then mark the wrong patient's appointment attended. A foreign key has to
-- carry every column whose agreement its name is claiming.
--
-- Cascading on this key is still safe: `patient_id` is pinned immutable on both
-- parents, so the only column a cascade ever moves is `facility_id`.
alter table public.tb_cases drop constraint if exists tb_cases_identity_uniq;
alter table public.tb_cases add constraint tb_cases_identity_uniq
  unique (case_id, patient_id, facility_id);

drop trigger if exists tb_cases_set_updated_at on public.tb_cases;
create trigger tb_cases_set_updated_at
  before update on public.tb_cases
  for each row execute function public.set_updated_at();

-- facility_id is deliberately NOT pinned — it is the transfer target. It is
-- protected instead by having no client write path at all (§8).
drop trigger if exists tb_cases_immutable_columns on public.tb_cases;
create trigger tb_cases_immutable_columns
  before update on public.tb_cases
  for each row execute function public.enforce_immutable_columns(
    'case_id', 'patient_id', 'referral_id', 'case_number',
    'created_by', 'registration_date'
  );

comment on table public.tb_cases is
  'One TB treatment episode at one owning facility (0031). Created by hand by '
  'facility staff recording a clinician''s enrolment decision — never inferred '
  'from a result, never scored. facility_id is the authorization key; '
  'referral_id is provenance only. Writes are RPC-only.';

-- ---------------------------------------------------------------------------
-- 5.1 The single transition authority.
--
-- set_tb_case_status() and the BEFORE UPDATE trigger read THE SAME function,
-- so there is exactly one place that knows which moves are legal and the
-- trigger cannot drift from the RPC. The trigger stays as defence in depth
-- against a direct database session.
--
--     registered   -> on_treatment | cancelled
--     on_treatment -> interrupted  | closed
--     interrupted  -> on_treatment | closed
--     closed       -> (none)
--     cancelled    -> (none)
--
-- A closed case NEVER reopens. A relapse or retreatment is a new case for the
-- same patient, which is why patient_id is not unique on this table.
-- ---------------------------------------------------------------------------
create or replace function public.tb_case_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $fn$
  select (p_from, p_to) in (
    ('registered',   'on_treatment'),
    ('registered',   'cancelled'),
    ('on_treatment', 'interrupted'),
    ('on_treatment', 'closed'),
    ('interrupted',  'on_treatment'),
    ('interrupted',  'closed')
  );
$fn$;

comment on function public.tb_case_transition_allowed(text, text) is
  'The one transition table for tb_cases.case_status (0031). Read by both '
  'set_tb_case_status() and enforce_tb_case_transition() so the RPC and the '
  'trigger cannot disagree.';

create or replace function public.enforce_tb_case_transition()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.case_status is not distinct from old.case_status then
    return new;
  end if;

  if not public.tb_case_transition_allowed(old.case_status, new.case_status) then
    raise exception 'tb_cases: % is not a permitted transition from %',
      new.case_status, old.case_status
      using errcode = '42501',
            hint = 'A closed case never reopens; record a new case instead.';
  end if;

  return new;
end;
$fn$;

drop trigger if exists tb_cases_transition on public.tb_cases;
create trigger tb_cases_transition
  before update on public.tb_cases
  for each row execute function public.enforce_tb_case_transition();

-- ---------------------------------------------------------------------------
-- 5.2 Table access. SELECT only, for one role.
--
-- There is no INSERT, UPDATE or DELETE policy on this table for ANY client
-- role, and the grants match (ARCH-03). Granting table UPDATE while claiming
-- RPC-only transitions is a contradiction: a client could PATCH case_status
-- straight through PostgREST, skipping the audit write and the appointment
-- cancellation even if the transition trigger allowed the edge.
--
-- No DELETE for anyone: a mistake becomes `cancelled`, which preserves the
-- trail. Child FKs are ON DELETE RESTRICT so even a direct session cannot
-- orphan children silently.
-- ---------------------------------------------------------------------------
alter table public.tb_cases enable row level security;
revoke all on public.tb_cases from anon;
revoke all on public.tb_cases from authenticated;
grant  select on public.tb_cases to authenticated;

drop policy if exists tb_cases_tbdots_read on public.tb_cases;
create policy tb_cases_tbdots_read on public.tb_cases
  for select to authenticated
  using (
    public.current_user_active_role() = 'tb_dots'
    and facility_id = public.current_user_facility()
  );


-- ===========================================================================
-- 6. referrals — provenance that cannot be re-routed out from under a case.
--
-- referrals.facility_id stays mutable (0020's header explains why: a BHW
-- re-routing a still-`submitted` referral is a real workflow). This trigger is
-- narrower than the withdrawn composite FK — it constrains the REFERRAL, not
-- the case — so tb_cases.facility_id remains free to move under a transfer.
-- ===========================================================================
-- M31-02: patient-aware, for the reason given on tb_cases_identity_uniq.
-- referrals.patient_id is already pinned immutable by the 0020 trigger, so a
-- cascade from this key still only ever moves facility_id.
alter table public.referrals drop constraint if exists referrals_identity_uniq;
alter table public.referrals add constraint referrals_identity_uniq
  unique (referral_id, patient_id, facility_id);

create or replace function public.enforce_referral_not_cited_by_case()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.facility_id is not distinct from old.facility_id then
    return new;
  end if;

  if exists (select 1 from public.tb_cases c where c.referral_id = new.referral_id) then
    raise exception
      'referral %: cannot be re-routed because a TB case cites it as its origin',
      new.referral_id
      using errcode = '42501',
            hint = 'Transfer the case instead; the referral records where the '
                   'patient was originally sent and that stays true.';
  end if;

  return new;
end;
$fn$;

drop trigger if exists referrals_not_cited_by_case on public.referrals;
create trigger referrals_not_cited_by_case
  before update on public.referrals
  for each row execute function public.enforce_referral_not_cited_by_case();


-- ===========================================================================
-- 7. appointments gain ownership — BASE-02.
--
-- THREE columns, not one. Most appointments in this system are not treatment
-- follow-ups: the BHW's initial "go get tested" visit and every pre-case
-- check-up have no case and never will. If ownership rode only on tb_case_id,
-- every one of those rows would stay patient-wide and BASE-02 would remain
-- open for the majority of the table.
--
--   facility_id — WHO OWNS THIS ROW. Every appointment, always. The key.
--   referral_id — WHICH REQUEST this visit serves, for pre-case appointments.
--   tb_case_id  — WHICH EPISODE, for the subset inside a case.
-- ===========================================================================

-- 7.1 `cancelled` joins the status vocabulary.
--
-- Found by name rather than assumed: these migrations are hand-applied, and a
-- surviving old CHECK under a different name would reject every cancellation
-- while this one looked correct.
do $status$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public'
       and rel.relname = 'appointments'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%status%'
  loop
    execute format('alter table public.appointments drop constraint %I', c.conname);
    raise notice '0031: dropped appointments status CHECK %', c.conname;
  end loop;
end;
$status$;

alter table public.appointments
  add constraint appointments_status_check
  check (status in ('scheduled','attended','missed','cancelled'));

-- 7.2 The ownership columns.
alter table public.appointments
  add column if not exists facility_id uuid references public.facilities(facility_id),
  add column if not exists referral_id uuid references public.referrals(referral_id) on delete restrict,
  add column if not exists tb_case_id  uuid references public.tb_cases(case_id)      on delete restrict;

create index if not exists appointments_facility_date_idx on public.appointments (facility_id, scheduled_date);
create index if not exists appointments_case_idx          on public.appointments (tb_case_id);
create index if not exists appointments_referral_idx      on public.appointments (referral_id);

-- 7.3 The backfill, BEFORE the constraints and BEFORE the ownership trigger.
--
-- The unambiguous set is computed inline here rather than by calling the
-- policy helper: the helper answers a question about the CALLER, and a
-- migration has no caller. A patient whose referrals all name one facility has
-- exactly one possible owner for their appointments.
--
-- A patient referred to two or more facilities is left NULL and is visible to
-- NOBODY — not to either facility, and not to an admin (§3.2 withdrew the
-- admin queue; it would have handed patient referral history to a role
-- deliberately denied clinical rows). Those are resolved by support from a
-- direct session, which D2's trigger exemption keeps possible.
--
-- `(array_agg(distinct facility_id))[1]`, not the design's `min(facility_id)`:
-- PostgreSQL has no min() for uuid. The HAVING clause already guarantees the
-- group holds exactly one distinct value, so which one is picked is not a
-- choice — there is only one.
do $backfill$
declare n_before bigint; n_after bigint;
begin
  select count(*) into n_before from public.appointments where facility_id is null;

  update public.appointments a
     set facility_id = sole.facility_id
    from (select patient_id, (array_agg(distinct facility_id))[1] as facility_id
            from public.referrals
           group by patient_id
          having count(distinct facility_id) = 1) sole
   where a.patient_id = sole.patient_id
     and a.facility_id is null;

  select count(*) into n_after from public.appointments where facility_id is null;

  raise notice '0031: appointment ownership backfill — % unowned before, % after',
    n_before, n_after;

  if n_after > 0 then
    raise notice
      '0031: % appointment(s) remain unowned (patient referred to 2+ facilities, '
      'or never referred). They are visible to no client role until support '
      'resolves them from a direct session. See Task 1.3 §3.2.', n_after;
  end if;
end;
$backfill$;

-- 7.4 Declarative agreement between a link and the facility.
--
-- MATCH SIMPLE skips each check when either column is NULL, which is exactly
-- what legacy and pre-case rows need.
--
-- ON UPDATE CASCADE is deliberate in BOTH places and is the answer to ARCH-01:
--   * case FK — transfer_tb_case() does one `update tb_cases set facility_id`
--     and every linked appointment follows in the same statement. An immediate
--     FK made the transfer unexecutable in either order.
--   * referral FK — a BHW re-routing a still-submitted referral SHOULD move
--     that referral's initial appointment with it. The patient is going
--     somewhere else.
-- M31-02: each FK names `patient_id` as well. Without it the constraint
-- enforces only half of what its name claims — an appointment for patient A
-- could cite patient B's referral or case as long as the facility matched,
-- which corrupts the care timeline and lets an authorized RPC act on the wrong
-- patient's row. `patient_id` is NOT NULL on appointments, so MATCH SIMPLE
-- still skips each check exactly when its own link or facility is NULL, which
-- is what legacy and pre-case rows need.
alter table public.appointments drop constraint if exists appointments_referral_facility_agrees;
alter table public.appointments
  add constraint appointments_referral_facility_agrees
  foreign key (referral_id, patient_id, facility_id)
  references public.referrals (referral_id, patient_id, facility_id)
  on update cascade on delete restrict;

alter table public.appointments drop constraint if exists appointments_case_facility_agrees;
alter table public.appointments
  add constraint appointments_case_facility_agrees
  foreign key (tb_case_id, patient_id, facility_id)
  references public.tb_cases (case_id, patient_id, facility_id)
  on update cascade on delete restrict;

-- Link exclusivity (R2-02). An appointment holding BOTH links would share one
-- facility_id between two live parents: transferring the case cascades that
-- column to the destination while the unchanged referral FK still demands the
-- origin, and the statement fails. So an appointment is owned by a referral
-- (pre-case) OR by a case, never both. Nothing is lost — tb_cases.referral_id
-- already holds the episode's provenance.
alter table public.appointments drop constraint if exists appointments_one_owner;
alter table public.appointments
  add constraint appointments_one_owner
  check (num_nonnulls(referral_id, tb_case_id) <= 1);

-- The composite target treatment_followups needs, so naming an appointment
-- forces that appointment's tb_case_id to match the follow-up's case.
alter table public.appointments drop constraint if exists appointments_case_link_uniq;
alter table public.appointments add constraint appointments_case_link_uniq unique (appointment_id, tb_case_id);

comment on column public.appointments.facility_id is
  'Owning facility — the authorization key for this row (0031, BASE-02). NULL '
  'only on legacy rows and on inserts from mobile builds older than the '
  'ownership release; see Task 1.3 §3.4 for how that window closes.';
comment on column public.appointments.referral_id is
  'The referral this pre-case visit serves (0031). Mutually exclusive with '
  'tb_case_id.';
comment on column public.appointments.tb_case_id is
  'The treatment episode this visit belongs to (0031). Set only by '
  'assign_appointment_to_case() or record_visit(); no client writes it.';

-- 7.5 The ownership trigger.
--
-- Revision 3 wrote this with an auth.role() exemption and claimed it "keeps FK
-- cascades working". That was WRONG and would have broken referral re-routing
-- outright (R3-01): a BHW re-routing a referral issues an ordinary
-- authenticated UPDATE, the cascade fires inside that statement, and
-- auth.role() is still `authenticated` with no GUC set.
--
-- The mistake was authorizing by WHO APPEARS TO BE CALLING instead of by WHAT
-- THE ROW ENDS UP SAYING. A cascade is legitimate precisely because the result
-- still matches the parent, so that is what this checks.
--
-- D2: the direct-session and service_role exemptions are added here, matching
-- 0020. Task 1.3 §3.2 makes a direct session the remedy for ambiguous legacy
-- rows; without the exemption that remedy does not exist.
create or replace function public.enforce_appointment_ownership()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  jwt_role text := auth.role();
  v_parent uuid;
begin
  -- D2 — a direct database session (SQL editor, psql, this migration) and the
  -- Edge Functions' service_role. Anyone with a direct session is past every
  -- other boundary already, and §3.2's support remedy needs this door.
  if jwt_role is null or jwt_role = '' or jwt_role = 'service_role' then
    return new;
  end if;

  if new.facility_id is not distinct from old.facility_id
     and new.referral_id is not distinct from old.referral_id
     and new.tb_case_id  is not distinct from old.tb_case_id
  then
    return new;                              -- nothing moved: identical re-send
  end if;

  -- An authorized RPC (link swap, legacy claim, transfer) says so explicitly.
  -- SET LOCAL is transaction-scoped and PostgREST gives a client no way to set
  -- an arbitrary GUC, so this flag is reachable only from inside those
  -- functions.
  if coalesce(current_setting('tbscreen.ownership_change', true), '') = 'on' then
    return new;
  end if;

  -- Otherwise the ONLY permitted change is facility_id following the parent
  -- this row is already linked to, with the link itself unchanged. That is
  -- exactly the shape an ON UPDATE CASCADE produces, and nothing else.
  if new.referral_id is not distinct from old.referral_id
     and new.tb_case_id is not distinct from old.tb_case_id
  then
    if new.referral_id is not null then
      select r.facility_id into v_parent
        from public.referrals r where r.referral_id = new.referral_id;
      if new.facility_id = v_parent then return new; end if;
    elsif new.tb_case_id is not null then
      select c.facility_id into v_parent
        from public.tb_cases c where c.case_id = new.tb_case_id;
      if new.facility_id = v_parent then return new; end if;
    end if;
  end if;

  -- Falls through for: a PATCH of facility_id to an arbitrary value; a PATCH
  -- to NULL (the patient-wide revival — `new.facility_id = v_parent` is NULL,
  -- never true); an unlinked legacy row claiming itself; and any link swap
  -- outside an RPC.
  raise exception 'appointment ownership is not client-writable'
    using errcode = '42501',
          hint = 'Use claim_unassigned_appointment(), assign_appointment_to_case() '
                 'or transfer_tb_case().';
end;
$fn$;

-- 42501 is chosen so PostgREST returns 403 and mobile's syncErrors.ts
-- classifies it PERMANENT: the row is reported rather than aborting the pass.
drop trigger if exists appointments_ownership on public.appointments;
create trigger appointments_ownership
  before update on public.appointments
  for each row execute function public.enforce_appointment_ownership();

-- 7.6 Nothing is scheduled against a terminal case.
--
-- Narrower than "reject every write touching a terminal case": correcting an
-- attendance mistake after the case closed is legitimate, and so is the
-- cancellation sweep. What is rejected is CREATING or RE-CREATING a future
-- visit for an episode that has ended, and linking a row to one.
create or replace function public.enforce_appointment_case_open()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare v_status text;
begin
  if new.tb_case_id is null then
    return new;
  end if;

  select c.case_status into v_status
    from public.tb_cases c where c.case_id = new.tb_case_id;

  if v_status not in ('closed','cancelled') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'appointments: case % is % and cannot be scheduled against',
      new.tb_case_id, v_status
      using errcode = '42501';
  end if;

  if new.tb_case_id is distinct from old.tb_case_id then
    raise exception 'appointments: case % is % and cannot take new appointments',
      new.tb_case_id, v_status
      using errcode = '42501';
  end if;

  if new.status = 'scheduled'
     and (new.scheduled_date is distinct from old.scheduled_date
          or old.status is distinct from 'scheduled') then
    raise exception 'appointments: case % is % and cannot be re-scheduled',
      new.tb_case_id, v_status
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

drop trigger if exists appointments_case_open on public.appointments;
create trigger appointments_case_open
  before insert or update on public.appointments
  for each row execute function public.enforce_appointment_case_open();

-- 7.7 Write privileges — 0017's table-revoke-then-column-grant pattern.
--
-- A column REVOKE does not subtract from a table-level UPDATE grant, which is
-- what `authenticated` actually holds; the revision that wrote one would have
-- run cleanly and changed nothing (R2-01).
--
-- The grant covers exactly what a legitimate client sends: the mobile
-- whole-row upsert payload plus the columns the portal edits. tb_case_id is
-- omitted — no client ever writes it. patient_id is present only because the
-- whole-row upsert sends it; the 0020 trigger already rejects any real change.
--
-- Being honest about this: for THIS table the privilege layer is nearly a
-- no-op, because facility_id and referral_id must stay writable for the mobile
-- retry path. The real boundary is enforce_appointment_ownership() above.
revoke update on public.appointments from authenticated;
revoke update on public.appointments from anon;
grant  update (scheduled_date, attended_date, status,
               facility_id, referral_id, patient_id, updated_at)
  on public.appointments to authenticated;

-- 7.8 The legacy-row authority.
--
-- Revision 2 exposed this as sole_referral_facility(p_patient_id) returns
-- uuid. A SECURITY DEFINER helper taking an arbitrary patient UUID and
-- returning that patient's facility is a callable disclosure surface — it has
-- to be executable for policy evaluation, which makes it reachable as an RPC.
-- Withdrawn (R2-06).
--
-- This answers only the question the policy actually asks, about the caller's
-- OWN facility, and never returns an identifier. It is true only when EVERY
-- referral for that patient names the caller's facility — a fact about the
-- data, not a guess about intent — so no row is ever visible to two
-- facilities and the claim race cannot occur.
create or replace function public.caller_owns_unassigned_appointment(p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.current_user_active_role() = 'tb_dots'
     and public.current_user_facility() is not null
     and public.current_user_facility() = (
           select r.facility_id from public.referrals r
            where r.patient_id = p_patient_id
            group by r.facility_id
           having count(*) = (select count(*) from public.referrals
                               where patient_id = p_patient_id));
$fn$;

revoke all on function public.caller_owns_unassigned_appointment(uuid) from public;
revoke all on function public.caller_owns_unassigned_appointment(uuid) from anon;
revoke all on function public.caller_owns_unassigned_appointment(uuid) from service_role;
grant  execute on function public.caller_owns_unassigned_appointment(uuid) to authenticated;

comment on function public.caller_owns_unassigned_appointment(uuid) is
  'True when every referral for this patient names the CALLER''s own facility, '
  'so an unowned legacy appointment has exactly one possible owner (0031). '
  'Returns a boolean about the caller, never an identifier. False for '
  'anonymous, unprovisioned, deactivated and non-TB-DOTS callers.';

-- 7.9 Policies.
--
-- Every one uses current_user_active_role() from its first version (R3-04).
-- Revision 3 made only the legacy helper active-aware and left the owned-row
-- branch on the old one, which would have reproduced BASE-06 inside a policy
-- this design was newly writing.
drop policy if exists appointments_tbdots_read on public.appointments;
create policy appointments_tbdots_read on public.appointments
  for select to authenticated
  using (
    public.current_user_active_role() = 'tb_dots'
    and (
      facility_id = public.current_user_facility()
      or (facility_id is null
          and public.caller_owns_unassigned_appointment(patient_id))
    )
  );

drop policy if exists appointments_tbdots_update on public.appointments;
create policy appointments_tbdots_update on public.appointments
  for update to authenticated
  using (
    public.current_user_active_role() = 'tb_dots'
    and (
      facility_id = public.current_user_facility()
      or (facility_id is null
          and public.caller_owns_unassigned_appointment(patient_id))
    )
  );

-- M31-03: naming your own facility is NOT an admission.
--
-- Before 0031 this policy required `patient_id in referred_patient_ids()`.
-- Replacing that with `facility_id = current_user_facility()` let a facility
-- schedule ANY patient uuid it could name, simply by writing its own id into
-- the row — a widening, inside the migration whose entire purpose is to narrow
-- appointment access. The live probe confirmed it: DOTS A could insert an
-- unlinked appointment for a patient referred only to DOTS B.
--
-- So each of the three legal shapes proves the patient belongs here:
--   * referral-linked — the referral names this patient AND this facility;
--   * case-linked     — the case does, and is still open;
--   * unlinked        — 0011's original admission boundary, unchanged.
drop policy if exists appointments_tbdots_insert on public.appointments;
create policy appointments_tbdots_insert on public.appointments
  for insert to authenticated
  with check (
    public.current_user_active_role() = 'tb_dots'
    and facility_id = public.current_user_facility()
    and (
      (
        referral_id is not null
        and tb_case_id is null
        and exists (
          select 1 from public.referrals r
           where r.referral_id = appointments.referral_id
             and r.patient_id  = appointments.patient_id
             and r.facility_id = public.current_user_facility()
        )
      )
      or (
        tb_case_id is not null
        and referral_id is null
        and exists (
          select 1 from public.tb_cases c
           where c.case_id     = appointments.tb_case_id
             and c.patient_id  = appointments.patient_id
             and c.facility_id = public.current_user_facility()
             and c.case_status not in ('closed','cancelled')
        )
      )
      or (
        referral_id is null
        and tb_case_id is null
        and patient_id in (select app_private.referred_patient_ids())
      )
    )
  );

-- BHW visibility stays barangay-scoped and does NOT depend on facility_id
-- (§3.2): the BHW who created an ambiguous row is unaffected by it being
-- unowned. These two are transcribed from 0029 unchanged.
drop policy if exists appointments_bhw_read on public.appointments;
create policy appointments_bhw_read on public.appointments
  for select to authenticated
  using (
    public.current_user_active_role() = 'bhw'
    and patient_id in (select app_private.bhw_visible_patient_ids())
  );

drop policy if exists appointments_bhw_update on public.appointments;
create policy appointments_bhw_update on public.appointments
  for update to authenticated
  using (
    public.current_user_active_role() = 'bhw'
    and patient_id in (select app_private.bhw_visible_patient_ids())
  );

-- A BHW supplies ownership only FROM A REFERRAL THEY CREATED, never freely.
--
-- The legacy arm — both columns NULL — is required, not an oversight: mobile
-- builds older than the ownership release send neither column, and Task 1.3
-- §3.4 closes that window in a LATER migration, once the minimum supported
-- build is enforced. Rejecting them here would strand every queued offline
-- write on every phone that has not updated.
drop policy if exists appointments_bhw_insert on public.appointments;
create policy appointments_bhw_insert on public.appointments
  for insert to authenticated
  with check (
    public.current_user_active_role() = 'bhw'
    and patient_id in (select app_private.bhw_visible_patient_ids())
    and tb_case_id is null
    and (
      (referral_id is null and facility_id is null)
      or (
        referral_id is not null
        and facility_id is not null
        and exists (
          select 1 from public.referrals r
           where r.referral_id = appointments.referral_id
             and r.patient_id  = appointments.patient_id
             and r.facility_id = appointments.facility_id
        )
      )
    )
  );


-- ===========================================================================
-- 8. treatment_followups — what happened clinically at one visit.
--
-- No scheduled_date, no attendance flag, no status of its own. If a reviewer
-- finds a date here that could drive a reminder, the design has been violated
-- (Task 1.3 §1, §7). weight_kg is omitted (§4.5, gate item 4).
-- ===========================================================================
create table if not exists public.treatment_followups (
  followup_id    uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.tb_cases(case_id) on delete restrict,
  appointment_id uuid references public.appointments(appointment_id) on delete restrict,
  visit_date     date not null default public.manila_today(),
  notes          text,
  recorded_by    uuid not null references public.users(user_id),
  voided_at      timestamptz,
  voided_by      uuid references public.users(user_id),
  void_reason    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint treatment_followups_void_triple check (
    (voided_at is null and voided_by is null and void_reason is null)
    or
    (voided_at is not null and voided_by is not null and void_reason is not null)
  ),

  -- Naming an appointment forces that appointment's tb_case_id to be non-NULL
  -- and equal to this case, because case_id is NOT NULL here. A follow-up can
  -- never attach to an unassigned or foreign appointment.
  constraint followups_appointment_agrees
    foreign key (appointment_id, case_id)
    references public.appointments (appointment_id, tb_case_id)
);

-- One appointment permits at most one LIVE follow-up. A plain UNIQUE was a
-- trap (R2-07): a voided follow-up keeps its appointment_id, so the constraint
-- would have blocked the corrected replacement and left staff stuck without
-- direct database access. A voided record simply stops occupying the slot.
create unique index if not exists treatment_followups_one_live_per_appointment
  on public.treatment_followups (appointment_id)
  where appointment_id is not null and voided_at is null;

create index if not exists treatment_followups_case_idx
  on public.treatment_followups (case_id, visit_date desc);

drop trigger if exists treatment_followups_set_updated_at on public.treatment_followups;
create trigger treatment_followups_set_updated_at
  before update on public.treatment_followups
  for each row execute function public.set_updated_at();

drop trigger if exists treatment_followups_immutable_columns on public.treatment_followups;
create trigger treatment_followups_immutable_columns
  before update on public.treatment_followups
  for each row execute function public.enforce_immutable_columns(
    'followup_id', 'case_id', 'appointment_id', 'recorded_by'
  );

-- 8.1 Temporal rules (ARCH-08). Cross-row, so a trigger rather than a CHECK.
--
-- Leaving visit_date unconstrained made an impossible visit structurally valid
-- and would have fed it to timeline and "no recent follow-up" logic.
create or replace function public.enforce_followup_temporal_bounds()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  c record;
  a record;
begin
  select case_status, registration_date, outcome_date
    into c
    from public.tb_cases where case_id = new.case_id;

  if tg_op = 'INSERT' and c.case_status in ('closed','cancelled') then
    raise exception 'treatment_followups: case % is % and takes no new visits',
      new.case_id, c.case_status
      using errcode = '42501',
            hint = 'Amending or voiding an existing follow-up stays allowed.';
  end if;

  if new.visit_date < c.registration_date then
    raise exception 'treatment_followups: visit date % precedes case registration %',
      new.visit_date, c.registration_date
      using errcode = '22007';
  end if;

  if new.visit_date > public.manila_today() then
    raise exception 'treatment_followups: visit date % is in the future', new.visit_date
      using errcode = '22007';
  end if;

  if c.outcome_date is not null and new.visit_date > c.outcome_date then
    raise exception 'treatment_followups: visit date % follows the case outcome date %',
      new.visit_date, c.outcome_date
      using errcode = '22007';
  end if;

  if new.appointment_id is not null then
    select status, attended_date into a
      from public.appointments where appointment_id = new.appointment_id;

    if a.status is distinct from 'attended' then
      raise exception 'treatment_followups: appointment % is %, not attended',
        new.appointment_id, coalesce(a.status, 'missing')
        using errcode = '22023';
    end if;

    if a.attended_date is distinct from new.visit_date then
      raise exception
        'treatment_followups: visit date % disagrees with attendance date %',
        new.visit_date, a.attended_date
        using errcode = '22007',
              hint = 'Use correct_followup_visit_date(), which moves both rows.';
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists treatment_followups_temporal on public.treatment_followups;
create trigger treatment_followups_temporal
  before insert or update on public.treatment_followups
  for each row execute function public.enforce_followup_temporal_bounds();

-- 8.2 The case-id helper, in the non-exposed schema (R3-05).
--
-- Revision 3 put an enumerating own_facility_case_ids() in `public` gated on
-- current_user_facility() alone, so any account attached to a DOTS facility —
-- including an admin — could call it directly and receive case identifiers the
-- table policy would never have given them. That is the same defect already
-- corrected for the sole-facility helper under R2-06, reintroduced one section
-- later.
--
-- app_private is not in PostgREST's exposed schema list, so this is usable in
-- a policy expression — which evaluates as the querying user and therefore
-- needs EXECUTE — but is not reachable as an RPC.
create or replace function app_private.own_facility_case_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select c.case_id from public.tb_cases c
   where public.current_user_active_role() = 'tb_dots'
     and c.facility_id = public.current_user_facility();
$fn$;

revoke all on function app_private.own_facility_case_ids() from public;
revoke all on function app_private.own_facility_case_ids() from anon;
revoke all on function app_private.own_facility_case_ids() from service_role;
grant  execute on function app_private.own_facility_case_ids() to authenticated;

-- 8.3 RLS and write privileges.
--
-- R3-02: revision 3 wrote `revoke update (voided_at, voided_by, void_reason)`
-- — the same ineffective construct R2-01 had already established does not
-- subtract from a table-level grant. As written, a facility client could have
-- voided and un-voided records directly, forged voided_by, and bypassed the
-- RPC's reason and audit entirely.
--
-- visit_date is NOT in the grant: it must move together with
-- appointments.attended_date, which only correct_followup_visit_date() does.
alter table public.treatment_followups enable row level security;
revoke all on public.treatment_followups from anon;
revoke all on public.treatment_followups from authenticated;
grant  select on public.treatment_followups to authenticated;
grant  update (notes, updated_at) on public.treatment_followups to authenticated;

-- No other role gets any policy. A follow-up note is the most sensitive row
-- this design adds; BHWs, midwives and admins have no need of it, and
-- bhw_case_summary() exposes no follow-up data at all.
drop policy if exists treatment_followups_tbdots_read on public.treatment_followups;
create policy treatment_followups_tbdots_read on public.treatment_followups
  for select to authenticated
  using (
    public.current_user_active_role() = 'tb_dots'
    and case_id in (select app_private.own_facility_case_ids())
  );

drop policy if exists treatment_followups_tbdots_update on public.treatment_followups;
create policy treatment_followups_tbdots_update on public.treatment_followups
  for update to authenticated
  using (
    public.current_user_active_role() = 'tb_dots'
    and case_id in (select app_private.own_facility_case_ids())
  );

comment on table public.treatment_followups is
  'One recorded visit inside one TB case (0031). Holds no schedule, no '
  'attendance state and no status — appointments remains the only scheduler. '
  'INSERT is RPC-only; notes is the only ordinary client-editable column.';
comment on column public.treatment_followups.notes is
  'Free clinical text, facility-only. Never enters an SMS, a report, an audit '
  'payload, or the mobile device.';


-- ===========================================================================
-- 9. Shared internals for the write RPCs.
-- ===========================================================================

-- The uniform failure. Every authorization failure in every RPC below raises
-- THIS, with no detail: a caller must not be able to distinguish "no such
-- patient" from "not your patient", because that difference is itself a
-- disclosure that a patient identifier exists (Task 1.2 §7.1 rule 5).
create or replace function app_private.deny()
returns void
language plpgsql
volatile
as $fn$
begin
  raise exception 'not authorized' using errcode = '42501';
end;
$fn$;

revoke all on function app_private.deny() from public, anon, authenticated, service_role;

-- The caller gate, resolved from public.users directly rather than through
-- current_user_role(). 0028's helper is active-aware, but a SECURITY DEFINER
-- write RPC bypasses RLS, so role alone is never sufficient — it must also
-- confirm the facility exists and is type tb_dots. A barangay health station
-- cannot own a case.
create or replace function app_private.tbdots_caller(out caller_user_id uuid, out caller_facility_id uuid)
returns record
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  select u.user_id, u.facility_id
    into caller_user_id, caller_facility_id
    from public.users u
    join public.facilities f on f.facility_id = u.facility_id
   where u.user_id = auth.uid()
     and u.active
     and u.role = 'tb_dots'
     and f.type = 'tb_dots';

  if caller_user_id is null then
    perform app_private.deny();
  end if;
end;
$fn$;

revoke all on function app_private.tbdots_caller() from public, anon, authenticated, service_role;

-- Canonical payload fingerprint. jsonb's text output sorts keys and normalises
-- whitespace, so the same inputs always hash the same. sha256() is a core
-- PostgreSQL function (11+); pgcrypto is not required.
create or replace function app_private.payload_fingerprint(p_payload jsonb)
returns text
language sql
immutable
as $fn$
  select encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
$fn$;

revoke all on function app_private.payload_fingerprint(jsonb) from public, anon, authenticated, service_role;

-- The replay rule, in one place so every RPC applies it identically.
-- On a hit, ALL THREE bindings must match. If any differs, the uniform 42501
-- is raised — never a message revealing which check failed, and never the
-- stored result.
create or replace function app_private.replayed_result(
  p_operation   text,
  p_request_id  uuid,
  p_actor       uuid,
  p_facility    uuid,
  p_fingerprint text
) returns uuid
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare r record;
begin
  if p_request_id is null then
    return null;
  end if;

  select * into r from public.rpc_requests
   where operation = p_operation and request_id = p_request_id;

  if not found then
    return null;
  end if;

  if r.actor_user_id is distinct from p_actor
     or r.facility_id is distinct from p_facility
     or r.payload_fingerprint is distinct from p_fingerprint then
    perform app_private.deny();
  end if;

  return r.result_id;
end;
$fn$;

revoke all on function app_private.replayed_result(text, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;


-- ===========================================================================
-- 10. The write RPCs. This is the entire write surface for case data.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 10.1 create_tb_case — authorization is ADMISSION, not just role.
--
-- ARCH-02 was correct that the previous draft would have let any facility
-- attach any patient UUID to itself: a SECURITY DEFINER function bypasses RLS,
-- so `p_patient_id` is an unvalidated claim until this function validates it.
--
--   * referral-backed — the referral must exist, its patient must be this
--     patient, its facility must be the caller's, and its status must be one
--     of received/tested/closed. A still-`submitted` referral is not an
--     admission: the patient has not arrived.
--   * referral-free — patient existence is NOT sufficient. The patient must
--     have been enrolled by this caller's own facility as a walk-in. Any other
--     referral-free intake is deliberately unavailable here; widening it needs
--     its own review.
--
-- facility_id and created_by come from the session and are never read from the
-- payload.
-- ---------------------------------------------------------------------------
create or replace function public.create_tb_case(
  p_patient_id        uuid,
  p_referral_id       uuid default null,
  p_registration_date date default null,
  p_request_id        uuid default null
) returns public.tb_cases
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_caller      record;
  v_reg_date    date;
  v_fingerprint text;
  v_replay      uuid;
  v_short       text;
  v_year        int;
  v_seq         int;
  v_case        public.tb_cases;
begin
  select * into v_caller from app_private.tbdots_caller();

  v_reg_date := coalesce(p_registration_date, public.manila_today());

  v_fingerprint := app_private.payload_fingerprint(jsonb_build_object(
    'patient_id',        p_patient_id,
    'referral_id',       p_referral_id,
    'registration_date', v_reg_date
  ));

  v_replay := app_private.replayed_result(
    'create_tb_case', p_request_id, v_caller.caller_user_id, v_caller.caller_facility_id, v_fingerprint);
  if v_replay is not null then
    select * into v_case from public.tb_cases where case_id = v_replay;
    return v_case;
  end if;

  -- Admission. Every branch fails into the same uniform denial.
  if p_referral_id is not null then
    if not exists (
      select 1 from public.referrals r
       where r.referral_id = p_referral_id
         and r.patient_id  = p_patient_id
         and r.facility_id = v_caller.caller_facility_id
         and r.status in ('received','tested','closed')
    ) then
      perform app_private.deny();
    end if;
  else
    -- D7 — Task 1.2 §7.1 rule 4 names own_enrolled_patient_ids(), which is
    -- `enrolled_by = auth.uid()`: the CALLER, not the facility. Its own
    -- sentence says "this facility registered them as a walk-in", and a
    -- walk-in registered by a colleague on the previous shift is the same
    -- admission. So the arm is facility-scoped — but restricted to enrolment
    -- by TB-DOTS staff, because a BHW's users row also carries a facility_id
    -- (0029's matrix shows this) and a BHW-enrolled barangay patient is not a
    -- walk-in at that facility.
    if not exists (
      select 1
        from public.patients p
        join public.users u on u.user_id = p.enrolled_by
       where p.patient_id = p_patient_id
         and u.facility_id = v_caller.caller_facility_id
         and u.role = 'tb_dots'
    ) then
      perform app_private.deny();
    end if;
  end if;

  if v_reg_date > public.manila_today() then
    raise exception 'create_tb_case: registration date % is in the future', v_reg_date
      using errcode = '22007';
  end if;

  -- The transactional counter. A rollback gives the number back, which a
  -- sequence could not do (Task 1.2 §6).
  select f.short_code into v_short
    from public.facilities f where f.facility_id = v_caller.caller_facility_id;
  if v_short is null then
    raise exception 'create_tb_case: facility has no short code'
      using errcode = '23502',
            hint = 'Every TB-DOTS facility needs a reviewed short_code (0031 §1).';
  end if;

  v_year := extract(year from v_reg_date)::int;

  insert into public.case_number_counters (facility_id, year, next_seq)
  values (v_caller.caller_facility_id, v_year, 1)
  on conflict (facility_id, year)
    do update set next_seq = case_number_counters.next_seq + 1
  returning next_seq into v_seq;

  begin
    insert into public.tb_cases
      (patient_id, referral_id, facility_id, case_number, registration_date,
       case_status, created_by)
    values
      (p_patient_id, p_referral_id, v_caller.caller_facility_id,
       'TBC-' || v_short || '-' || v_year::text || '-' || lpad(v_seq::text, 5, '0'),
       v_reg_date, 'registered', v_caller.caller_user_id)
    returning * into v_case;
  exception when unique_violation then
    -- The one-active-case index is global (Task 1.2 §4). This is a real
    -- workflow answer, not a disclosure: the caller has already proved
    -- admission for this patient above, so they may be told that the episode
    -- exists somewhere and that a transfer is the remedy.
    raise exception 'this patient already has an open TB case'
      using errcode = '23505',
            hint = 'An open episode elsewhere must be transferred by an administrator.';
  end;

  perform app_private.write_audit(
    'tb_cases', v_case.case_id, 'created',
    v_case.patient_id, v_case.facility_id,
    jsonb_build_object(
      'case_status',       jsonb_build_object('from', null, 'to', v_case.case_status),
      'case_number',       jsonb_build_object('from', null, 'to', v_case.case_number),
      'registration_date', jsonb_build_object('from', null, 'to', v_case.registration_date)
    ));

  if p_request_id is not null then
    insert into public.rpc_requests
      (operation, request_id, actor_user_id, facility_id,
       payload_fingerprint, result_kind, result_id)
    values
      ('create_tb_case', p_request_id, v_caller.caller_user_id, v_caller.caller_facility_id,
       v_fingerprint, 'tb_case', v_case.case_id);
  end if;

  return v_case;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 10.2 set_tb_case_status — every lifecycle transition, including starting
--      treatment.
--
-- R2-04: revision 2 let this move a case to on_treatment while a second call
-- wrote treatment_start_date — two commits for one clinical event. The date is
-- now part of the same statement that changes the status.
--
-- Closing (and, per D3, cancelling) cancels the case's FUTURE scheduled
-- appointments in this same transaction, one audit event each. Past scheduled
-- rows are left alone: they are the input to missed-visit handling and erasing
-- them would hide a real gap in care (gate decision 6).
--
-- The sweep runs BEFORE the status update on purpose — enforce_appointment_
-- case_open() would otherwise see an already-terminal case and reject its own
-- migration's cancellation.
-- ---------------------------------------------------------------------------
create or replace function public.set_tb_case_status(
  p_case_id             uuid,
  p_new_status          text,
  p_treatment_start_date date default null,
  p_outcome             text default null,
  p_outcome_date        date default null
) returns public.tb_cases
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_caller  record;
  v_old     public.tb_cases;
  v_new     public.tb_cases;
  v_start   date;
  v_appt    record;
  v_action  text;
begin
  select * into v_caller from app_private.tbdots_caller();

  select * into v_old from public.tb_cases
   where case_id = p_case_id and facility_id = v_caller.caller_facility_id
     for update;
  if not found then
    perform app_private.deny();
  end if;

  if not public.tb_case_transition_allowed(v_old.case_status, p_new_status) then
    raise exception 'tb_cases: % is not a permitted transition from %',
      p_new_status, v_old.case_status
      using errcode = '42501';
  end if;

  -- Shape the target row. The CHECKs in §5 are the authority; these raises
  -- exist so the caller gets a sentence instead of a constraint name.
  if p_new_status = 'on_treatment' then
    v_start := coalesce(p_treatment_start_date, v_old.treatment_start_date);
    if v_start is null then
      raise exception 'set_tb_case_status: starting treatment requires a start date'
        using errcode = '22004';
    end if;
    if v_start > public.manila_today() then
      raise exception 'set_tb_case_status: treatment start date % is in the future', v_start
        using errcode = '22007';
    end if;
  else
    v_start := v_old.treatment_start_date;
  end if;

  if p_new_status = 'closed' then
    if p_outcome is null or p_outcome_date is null then
      raise exception 'set_tb_case_status: closing a case requires an outcome and its date'
        using errcode = '22004';
    end if;
    if p_outcome_date > public.manila_today() then
      raise exception 'set_tb_case_status: outcome date % is in the future', p_outcome_date
        using errcode = '22007';
    end if;

    -- M31-04. §8.1's trigger enforces `visit_date <= outcome_date` only when a
    -- FOLLOW-UP is written; closing the parent never re-checked the rows that
    -- already exist. So a case could be closed with an outcome dated before a
    -- visit it had already recorded — an episode that ended before its own last
    -- visit, which every timeline and duration figure would then repeat.
    --
    -- The invariant belongs to the pair, so it is enforced from both sides:
    -- here when the case moves, in the trigger when the follow-up moves.
    if exists (
      select 1 from public.treatment_followups f
       where f.case_id = p_case_id
         and f.voided_at is null
         and f.visit_date > p_outcome_date
    ) then
      raise exception
        'set_tb_case_status: outcome date % precedes a recorded visit on this case',
        p_outcome_date
        using errcode = '22007',
              hint = 'Correct or void the later follow-up first, or close on a later date.';
    end if;
  elsif p_outcome is not null or p_outcome_date is not null then
    raise exception 'set_tb_case_status: an outcome belongs only to a closed case'
      using errcode = '22023';
  end if;

  -- D3 — the cancellation sweep, before the status changes.
  if p_new_status in ('closed','cancelled') then
    for v_appt in
      select appointment_id, patient_id, facility_id, scheduled_date
        from public.appointments
       where tb_case_id = p_case_id
         and status = 'scheduled'
         and scheduled_date >= public.manila_today()
       for update
    loop
      update public.appointments
         set status = 'cancelled'
       where appointment_id = v_appt.appointment_id;

      perform app_private.write_audit(
        'appointments', v_appt.appointment_id, 'cancelled',
        v_appt.patient_id, v_appt.facility_id,
        jsonb_build_object('status', jsonb_build_object('from', 'scheduled', 'to', 'cancelled')));
    end loop;
  end if;

  update public.tb_cases
     set case_status          = p_new_status,
         treatment_start_date = v_start,
         outcome              = case when p_new_status = 'closed' then p_outcome else null end,
         outcome_date         = case when p_new_status = 'closed' then p_outcome_date else null end
   where case_id = p_case_id
  returning * into v_new;

  v_action := case p_new_status
                when 'closed'    then 'closed'
                when 'cancelled' then 'cancelled'
                else 'status_changed'
              end;

  perform app_private.write_audit(
    'tb_cases', v_new.case_id, v_action, v_new.patient_id, v_new.facility_id,
    jsonb_strip_nulls(jsonb_build_object(
      'case_status', jsonb_build_object('from', v_old.case_status, 'to', v_new.case_status),
      'treatment_start_date',
        case when v_old.treatment_start_date is distinct from v_new.treatment_start_date
             then jsonb_build_object('from', v_old.treatment_start_date, 'to', v_new.treatment_start_date) end,
      'outcome',
        case when v_old.outcome is distinct from v_new.outcome
             then jsonb_build_object('from', v_old.outcome, 'to', v_new.outcome) end,
      'outcome_date',
        case when v_old.outcome_date is distinct from v_new.outcome_date
             then jsonb_build_object('from', v_old.outcome_date, 'to', v_new.outcome_date) end
    )));

  return v_new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 10.3 correct_tb_case_dates — D1: no p_registration_date.
--
-- Both parameters are the DESIRED FINAL VALUES, not a patch: passing NULL
-- clears the column. That is deliberate, so a correction cannot leave a shape
-- the lifecycle does not allow — the §5 CHECKs re-validate every invariant,
-- and clearing a start date out of an on_treatment case fails there rather
-- than succeeding quietly (which is exactly what revision 2 permitted).
-- ---------------------------------------------------------------------------
create or replace function public.correct_tb_case_dates(
  p_case_id              uuid,
  p_treatment_start_date date default null,
  p_outcome_date         date default null
) returns public.tb_cases
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_caller record;
  v_old    public.tb_cases;
  v_new    public.tb_cases;
begin
  select * into v_caller from app_private.tbdots_caller();

  select * into v_old from public.tb_cases
   where case_id = p_case_id and facility_id = v_caller.caller_facility_id
     for update;
  if not found then
    perform app_private.deny();
  end if;

  if p_treatment_start_date is not null and p_treatment_start_date > public.manila_today() then
    raise exception 'correct_tb_case_dates: treatment start date % is in the future',
      p_treatment_start_date using errcode = '22007';
  end if;
  if p_outcome_date is not null and p_outcome_date > public.manila_today() then
    raise exception 'correct_tb_case_dates: outcome date % is in the future',
      p_outcome_date using errcode = '22007';
  end if;

  update public.tb_cases
     set treatment_start_date = p_treatment_start_date,
         outcome_date         = p_outcome_date
   where case_id = p_case_id
  returning * into v_new;

  -- A follow-up already recorded outside the corrected interval would make the
  -- case internally inconsistent, and §8.1's trigger only fires on the
  -- follow-up's own writes. Check it here rather than leaving it undetected.
  if exists (
    select 1 from public.treatment_followups f
     where f.case_id = p_case_id
       and f.voided_at is null
       and (f.visit_date < v_new.registration_date
            or (v_new.outcome_date is not null and f.visit_date > v_new.outcome_date))
  ) then
    raise exception
      'correct_tb_case_dates: an existing follow-up visit falls outside the corrected case interval'
      using errcode = '22007',
            hint = 'Correct or void the follow-up first.';
  end if;

  perform app_private.write_audit(
    'tb_cases', v_new.case_id, 'updated', v_new.patient_id, v_new.facility_id,
    jsonb_strip_nulls(jsonb_build_object(
      'treatment_start_date',
        case when v_old.treatment_start_date is distinct from v_new.treatment_start_date
             then jsonb_build_object('from', v_old.treatment_start_date, 'to', v_new.treatment_start_date) end,
      'outcome_date',
        case when v_old.outcome_date is distinct from v_new.outcome_date
             then jsonb_build_object('from', v_old.outcome_date, 'to', v_new.outcome_date) end
    )));

  return v_new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 10.4 transfer_tb_case — the remedy for the global one-active-case index.
--
-- A transfer MOVES the case; it does not close and re-open it. Closing on
-- transfer would force staff to record an outcome that did not happen and
-- would corrupt every outcome count.
--
-- Admin-only, and admins hold no row policy on tb_cases — this function is the
-- entire extent of their reach into case data, consistent with the rule that
-- administrative privilege is not clinical authorization.
--
-- The single UPDATE below cascades facility_id to every linked appointment
-- through appointments_case_facility_agrees. The GUC is set as well: the
-- cascade authorizes itself against the already-updated parent, but a transfer
-- is one of the three operations the GUC exists for and relying on statement
-- ordering inside PostgreSQL for a security check would be fragile.
-- ---------------------------------------------------------------------------
create or replace function public.transfer_tb_case(
  p_case_id        uuid,
  p_to_facility_id uuid,
  p_reason         text
) returns public.tb_cases
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_old public.tb_cases;
  v_new public.tb_cases;
begin
  if not exists (
    select 1 from public.users u
     where u.user_id = auth.uid() and u.active and u.role = 'admin'
  ) then
    perform app_private.deny();
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'transfer_tb_case: a reason is required' using errcode = '22004';
  end if;

  select * into v_old from public.tb_cases where case_id = p_case_id for update;
  if not found then
    perform app_private.deny();
  end if;

  if v_old.case_status in ('closed','cancelled') then
    raise exception 'transfer_tb_case: case % is % and cannot be transferred',
      p_case_id, v_old.case_status using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.facilities f
     where f.facility_id = p_to_facility_id and f.type = 'tb_dots'
  ) then
    raise exception 'transfer_tb_case: destination is not a TB-DOTS facility'
      using errcode = '22023';
  end if;

  if p_to_facility_id = v_old.facility_id then
    raise exception 'transfer_tb_case: the case is already at that facility'
      using errcode = '22023';
  end if;

  perform set_config('tbscreen.ownership_change', 'on', true);

  update public.tb_cases set facility_id = p_to_facility_id
   where case_id = p_case_id
  returning * into v_new;

  perform app_private.write_audit(
    'tb_cases', v_new.case_id, 'transferred', v_new.patient_id, v_new.facility_id,
    jsonb_build_object('facility_id',
      jsonb_build_object('from', v_old.facility_id, 'to', v_new.facility_id)));

  perform set_config('tbscreen.ownership_change', 'off', true);

  return v_new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 10.5 claim_unassigned_appointment / assign_appointment_to_case.
--
-- Later assignment is an authorized operation, never a PATCH. Both set the
-- ownership GUC for their own transaction and both audit.
-- ---------------------------------------------------------------------------
create or replace function public.claim_unassigned_appointment(p_appointment_id uuid)
returns public.appointments
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_caller record;
  v_appt   public.appointments;
begin
  select * into v_caller from app_private.tbdots_caller();

  select * into v_appt from public.appointments
   where appointment_id = p_appointment_id for update;
  if not found or v_appt.facility_id is not null then
    perform app_private.deny();
  end if;

  -- The same authority rule the read policy uses: true only when EVERY
  -- referral for this patient names the caller's own facility.
  if not public.caller_owns_unassigned_appointment(v_appt.patient_id) then
    perform app_private.deny();
  end if;

  perform set_config('tbscreen.ownership_change', 'on', true);

  update public.appointments set facility_id = v_caller.caller_facility_id
   where appointment_id = p_appointment_id
  returning * into v_appt;

  perform app_private.write_audit(
    'appointments', v_appt.appointment_id, 'updated',
    v_appt.patient_id, v_appt.facility_id,
    jsonb_build_object('facility_id',
      jsonb_build_object('from', null, 'to', v_appt.facility_id)));

  perform set_config('tbscreen.ownership_change', 'off', true);

  return v_appt;
end;
$fn$;

-- The links are SWAPPED, not accumulated (R2-02): referral_id is cleared as
-- tb_case_id is set, so facility_id never has two live parents. Nothing is
-- lost — tb_cases.referral_id already holds the episode's provenance, so the
-- chain from appointment to case to originating referral stays intact and is
-- recorded once instead of twice.
create or replace function public.assign_appointment_to_case(
  p_appointment_id uuid,
  p_case_id        uuid
) returns public.appointments
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_caller record;
  v_old    public.appointments;
  v_appt   public.appointments;
begin
  select * into v_caller from app_private.tbdots_caller();

  select * into v_old from public.appointments
   where appointment_id = p_appointment_id
     and facility_id = v_caller.caller_facility_id
     for update;
  if not found then
    perform app_private.deny();
  end if;

  -- M31-02: the PATIENT has to match too, not just the facility. The
  -- patient-aware FK would now reject the mismatch anyway, but an FK violation
  -- is a constraint name in a log, and this is an authorization question — a
  -- caller asking to attach one patient's appointment to another patient's
  -- episode gets the uniform denial, like every other admission failure.
  if not exists (
    select 1 from public.tb_cases c
     where c.case_id = p_case_id
       and c.facility_id = v_caller.caller_facility_id
       and c.patient_id = v_old.patient_id
       and c.case_status not in ('closed','cancelled')
  ) then
    perform app_private.deny();
  end if;

  perform set_config('tbscreen.ownership_change', 'on', true);

  update public.appointments
     set referral_id = null,
         tb_case_id  = p_case_id
   where appointment_id = p_appointment_id
  returning * into v_appt;

  perform app_private.write_audit(
    'appointments', v_appt.appointment_id, 'updated',
    v_appt.patient_id, v_appt.facility_id,
    jsonb_build_object(
      'referral_id', jsonb_build_object('from', v_old.referral_id, 'to', null),
      'tb_case_id',  jsonb_build_object('from', v_old.tb_case_id,  'to', p_case_id)));

  perform set_config('tbscreen.ownership_change', 'off', true);

  return v_appt;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 10.6 record_visit — one visit is ONE atomic operation.
--
-- In the UI recording a visit is one act: mark attended, write the note,
-- possibly move the case status, possibly book the next appointment. Four
-- PostgREST writes would recreate BASE-03's partial-write failure on the
-- clinical path.
--
-- D5: no p_weight_kg. D6: booking a next appointment while moving the case to
-- a terminal status is rejected rather than silently resolved — D3's sweep
-- would cancel what was just booked.
--
-- M31-05 — WHICH TRANSITIONS THIS ADVERTISES, and what each one needs.
--
-- The first version passed NULL treatment and outcome fields straight through
-- to set_tb_case_status(), so it advertised a `p_new_case_status` it could not
-- deliver: an initial `on_treatment` and every `closed` would fail on a missing
-- date, while `cancelled` would succeed and leave a clinical follow-up attached
-- to an episode declared opened in error.
--
-- Rather than narrow the parameter to the two transitions that happened to
-- work, it now carries the inputs those transitions require — because starting
-- treatment at a visit and completing treatment at a visit are exactly the
-- moments Task 1.3 §4.4 describes as one act:
--
--   on_treatment  from `registered`   — needs p_treatment_start_date
--                 from `interrupted`  — the start date already exists
--   interrupted   from `on_treatment` — needs nothing
--   closed        from either         — needs p_outcome and p_outcome_date
--   cancelled                         — REJECTED here, always
--
-- `cancelled` means the episode was opened in error. You cannot in the same
-- breath record what happened at one of its visits. It stays available on
-- set_tb_case_status(), where nothing clinical is being written alongside it.
--
-- Every field is still routed through the single transition authority; this
-- function validates its own inputs and then delegates, so the lifecycle rules
-- live in exactly one place.
-- ---------------------------------------------------------------------------
create or replace function public.record_visit(
  p_case_id              uuid,
  p_visit_date           date,
  p_appointment_id       uuid default null,
  p_notes                text default null,
  p_next_scheduled_date  date default null,
  p_new_case_status      text default null,
  p_treatment_start_date date default null,
  p_outcome              text default null,
  p_outcome_date         date default null,
  p_request_id           uuid default null
) returns public.treatment_followups
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_caller      record;
  v_case        public.tb_cases;
  v_appt_old    public.appointments;
  v_appt        public.appointments;
  v_followup    public.treatment_followups;
  v_next        uuid;
  v_fingerprint text;
  v_replay      uuid;
  v_visit       date;
begin
  select * into v_caller from app_private.tbdots_caller();

  v_visit := coalesce(p_visit_date, public.manila_today());

  -- M31-05. Reject what this function cannot honestly represent, BEFORE any
  -- row is written, so a caller is never told a visit was recorded and a status
  -- moved when only the first is true.
  if p_new_case_status = 'cancelled' then
    raise exception
      'record_visit: a case cancelled as opened in error cannot also have a visit recorded'
      using errcode = '22023',
            hint = 'Use set_tb_case_status() to cancel, and void the follow-up if one exists.';
  end if;

  if p_new_case_status is not null
     and p_new_case_status not in ('on_treatment','interrupted','closed') then
    raise exception 'record_visit: % is not a status this call can set', p_new_case_status
      using errcode = '22023';
  end if;

  if p_new_case_status = 'closed' and (p_outcome is null or p_outcome_date is null) then
    raise exception 'record_visit: closing a case requires an outcome and its date'
      using errcode = '22004';
  end if;

  if p_new_case_status is distinct from 'closed'
     and (p_outcome is not null or p_outcome_date is not null) then
    raise exception 'record_visit: an outcome belongs only to a closed case'
      using errcode = '22023';
  end if;

  if p_next_scheduled_date is not null and p_new_case_status = 'closed' then
    raise exception
      'record_visit: cannot book a next appointment while ending the episode'
      using errcode = '22023',
            hint = 'Close the case in its own call; ending it cancels future visits.';
  end if;

  v_fingerprint := app_private.payload_fingerprint(jsonb_build_object(
    'case_id',              p_case_id,
    'visit_date',           v_visit,
    'appointment_id',       p_appointment_id,
    'notes',                p_notes,
    'next_scheduled_date',  p_next_scheduled_date,
    'new_case_status',      p_new_case_status,
    'treatment_start_date', p_treatment_start_date,
    'outcome',              p_outcome,
    'outcome_date',         p_outcome_date
  ));

  v_replay := app_private.replayed_result(
    'record_visit', p_request_id, v_caller.caller_user_id, v_caller.caller_facility_id, v_fingerprint);
  if v_replay is not null then
    select * into v_followup from public.treatment_followups where followup_id = v_replay;
    return v_followup;
  end if;

  select * into v_case from public.tb_cases
   where case_id = p_case_id and facility_id = v_caller.caller_facility_id
     for update;
  if not found then
    perform app_private.deny();
  end if;

  -- Attendance first, so §8.1's invariant sees the appointment already marked.
  if p_appointment_id is not null then
    select * into v_appt_old from public.appointments
     where appointment_id = p_appointment_id
       and facility_id = v_caller.caller_facility_id
       and tb_case_id  = p_case_id
       for update;
    if not found then
      perform app_private.deny();
    end if;

    update public.appointments
       set status = 'attended', attended_date = v_visit
     where appointment_id = p_appointment_id
    returning * into v_appt;

    -- The previous status is read, not assumed: a visit is regularly recorded
    -- against a row already marked `missed`, and an audit that always claims
    -- `from: scheduled` is a log that quietly invents its own history.
    perform app_private.write_audit(
      'appointments', v_appt.appointment_id, 'updated',
      v_appt.patient_id, v_appt.facility_id,
      jsonb_build_object(
        'status',        jsonb_build_object('from', v_appt_old.status, 'to', 'attended'),
        'attended_date', jsonb_build_object('from', v_appt_old.attended_date, 'to', v_visit)));
  end if;

  insert into public.treatment_followups
    (case_id, appointment_id, visit_date, notes, recorded_by)
  values
    (p_case_id, p_appointment_id, v_visit, p_notes, v_caller.caller_user_id)
  returning * into v_followup;

  -- The audit records that a visit was recorded and when. It never carries
  -- `notes` — that is the whitelist's whole point.
  perform app_private.write_audit(
    'treatment_followups', v_followup.followup_id, 'created',
    v_case.patient_id, v_case.facility_id,
    jsonb_build_object('visit_date', jsonb_build_object('from', null, 'to', v_visit)));

  if p_next_scheduled_date is not null then
    insert into public.appointments
      (patient_id, scheduled_date, status, facility_id, tb_case_id)
    values
      (v_case.patient_id, p_next_scheduled_date, 'scheduled',
       v_caller.caller_facility_id, p_case_id)
    returning appointment_id into v_next;

    perform app_private.write_audit(
      'appointments', v_next, 'created', v_case.patient_id, v_caller.caller_facility_id,
      jsonb_build_object(
        'scheduled_date', jsonb_build_object('from', null, 'to', p_next_scheduled_date),
        'tb_case_id',     jsonb_build_object('from', null, 'to', p_case_id)));
  end if;

  -- Delegated to the single transition authority rather than re-implemented,
  -- now with the fields each advertised transition actually needs (M31-05).
  -- It runs LAST, so M31-04's check sees the follow-up just inserted: closing
  -- on a date earlier than this very visit is refused here too.
  if p_new_case_status is not null and p_new_case_status <> v_case.case_status then
    perform public.set_tb_case_status(
      p_case_id, p_new_case_status, p_treatment_start_date, p_outcome, p_outcome_date);
  end if;

  if p_request_id is not null then
    insert into public.rpc_requests
      (operation, request_id, actor_user_id, facility_id,
       payload_fingerprint, result_kind, result_id)
    values
      ('record_visit', p_request_id, v_caller.caller_user_id, v_caller.caller_facility_id,
       v_fingerprint, 'treatment_followup', v_followup.followup_id);
  end if;

  return v_followup;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 10.7 void_tb_followup / correct_followup_visit_date.
--
-- WHAT VOID MEANS, decided (§4.3): the CLINICAL RECORD is invalid. It does NOT
-- say the patient was absent. Attendance is a separate fact, it lives on the
-- appointment, and it already has its own correction path. Keeping the two
-- separate means neither operation has to guess about the other, and it avoids
-- a void silently rewriting attendance history.
--
-- Voiding frees the appointment's follow-up slot (the partial index in §8), so
-- a corrected replacement can be recorded.
-- ---------------------------------------------------------------------------
create or replace function public.void_tb_followup(
  p_followup_id uuid,
  p_reason      text
) returns public.treatment_followups
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_caller record;
  v_case   public.tb_cases;
  v_row    public.treatment_followups;
begin
  select * into v_caller from app_private.tbdots_caller();

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'void_tb_followup: a reason is required' using errcode = '22004';
  end if;

  select f.* into v_row
    from public.treatment_followups f
    join public.tb_cases c on c.case_id = f.case_id
   where f.followup_id = p_followup_id
     and c.facility_id = v_caller.caller_facility_id
     for update of f;
  if not found then
    perform app_private.deny();
  end if;

  if v_row.voided_at is not null then
    raise exception 'void_tb_followup: this record is already voided'
      using errcode = '22023';
  end if;

  select * into v_case from public.tb_cases where case_id = v_row.case_id;

  update public.treatment_followups
     set voided_at = now(), voided_by = v_caller.caller_user_id, void_reason = p_reason
   where followup_id = p_followup_id
  returning * into v_row;

  perform app_private.write_audit(
    'treatment_followups', v_row.followup_id, 'voided',
    v_case.patient_id, v_case.facility_id,
    jsonb_build_object(
      'voided_at',   jsonb_build_object('from', null, 'to', v_row.voided_at),
      'void_reason', jsonb_build_object('from', null, 'to', p_reason)));

  return v_row;
end;
$fn$;

-- The two rows move TOGETHER (R2-07). §8.1 requires a linked follow-up to
-- satisfy visit_date = appointments.attended_date, so a direct UPDATE of
-- either one alone is simply rejected, with no supported way to fix the pair.
create or replace function public.correct_followup_visit_date(
  p_followup_id uuid,
  p_visit_date  date
) returns public.treatment_followups
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_caller record;
  v_case   public.tb_cases;
  v_old    public.treatment_followups;
  v_row    public.treatment_followups;
  v_appt   public.appointments;
begin
  select * into v_caller from app_private.tbdots_caller();

  select f.* into v_old
    from public.treatment_followups f
    join public.tb_cases c on c.case_id = f.case_id
   where f.followup_id = p_followup_id
     and c.facility_id = v_caller.caller_facility_id
     for update of f;
  if not found then
    perform app_private.deny();
  end if;

  if v_old.voided_at is not null then
    raise exception 'correct_followup_visit_date: this record is voided'
      using errcode = '22023';
  end if;

  select * into v_case from public.tb_cases where case_id = v_old.case_id;

  -- The appointment moves first, so the follow-up's own temporal trigger sees
  -- the corrected attendance date and re-validates the pair as a whole.
  if v_old.appointment_id is not null then
    update public.appointments
       set attended_date = p_visit_date
     where appointment_id = v_old.appointment_id
    returning * into v_appt;

    perform app_private.write_audit(
      'appointments', v_appt.appointment_id, 'updated',
      v_appt.patient_id, v_appt.facility_id,
      jsonb_build_object('attended_date',
        jsonb_build_object('from', v_old.visit_date, 'to', p_visit_date)));
  end if;

  update public.treatment_followups set visit_date = p_visit_date
   where followup_id = p_followup_id
  returning * into v_row;

  perform app_private.write_audit(
    'treatment_followups', v_row.followup_id, 'updated',
    v_case.patient_id, v_case.facility_id,
    jsonb_build_object('visit_date',
      jsonb_build_object('from', v_old.visit_date, 'to', p_visit_date)));

  return v_row;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 10.8 bhw_case_summary — a REAL server-side column boundary.
--
-- A BHW has a real need: is the patient I referred actually on treatment? A
-- BHW has no need for the outcome, the dates or the clinical notes.
--
-- RLS cannot restrict columns, and a column GRANT cannot separate BHWs from
-- TB-DOTS staff because both authenticate as `authenticated` — the exact
-- constraint documented on REFERRAL_COLUMNS in syncEngine.ts, where the
-- boundary ended up client-side and therefore unenforced. This fixes that
-- class of problem instead of repeating it, and it is the pattern new work
-- should follow.
-- ---------------------------------------------------------------------------
create or replace function public.bhw_case_summary(p_patient_id uuid)
returns table (
  patient_id        uuid,
  case_status       text,
  facility_name     text,
  registration_date date
)
language sql
stable
security definer
set search_path = public
as $fn$
  select c.patient_id, c.case_status, f.name, c.registration_date
    from public.tb_cases c
    join public.facilities f on f.facility_id = c.facility_id
   where public.current_user_active_role() = 'bhw'
     and c.patient_id = p_patient_id
     and c.patient_id in (select app_private.bhw_visible_patient_ids())
   order by c.registration_date desc;
$fn$;


-- ===========================================================================
-- 11. Function ACLs.
--
-- Supabase's default privileges grant EXECUTE to `anon` and `service_role` BY
-- NAME, and CREATE OR REPLACE preserves them, so `revoke ... from public`
-- alone leaves both standing (0019, M28-01). Every one is named.
--
-- transfer_tb_case() is granted to `authenticated` and gated to admins inside
-- the function: without the grant an admin could not reach it through
-- PostgREST at all.
-- ===========================================================================
do $acl$
declare f text;
begin
  foreach f in array array[
    'public.create_tb_case(uuid, uuid, date, uuid)',
    'public.set_tb_case_status(uuid, text, date, text, date)',
    'public.correct_tb_case_dates(uuid, date, date)',
    'public.transfer_tb_case(uuid, uuid, text)',
    'public.claim_unassigned_appointment(uuid)',
    'public.assign_appointment_to_case(uuid, uuid)',
    'public.record_visit(uuid, date, uuid, text, date, text, date, text, date, uuid)',
    'public.void_tb_followup(uuid, text)',
    'public.correct_followup_visit_date(uuid, date)',
    'public.bhw_case_summary(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('revoke all on function %s from service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$acl$;

-- The six enforce_* trigger functions are deliberately NOT revoked, and
-- neither is tb_case_transition_allowed(). Two reasons, and the second is the
-- one that matters:
--
--   * They are not a disclosure surface. A trigger function invoked as an RPC
--     returns "trigger functions can only be called as triggers" and reads no
--     row; tb_case_transition_allowed() is a pure two-text lookup that holds
--     no data at all.
--   * enforce_tb_case_transition() is SECURITY INVOKER (0020's reasoning: a
--     function that only refuses must run as the caller), so it calls
--     tb_case_transition_allowed() as whoever is updating the row. Revoking
--     EXECUTE there would be a live hazard for a role this file has not
--     enumerated, in exchange for closing nothing. Least privilege is not
--     worth a trigger that fails for the wrong reason.


-- ============================================================================
-- POST-CHECKS (run separately — the SQL editor returns only the last result).
--
-- The behaviour matrix is supabase/tests/0031_case_registry_matrix.sql, run
-- through `node scripts/build-preflight.mjs 0031`. These are the structural
-- spot-checks that the matrix cannot express as a persona question.
--
-- 1. Every TB-DOTS facility has a code and no other facility does:
--
--    select type, count(*) filter (where short_code is not null) as with_code,
--           count(*) as total
--      from public.facilities group by type order by 1;
--
--    Expect: barangay_health_station 0/1, tb_dots 11/11.
--
-- 2. The short-code CHECK actually rejects NULL for TB-DOTS (R3-03). This is
--    the constraint that looked correct while permitting exactly the row it
--    forbade, so test it rather than reading it:
--
--    begin;
--      insert into public.facilities (name, type, short_code)
--      values ('R3-03 probe', 'tb_dots', null);   -- MUST raise 23514
--    rollback;
--
-- 3. No client role holds INSERT, UPDATE or DELETE on tb_cases, and the
--    follow-up column grants are exactly (notes, updated_at):
--
--    select table_name, privilege_type, grantee
--      from information_schema.table_privileges
--     where table_schema = 'public'
--       and table_name in ('tb_cases','treatment_followups','audit_logs',
--                          'rpc_requests','case_number_counters')
--       and grantee in ('anon','authenticated')
--     order by 1, 3, 2;
--
--    Expect ONLY: tb_cases/SELECT/authenticated,
--                 treatment_followups/SELECT/authenticated,
--                 treatment_followups/UPDATE/authenticated,
--                 audit_logs/SELECT/authenticated.
--    Nothing for anon, nothing for rpc_requests or case_number_counters.
--
-- 4. Effective COLUMN privileges, not the statements that were meant to set
--    them. The reason the wrong REVOKE survived two revisions is that it runs
--    without complaint (R3-02):
--
--    select has_column_privilege('authenticated','public.treatment_followups','visit_date','UPDATE')   as visit_date,
--           has_column_privilege('authenticated','public.treatment_followups','voided_at','UPDATE')    as voided_at,
--           has_column_privilege('authenticated','public.treatment_followups','voided_by','UPDATE')    as voided_by,
--           has_column_privilege('authenticated','public.treatment_followups','void_reason','UPDATE')  as void_reason,
--           has_column_privilege('authenticated','public.treatment_followups','notes','UPDATE')        as notes,
--           has_column_privilege('authenticated','public.appointments','tb_case_id','UPDATE')          as appt_case_id,
--           has_column_privilege('authenticated','public.appointments','status','UPDATE')              as appt_status;
--
--    Expect: notes and appt_status TRUE; every other column FALSE.
--
-- 5. Function ACLs. LEFT JOIN, with grantee 0 rendered as PUBLIC — an inner
--    join silently drops PUBLIC, which is the one thing this check exists to
--    catch (M28-01):
--
--    select n.nspname, p.proname,
--           coalesce(r.rolname, 'PUBLIC') as grantee, a.privilege_type
--      from pg_proc p
--      join pg_namespace n on n.oid = p.pronamespace
--      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
--      left join pg_roles r on r.oid = a.grantee
--     where p.proname in ('create_tb_case','set_tb_case_status','correct_tb_case_dates',
--                         'transfer_tb_case','claim_unassigned_appointment',
--                         'assign_appointment_to_case','record_visit',
--                         'void_tb_followup','correct_followup_visit_date',
--                         'bhw_case_summary','caller_owns_unassigned_appointment',
--                         'own_facility_case_ids','write_audit','deny',
--                         'tbdots_caller','payload_fingerprint','replayed_result',
--                         'purge_expired_rpc_requests')
--     order by 1, 2, 3;
--
--    Expect one `authenticated` EXECUTE row for each of the ten public RPCs,
--    for caller_owns_unassigned_appointment and for
--    app_private.own_facility_case_ids, plus owner rows. No anon, no PUBLIC,
--    no service_role anywhere, and NOTHING at all for the app_private
--    internals or purge_expired_rpc_requests.
--
-- 6. The appointment ownership backfill's remainder. This number is unknown
--    until the migration runs and is reported by a NOTICE; confirm it here:
--
--    select count(*) as unowned from public.appointments where facility_id is null;
--
--    On the live project this was 0 before the migration was written (1100
--    appointments, none ambiguous, none without a referral). A non-zero result
--    means new legacy rows arrived; they are visible to no client role until
--    support resolves them (Task 1.3 §3.2).
--
-- 7. The purge job is scheduled:
--
--    select jobname, schedule, active from cron.job where jobname = 'rpc-requests-purge';
--
-- 8. THE MANDATORY IMPLEMENTATION GATE — the old-client PostgREST upsert.
--    This one cannot be checked in SQL: it tests what PostgREST does with a
--    payload, not what the database does with a statement. Run
--
--        node scripts/old-client-upsert-check.mjs
--
--    against a real deployment before relying on the compatibility window.
--    If ownership columns do NOT survive an old build's whole-row upsert, the
--    window of Task 1.3 §3.4 becomes mandatory rather than a convenience.
-- ============================================================================
