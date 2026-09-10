-- Facility attention dashboard: one aggregate read for today's activity,
-- factual work queues, and all-time program counts.
--
-- This function deliberately returns counts only. It does not rank patients,
-- infer a diagnosis, or compute a risk score. Derived overdue appointments
-- remain distinct from staff-recorded missed appointments (0034).

create or replace function public.facility_dashboard_overview()
returns table (
  screened_today bigint,
  referred_today bigint,
  positive_today bigint,
  negative_today bigint,
  attended_today bigint,
  missed_today bigint,
  scheduled_today bigint,
  attention_overdue_followups bigint,
  attention_missed_followups bigint,
  attention_due_soon bigint,
  attention_referrals_awaiting bigint,
  attention_stale_cases bigint,
  attention_appointments_today bigint,
  metric_screened bigint,
  metric_referred bigint,
  metric_referral_received bigint,
  metric_cases_created bigint,
  metric_active_treatment_cases bigint,
  metric_followups_due bigint,
  metric_missed_followups bigint,
  metric_closed_cases bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
with
caller as (
  select u.facility_id
    from public.users u
    join public.facilities f on f.facility_id = u.facility_id
   where u.user_id = auth.uid()
     and u.active
     and u.role = 'tb_dots'
     and f.type = 'tb_dots'
),
clock as (
  select public.manila_today() as today,
         public.manila_day_start(public.manila_today()) as day_start,
         public.manila_day_start(public.manila_today() + 1) as day_next
),
active_cases as (
  select c.*
    from public.tb_cases c
    join caller x on x.facility_id = c.facility_id
   where c.case_status in ('registered', 'on_treatment', 'interrupted')
),
unresolved_missed as (
  select a.appointment_id, a.tb_case_id
    from public.appointments a
    join active_cases c on c.case_id = a.tb_case_id
   where a.status = 'missed'
     and not exists (
       select 1
         from public.appointments later
        where later.tb_case_id = a.tb_case_id
          and later.scheduled_date > a.scheduled_date
          and later.status in ('scheduled', 'attended')
     )
)
select
  -- A screening has no receiving-facility column. Count it for this facility
  -- only when its referral supplies that relationship; distinct protects the
  -- metric if a screening is ever routed more than once.
  (select count(distinct s.screening_id)
     from public.screenings s
     join public.referrals r on r.screening_id = s.screening_id
     join caller x on x.facility_id = r.facility_id
     cross join clock d
    where s.created_at >= d.day_start and s.created_at < d.day_next),
  (select count(*)
     from public.referrals r join caller x on x.facility_id = r.facility_id cross join clock d
    where r.created_at >= d.day_start and r.created_at < d.day_next),
  (select count(*)
     from public.referrals r join caller x on x.facility_id = r.facility_id cross join clock d
    where r.result_outcome = 'positive'
      and r.result_date >= d.day_start and r.result_date < d.day_next),
  (select count(*)
     from public.referrals r join caller x on x.facility_id = r.facility_id cross join clock d
    where r.result_outcome = 'negative'
      and r.result_date >= d.day_start and r.result_date < d.day_next),
  (select count(*)
     from public.appointments a join caller x on x.facility_id = a.facility_id cross join clock d
    where a.scheduled_date = d.today and a.status = 'attended'),
  (select count(*)
     from public.appointments a join caller x on x.facility_id = a.facility_id cross join clock d
    where a.scheduled_date = d.today and a.status = 'missed'),
  (select count(*)
     from public.appointments a join caller x on x.facility_id = a.facility_id cross join clock d
    where a.scheduled_date = d.today),

  -- Attention queues are active-case work only. Referral intake is the one
  -- pre-case queue. Due soon starts tomorrow because today has its own card.
  (select count(distinct a.tb_case_id)
     from public.appointments a join active_cases c on c.case_id = a.tb_case_id cross join clock d
    where a.status = 'scheduled' and a.scheduled_date < d.today),
  (select count(distinct tb_case_id) from unresolved_missed),
  (select count(distinct a.tb_case_id)
     from public.appointments a join active_cases c on c.case_id = a.tb_case_id cross join clock d
    where a.status = 'scheduled'
      and a.scheduled_date between d.today + 1 and d.today + 7),
  (select count(*)
     from public.referrals r join caller x on x.facility_id = r.facility_id
    where r.status in ('submitted', 'received')),
  (select count(*)
     from active_cases c cross join clock d
    where c.registration_date < d.today - 30
      and not exists (
        select 1 from public.treatment_followups tf
         where tf.case_id = c.case_id
           and tf.voided_at is null
           and tf.visit_date >= d.today - 30
      )),
  (select count(distinct a.tb_case_id)
     from public.appointments a join active_cases c on c.case_id = a.tb_case_id cross join clock d
    where a.status = 'scheduled' and a.scheduled_date = d.today),

  -- Program metrics are current, facility-scoped operational totals. A
  -- referral in received/tested/closed has reached the facility; this is not
  -- presented as a historical transition count because older rows predate the
  -- forward audit trail added in 0035.
  (select count(distinct s.screening_id)
     from public.screenings s
     join public.referrals r on r.screening_id = s.screening_id
     join caller x on x.facility_id = r.facility_id),
  (select count(*) from public.referrals r join caller x on x.facility_id = r.facility_id),
  (select count(*)
     from public.referrals r join caller x on x.facility_id = r.facility_id
    where r.status in ('received', 'tested', 'closed')),
  (select count(*) from public.tb_cases c join caller x on x.facility_id = c.facility_id),
  (select count(*)
     from public.tb_cases c join caller x on x.facility_id = c.facility_id
    where c.case_status in ('on_treatment', 'interrupted')),
  (select count(*)
     from public.appointments a join active_cases c on c.case_id = a.tb_case_id cross join clock d
    where a.status = 'scheduled' and a.scheduled_date <= d.today),
  (select count(*) from unresolved_missed),
  (select count(*)
     from public.tb_cases c join caller x on x.facility_id = c.facility_id
    where c.case_status = 'closed')
from caller authorized;
$fn$;

comment on function public.facility_dashboard_overview() is
  'One-row facility dashboard for active TB-DOTS staff (0037): today activity, '
  'factual attention queues, and current program totals. Counts only. OVERDUE '
  'is derived from an open past appointment and remains distinct from MISSED, '
  'which staff assert. No patient ranking, diagnosis inference, or risk score.';

revoke all on function public.facility_dashboard_overview() from public;
revoke all on function public.facility_dashboard_overview() from anon;
revoke all on function public.facility_dashboard_overview() from service_role;
grant execute on function public.facility_dashboard_overview() to authenticated;

-- Referral queue counts use facility + current status. Existing case,
-- appointment, and follow-up indexes already cover the other query arms.
create index if not exists referrals_facility_status_idx
  on public.referrals (facility_id, status);
