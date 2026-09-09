-- ============================================================================
-- 0034_overdue_followup_detection.sql — Task 3.4, missed follow-up detection.
--
-- THE RULE THE PLAN ASKS FOR:
--
--     scheduled appointment + the date has passed + attendance not completed
--         = missed follow-up
--
-- and its acceptance criterion is "no UTC/Manila rollover regression".
--
-- ---------------------------------------------------------------------------
-- WHAT WAS ALREADY THERE, AND WHAT WAS NOT
--
-- `appointments.status = 'missed'` exists and is consumed in four places:
-- barangay_report() (0027/0030), dashboard_counts() (0018/0028), the mobile
-- dashboard, and the SMS follow-up nudge. Every one of them reads the column.
--
-- NOTHING WRITES IT AUTOMATICALLY. It is set by hand by TB-DOTS staff — the
-- mobile repo says so in a comment — so an appointment whose day passed with
-- nobody touching the record stays 'scheduled' forever. It is counted as
-- neither attended nor missed, it never reaches the follow-up nudge, and it is
-- invisible to every "attention required" surface. That is the actual gap.
--
-- ---------------------------------------------------------------------------
-- WHY THIS MIGRATION DETECTS AND DOES NOT MUTATE
--
-- The obvious implementation is a nightly pg_cron sweep flipping past-due
-- 'scheduled' rows to 'missed'. It is not built here, and the reason is not
-- caution in the abstract:
--
--   * `appointments_set_updated_at` bumps `updated_at` on every UPDATE.
--   * The SMS follow-up job (supabase/functions/sms-reminders) selects exactly
--     `status = 'missed' AND updated_at >= now() - 14 days`.
--
-- So a sweep does not merely relabel rows. Every row it touches lands inside
-- the follow-up window at once and becomes an outbound SMS candidate on the
-- next daily run. The pipeline is LIVE on a real provider. A first sweep would
-- text a real handset about an appointment from an arbitrary date in the past.
--
-- The second objection is the one that survives even after the SMS coupling is
-- solved. An automatic sweep cannot tell "the patient did not come" from "the
-- patient came and nobody recorded it". Marking the second case 'missed' sends
-- a person who attended a message asking them to reschedule, and files a false
-- no-show into the barangay report, which is a published figure. `missed` is
-- currently a staff assertion about a patient. Turning it into an inference
-- about a data-entry backlog changes what four existing consumers mean by it,
-- and quietly.
--
-- So this migration adds the detection and leaves the assertion alone:
--
--     OVERDUE  = the day has passed and the record is still open  (derived)
--     MISSED   = a person recorded that the patient did not come  (asserted)
--
-- Overdue is what an attention dashboard should surface, because it is exactly
-- the set of rows that need a human to look at them. Whether that human's
-- answer should then be written back automatically is a separate decision with
-- its own review; it is written up in
-- docs/agent/CLAUDE_TASK_3.4_MISSED_FOLLOWUP_DETECTION.md §4, not settled here.
--
-- ---------------------------------------------------------------------------
-- WHY THE FUNCTION IS SECURITY INVOKER
--
-- Every other read RPC in this system is SECURITY DEFINER and therefore has to
-- restate its own authorization, which is where 0031's M31-03 widening came
-- from. This one needs no new authorization at all: it reads `appointments`,
-- `patients` and `tb_cases`, all three of which carry reviewed RLS from 0029
-- and 0031. Left as SECURITY INVOKER, those policies apply to the caller and
-- the facility/barangay scoping is inherited rather than re-derived.
--
-- The consequence is that a TB-DOTS account sees its own facility's overdue
-- rows, a BHW sees those of patients in their barangay, and midwife/admin see
-- nothing — because that is what the existing policies already say. No policy
-- is added, changed or weakened by this file.
--
-- ---------------------------------------------------------------------------
-- Verified by supabase/tests/0034_overdue_detection_matrix.sql. Run
--     node scripts/build-preflight.mjs 0034
-- and execute the generated file; it wraps both in one rolled-back transaction.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The predicate, named once.
--
-- The whole point of Task 3.4's acceptance criterion is that this comparison
-- uses the Manila civil calendar and not `current_date`, which is the SESSION
-- timezone's idea of today. Manila is UTC+8, so on a UTC session `current_date`
-- lags the local calendar for the first eight hours of every Manila day: an
-- appointment that became overdue at 00:00 Manila would not be reported as such
-- until 08:00. That is the same class of defect as BASE-04, which is why
-- manila_today() (0018) exists and why nothing here may reach for current_date.
--
-- IMMUTABLE is wrong and STABLE is right: the answer changes as the clock
-- crosses Manila midnight, and an IMMUTABLE marking would license the planner
-- to fold it into a cached plan or, worse, an index expression.
-- ---------------------------------------------------------------------------
create or replace function public.appointment_is_overdue(
  p_status         text,
  p_scheduled_date date
)
returns boolean
language sql
stable
set search_path = public
as $fn$
  select p_status = 'scheduled'
     and p_scheduled_date is not null
     and p_scheduled_date < public.manila_today();
$fn$;

comment on function public.appointment_is_overdue(text, date) is
  'True when an appointment is still open and its day has passed on the '
  'Asia/Manila calendar (0034, Task 3.4). This is DERIVED — it is not the '
  'same claim as status = ''missed'', which is a person''s assertion that the '
  'patient did not attend. Never compare scheduled_date to current_date: that '
  'is the session timezone''s today and lags Manila by up to eight hours.';


-- ---------------------------------------------------------------------------
-- 2. The index the predicate wants.
--
-- Partial on status = 'scheduled'. That is the small end of this table by a
-- wide margin — 4 rows of 1100 on the live database at the time of writing,
-- because every resolved appointment leaves the state — so the index stays
-- proportional to the open worklist rather than to history. `scheduled_date`
-- leads because it carries the range predicate; RLS then narrows by facility
-- or by patient, and both of those already have indexes of their own
-- (appointments_facility_date_idx, appointments_patient_idx).
--
-- Deliberately NOT an index on appointment_is_overdue(...): the function is
-- STABLE, not IMMUTABLE, so it is not indexable, and making it IMMUTABLE to
-- win an index would be a lie about a function that reads the clock.
-- ---------------------------------------------------------------------------
create index if not exists appointments_open_schedule_idx
  on public.appointments (scheduled_date)
  where status = 'scheduled';

comment on index public.appointments_open_schedule_idx is
  'Supports overdue_followups() (0034). Partial on the open worklist, so it '
  'stays small as attended/missed history accumulates.';


-- ---------------------------------------------------------------------------
-- 3. overdue_followups() — the worklist.
--
-- SECURITY INVOKER (the default, stated here because it is a decision and not
-- an omission). See the header: authorization is the existing RLS on the three
-- tables this reads, unchanged and un-restated.
--
-- The join to `patients` is INNER on purpose. Under RLS an invisible patient
-- yields no row, so a caller who can somehow see an appointment but not the
-- person it belongs to gets nothing rather than a half-identified row. The
-- join to `tb_cases` is LEFT, because a BHW may legitimately see the
-- appointment and not the episode; `case_number` is then null, which is the
-- correct answer and not a missing one.
--
-- No `notes`, no `result`, no `contact_number`. A worklist needs to say which
-- patient, which day and how late — nothing clinical.
-- ---------------------------------------------------------------------------
create or replace function public.overdue_followups()
returns table (
  appointment_id       uuid,
  patient_id           uuid,
  patient_display_code text,
  scheduled_date       date,
  days_overdue         int,
  facility_id          uuid,
  referral_id          uuid,
  tb_case_id           uuid,
  case_number          text
)
language sql
stable
security invoker
set search_path = public
as $fn$
  select a.appointment_id,
         a.patient_id,
         p.display_code,
         a.scheduled_date,
         (public.manila_today() - a.scheduled_date)::int,
         a.facility_id,
         a.referral_id,
         a.tb_case_id,
         c.case_number
    from public.appointments a
    join public.patients  p on p.patient_id = a.patient_id
    left join public.tb_cases c on c.case_id = a.tb_case_id
   where public.appointment_is_overdue(a.status, a.scheduled_date)
   order by a.scheduled_date asc, a.appointment_id asc;
$fn$;

comment on function public.overdue_followups() is
  'Open appointments whose Manila day has passed, scoped by the caller''s own '
  'RLS (0034, Task 3.4). SECURITY INVOKER: a TB-DOTS account sees its own '
  'facility, a BHW sees their barangay''s patients, midwife and admin see '
  'nothing — all of that inherited from 0029/0031 rather than restated. '
  'OVERDUE IS NOT MISSED: this reports rows that need a human to look at them, '
  'and writes nothing.';


-- ---------------------------------------------------------------------------
-- 4. ACLs.
--
-- Supabase's default privileges grant EXECUTE to `anon` and `service_role` BY
-- NAME, and CREATE OR REPLACE preserves them, so `revoke ... from public`
-- alone leaves both standing (0019, M28-01). Name every one.
--
-- Both functions are SECURITY INVOKER, so a grant discloses nothing the
-- grantee's own policies do not already permit. They are still revoked from
-- anon and service_role: anon has no business calling either, and
-- service_role bypasses RLS, which would turn overdue_followups() into an
-- unscoped list of every open appointment in the system. The Edge Functions
-- hold service_role and do not need it.
-- ---------------------------------------------------------------------------
do $acl$
declare f text;
begin
  foreach f in array array[
    'public.appointment_is_overdue(text, date)',
    'public.overdue_followups()'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('revoke all on function %s from service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$acl$;


-- ============================================================================
-- POST-CHECKS (run separately — the SQL editor returns only the last result).
--
-- The behaviour matrix is supabase/tests/0034_overdue_detection_matrix.sql,
-- run through `node scripts/build-preflight.mjs 0034`. These are the
-- structural spot-checks the matrix cannot express as a persona question.
--
-- 1. Both functions exist, with the intended volatility and security:
--
--    select p.proname,
--           p.provolatile,   -- expect 's' (stable) for both
--           p.prosecdef      -- expect false for both
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.proname in ('appointment_is_overdue', 'overdue_followups');
--
-- 2. anon and service_role cannot execute either; authenticated can:
--
--    select p.proname,
--           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
--           has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_exec,
--           has_function_privilege('service_role',  p.oid, 'EXECUTE') as svc_exec
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.proname in ('appointment_is_overdue', 'overdue_followups');
--
--    Expect auth_exec true, anon_exec false, svc_exec false, for both.
--
-- 3. The partial index exists and is partial:
--
--    select indexname, indexdef from pg_indexes
--     where tablename = 'appointments' and indexname = 'appointments_open_schedule_idx';
--
--    Expect a definition containing WHERE (status = 'scheduled'::text).
--
-- 4. Nothing was mutated. This migration writes no row; the count of rows in
--    each appointment status must be unchanged across its application:
--
--    select status, count(*) from public.appointments group by status order by 1;
--
-- 5. How much work the new worklist actually surfaces, as the migration role
--    (which bypasses RLS, so this is the system-wide figure — no client sees
--    this number):
--
--    select count(*) from public.appointments a
--     where public.appointment_is_overdue(a.status, a.scheduled_date);
--
--    Read this before deciding anything about §4 of the design document. If it
--    is large, a future sweep is a bulk SMS event and must be staged.
-- ============================================================================
