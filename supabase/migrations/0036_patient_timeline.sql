-- Patient care timeline: a read-time projection, never a second event store.
--
-- Privacy boundary: authenticated is only the transport role. The function
-- admits active TB-DOTS staff, then authorizes every source arm against the
-- caller's facility. It deliberately grants no BHW timeline; 0031's
-- bhw_case_summary() excludes treatment dates and outcomes, so exposing those
-- as timeline events would widen that reviewed boundary.

create or replace function public.patient_timeline(
  p_patient_id uuid,
  p_limit integer default 500
)
returns table (
  event_id text,
  event_type text,
  occurred_on date,
  occurred_at timestamptz,
  is_undated boolean,
  occurred_on_is_derived boolean,
  rank integer,
  actor_user_id uuid,
  actor_role text,
  facility_id uuid,
  facility_name text,
  case_id uuid,
  detail jsonb
)
language sql
stable
security definer
set search_path = public
as $fn$
with
caller as (
  select u.user_id, u.facility_id
    from public.users u
    join public.facilities f on f.facility_id = u.facility_id
   where u.user_id = auth.uid()
     and u.active
     and u.role = 'tb_dots'
     and f.type = 'tb_dots'
),
patient_visible as (
  -- This is the existing patients_tbdots_read boundary. Case ownership is
  -- deliberately absent: a transferred episode is authorized independently
  -- in the case arms, not used to widen the patient or pre-case history.
  select p.*
    from public.patients p
    cross join caller x
   where p.patient_id = p_patient_id
     and (
       p.enrolled_by = x.user_id
       or exists (
         select 1 from public.referrals r
          where r.patient_id = p.patient_id and r.facility_id = x.facility_id
       )
     )
),
events as (
  select 'patient_enrolled:' || p.patient_id::text as event_id,
         'patient_enrolled'::text as event_type,
         (p.created_at at time zone 'Asia/Manila')::date as occurred_on,
         p.created_at as occurred_at,
         false as is_undated,
         false as occurred_on_is_derived,
         10::integer as rank,
         p.enrolled_by as actor_user_id,
         u.role as actor_role,
         u.facility_id,
         f.name as facility_name,
         null::uuid as case_id,
         '{}'::jsonb as detail
    from patient_visible p
    left join public.users u on u.user_id = p.enrolled_by
    left join public.facilities f on f.facility_id = u.facility_id

  union all

  select 'screening_recorded:' || s.screening_id::text,
         'screening_recorded'::text,
         (s.created_at at time zone 'Asia/Manila')::date,
         s.created_at,
         false,
         false,
         20::integer,
         null::uuid,
         null::text,
         null::uuid,
         null::text,
         null::uuid,
         jsonb_build_object('referred', s.referred)
    from public.screenings s
    cross join caller x
   where s.patient_id = p_patient_id
     and (
       exists (
         select 1 from public.referrals r
          where r.screening_id = s.screening_id and r.facility_id = x.facility_id
       )
       or exists (
         select 1 from public.patients p
          where p.patient_id = s.patient_id and p.enrolled_by = x.user_id
       )
     )

  union all

  select 'referral_submitted:' || r.referral_id::text,
         'referral_submitted'::text,
         (r.created_at at time zone 'Asia/Manila')::date,
         r.created_at,
         false,
         false,
         30::integer,
         null::uuid,
         null::text,
         origin.facility_id,
         origin_facility.name,
         null::uuid,
         jsonb_build_object('facility_short_code', origin_facility.short_code)
    from public.referrals r
    cross join caller x
    left join lateral (
      select coalesce(
        nullif(a.changes -> 'facility_id' ->> 'from', '')::uuid,
        r.facility_id
      ) as facility_id
        from public.audit_logs a
       where a.entity_table = 'referrals'
         and a.entity_id = r.referral_id
         and a.changes ? 'facility_id'
       order by a.occurred_at asc, a.audit_id asc
       limit 1
    ) first_route on true
    cross join lateral (
      select coalesce(first_route.facility_id, r.facility_id) as facility_id
    ) origin
    left join public.facilities origin_facility on origin_facility.facility_id = origin.facility_id
   where r.patient_id = p_patient_id
     and r.facility_id = x.facility_id

  union all

  select 'referral_received:' || a.audit_id::text,
         'referral_received'::text,
         (a.occurred_at at time zone 'Asia/Manila')::date,
         a.occurred_at,
         false,
         false,
         40::integer,
         a.actor_user_id,
         a.actor_role,
         a.facility_id,
         f.name,
         null::uuid,
         '{}'::jsonb
    from public.audit_logs a
    cross join caller x
    left join public.facilities f on f.facility_id = a.facility_id
   where a.entity_table = 'referrals'
     and a.patient_id = p_patient_id
     and a.facility_id = x.facility_id
     and a.changes -> 'status' ->> 'to' = 'received'

  union all

  select 'referral_received:' || r.referral_id::text,
         'referral_received'::text,
         null::date,
         null::timestamptz,
         true,
         false,
         40::integer,
         null::uuid,
         null::text,
         r.facility_id,
         f.name,
         null::uuid,
         '{}'::jsonb
    from public.referrals r
    cross join caller x
    join public.facilities f on f.facility_id = r.facility_id
   where r.patient_id = p_patient_id
     and r.facility_id = x.facility_id
     and r.status in ('received', 'tested', 'closed')
     and not exists (
       select 1 from public.audit_logs a
        where a.entity_table = 'referrals'
          and a.entity_id = r.referral_id
          and a.changes -> 'status' ->> 'to' = 'received'
     )

  union all

  select 'lab_result_recorded:' || r.referral_id::text,
         'lab_result_recorded'::text,
         (r.result_date at time zone 'Asia/Manila')::date,
         r.result_date,
         false,
         false,
         50::integer,
         result_audit.actor_user_id,
         result_audit.actor_role,
         r.facility_id,
         f.name,
         null::uuid,
         '{}'::jsonb
    from public.referrals r
    cross join caller x
    join public.facilities f on f.facility_id = r.facility_id
    left join lateral (
      select a.actor_user_id, a.actor_role
        from public.audit_logs a
       where a.entity_table = 'referrals'
         and a.entity_id = r.referral_id
         and a.changes ? 'result_date'
       order by a.occurred_at desc, a.audit_id desc
       limit 1
    ) result_audit on true
   where r.patient_id = p_patient_id
     and r.facility_id = x.facility_id
     and r.result_date is not null

  union all

  select 'patient_did_not_present:' || a.audit_id::text,
         'patient_did_not_present'::text,
         (a.occurred_at at time zone 'Asia/Manila')::date,
         a.occurred_at,
         false,
         false,
         55::integer,
         a.actor_user_id,
         a.actor_role,
         a.facility_id,
         f.name,
         null::uuid,
         '{}'::jsonb
    from public.audit_logs a
    cross join caller x
    left join public.facilities f on f.facility_id = a.facility_id
   where a.entity_table = 'referrals'
     and a.patient_id = p_patient_id
     and a.facility_id = x.facility_id
     and a.changes -> 'presented' ->> 'to' = 'false'

  union all

  select 'patient_did_not_present:' || r.referral_id::text,
         'patient_did_not_present'::text,
         null::date,
         null::timestamptz,
         true,
         false,
         55::integer,
         null::uuid,
         null::text,
         r.facility_id,
         f.name,
         null::uuid,
         '{}'::jsonb
    from public.referrals r
    cross join caller x
    join public.facilities f on f.facility_id = r.facility_id
   where r.patient_id = p_patient_id
     and r.facility_id = x.facility_id
     and r.presented is false
     and not exists (
       select 1 from public.audit_logs a
        where a.entity_table = 'referrals'
          and a.entity_id = r.referral_id
          and a.changes -> 'presented' ->> 'to' = 'false'
     )

  union all

  select 'referral_closed:' || a.audit_id::text,
         'referral_closed'::text,
         (a.occurred_at at time zone 'Asia/Manila')::date,
         a.occurred_at,
         false,
         false,
         60::integer,
         a.actor_user_id,
         a.actor_role,
         a.facility_id,
         f.name,
         null::uuid,
         '{}'::jsonb
    from public.audit_logs a
    cross join caller x
    left join public.facilities f on f.facility_id = a.facility_id
   where a.entity_table = 'referrals'
     and a.patient_id = p_patient_id
     and a.facility_id = x.facility_id
     and a.changes -> 'status' ->> 'to' = 'closed'

  union all

  select 'referral_closed:' || r.referral_id::text,
         'referral_closed'::text,
         null::date,
         null::timestamptz,
         true,
         false,
         60::integer,
         null::uuid,
         null::text,
         r.facility_id,
         f.name,
         null::uuid,
         '{}'::jsonb
    from public.referrals r
    cross join caller x
    join public.facilities f on f.facility_id = r.facility_id
   where r.patient_id = p_patient_id
     and r.facility_id = x.facility_id
     and r.status = 'closed'
     and not exists (
       select 1 from public.audit_logs a
        where a.entity_table = 'referrals'
          and a.entity_id = r.referral_id
          and a.changes -> 'status' ->> 'to' = 'closed'
     )

  union all

  select 'case_registered:' || c.case_id::text,
         'case_registered'::text,
         c.registration_date,
         c.created_at,
         false,
         false,
         70::integer,
         c.created_by,
         u.role,
         c.facility_id,
         f.name,
         c.case_id,
         jsonb_build_object('case_number', c.case_number)
    from public.tb_cases c
    cross join caller x
    join public.facilities f on f.facility_id = c.facility_id
    left join public.users u on u.user_id = c.created_by
   where c.patient_id = p_patient_id and c.facility_id = x.facility_id

  union all

  select 'treatment_started:' || c.case_id::text,
         'treatment_started'::text,
         c.treatment_start_date,
         start_audit.occurred_at,
         false,
         false,
         80::integer,
         start_audit.actor_user_id,
         start_audit.actor_role,
         c.facility_id,
         f.name,
         c.case_id,
         '{}'::jsonb
    from public.tb_cases c
    cross join caller x
    join public.facilities f on f.facility_id = c.facility_id
    left join lateral (
      select a.occurred_at, a.actor_user_id, a.actor_role
        from public.audit_logs a
       where a.entity_table = 'tb_cases'
         and a.entity_id = c.case_id
         and a.changes -> 'case_status' ->> 'to' = 'on_treatment'
       order by a.occurred_at asc, a.audit_id asc
       limit 1
    ) start_audit on true
   where c.patient_id = p_patient_id
     and c.facility_id = x.facility_id
     and c.treatment_start_date is not null

  union all

  select 'appointment_scheduled:' || a.appointment_id::text,
         'appointment_scheduled'::text,
         (a.created_at at time zone 'Asia/Manila')::date,
         a.created_at,
         false,
         false,
         90::integer,
         null::uuid,
         null::text,
         a.facility_id,
         f.name,
         a.tb_case_id,
         jsonb_build_object('scheduled_date', a.scheduled_date)
    from public.appointments a
    cross join caller x
    left join public.facilities f on f.facility_id = a.facility_id
   where a.patient_id = p_patient_id and a.facility_id = x.facility_id

  union all

  select 'sms_sent:' || s.sms_id::text,
         'sms_sent'::text,
         (s.sent_at at time zone 'Asia/Manila')::date,
         s.sent_at,
         false,
         false,
         100::integer,
         null::uuid,
         'system'::text,
         a.facility_id,
         f.name,
         a.tb_case_id,
         jsonb_build_object('message_kind', s.message_kind, 'delivery_status', s.delivery_status)
    from public.sms_log s
    join public.appointments a on a.appointment_id = s.appointment_id
    cross join caller x
    left join public.facilities f on f.facility_id = a.facility_id
   where a.patient_id = p_patient_id and a.facility_id = x.facility_id

  union all

  select 'appointment_attended:' || a.appointment_id::text,
         'appointment_attended'::text,
         a.attended_date,
         null::timestamptz,
         false,
         false,
         110::integer,
         attend_audit.actor_user_id,
         attend_audit.actor_role,
         a.facility_id,
         f.name,
         a.tb_case_id,
         '{}'::jsonb
    from public.appointments a
    cross join caller x
    left join public.facilities f on f.facility_id = a.facility_id
    left join lateral (
      select al.actor_user_id, al.actor_role
        from public.audit_logs al
       where al.entity_table = 'appointments'
         and al.entity_id = a.appointment_id
         and al.changes -> 'status' ->> 'to' = 'attended'
       order by al.occurred_at desc, al.audit_id desc
       limit 1
    ) attend_audit on true
   where a.patient_id = p_patient_id
     and a.facility_id = x.facility_id
     and a.status = 'attended'
     and a.attended_date is not null

  union all

  select 'appointment_overdue:' || a.appointment_id::text,
         'appointment_overdue'::text,
         a.scheduled_date,
         null::timestamptz,
         false,
         true,
         114::integer,
         null::uuid,
         null::text,
         a.facility_id,
         f.name,
         a.tb_case_id,
         '{}'::jsonb
    from public.appointments a
    cross join caller x
    left join public.facilities f on f.facility_id = a.facility_id
   where a.patient_id = p_patient_id
     and a.facility_id = x.facility_id
     and public.appointment_is_overdue(a.status, a.scheduled_date)

  union all

  select 'appointment_missed:' || a.appointment_id::text,
         'appointment_missed'::text,
         a.scheduled_date,
         null::timestamptz,
         false,
         true,
         115::integer,
         miss_audit.actor_user_id,
         miss_audit.actor_role,
         a.facility_id,
         f.name,
         a.tb_case_id,
         '{}'::jsonb
    from public.appointments a
    cross join caller x
    left join public.facilities f on f.facility_id = a.facility_id
    left join lateral (
      select al.actor_user_id, al.actor_role
        from public.audit_logs al
       where al.entity_table = 'appointments'
         and al.entity_id = a.appointment_id
         and al.changes -> 'status' ->> 'to' = 'missed'
       order by al.occurred_at desc, al.audit_id desc
       limit 1
    ) miss_audit on true
   where a.patient_id = p_patient_id
     and a.facility_id = x.facility_id
     and a.status = 'missed'

  union all

  select 'appointment_cancelled:' || a.appointment_id::text,
         'appointment_cancelled'::text,
         coalesce((cancel_audit.occurred_at at time zone 'Asia/Manila')::date, a.scheduled_date),
         cancel_audit.occurred_at,
         false,
         cancel_audit.occurred_at is null,
         118::integer,
         cancel_audit.actor_user_id,
         cancel_audit.actor_role,
         a.facility_id,
         f.name,
         a.tb_case_id,
         '{}'::jsonb
    from public.appointments a
    cross join caller x
    left join public.facilities f on f.facility_id = a.facility_id
    left join lateral (
      select al.occurred_at, al.actor_user_id, al.actor_role
        from public.audit_logs al
       where al.entity_table = 'appointments'
         and al.entity_id = a.appointment_id
         and al.changes -> 'status' ->> 'to' = 'cancelled'
       order by al.occurred_at desc, al.audit_id desc
       limit 1
    ) cancel_audit on true
   where a.patient_id = p_patient_id
     and a.facility_id = x.facility_id
     and a.status = 'cancelled'

  union all

  select 'followup_recorded:' || tf.followup_id::text,
         'followup_recorded'::text,
         tf.visit_date,
         tf.created_at,
         false,
         false,
         120::integer,
         tf.recorded_by,
         u.role,
         c.facility_id,
         f.name,
         c.case_id,
         '{}'::jsonb
    from public.treatment_followups tf
    join public.tb_cases c on c.case_id = tf.case_id
    cross join caller x
    join public.facilities f on f.facility_id = c.facility_id
    left join public.users u on u.user_id = tf.recorded_by
   where c.patient_id = p_patient_id
     and c.facility_id = x.facility_id
     and tf.voided_at is null

  union all

  select 'case_status_changed:' || a.audit_id::text,
         'case_status_changed'::text,
         (a.occurred_at at time zone 'Asia/Manila')::date,
         a.occurred_at,
         false,
         false,
         130::integer,
         a.actor_user_id,
         a.actor_role,
         a.facility_id,
         f.name,
         a.entity_id,
         jsonb_build_object(
           'from_status', a.changes -> 'case_status' -> 'from',
           'to_status', a.changes -> 'case_status' -> 'to'
         )
    from public.audit_logs a
    cross join caller x
    left join public.facilities f on f.facility_id = a.facility_id
   where a.entity_table = 'tb_cases'
     and a.patient_id = p_patient_id
     and a.facility_id = x.facility_id
     and a.action = 'status_changed'
     and a.changes ? 'case_status'

  union all

  select 'case_transferred:' || a.audit_id::text,
         'case_transferred'::text,
         (a.occurred_at at time zone 'Asia/Manila')::date,
         a.occurred_at,
         false,
         false,
         140::integer,
         a.actor_user_id,
         a.actor_role,
         a.facility_id,
         f.name,
         a.entity_id,
         '{}'::jsonb
    from public.audit_logs a
    cross join caller x
    left join public.facilities f on f.facility_id = a.facility_id
   where a.entity_table = 'tb_cases'
     and a.patient_id = p_patient_id
     and a.facility_id = x.facility_id
     and a.action = 'transferred'

  union all

  select 'case_closed:' || c.case_id::text,
         'case_closed'::text,
         c.outcome_date,
         close_audit.occurred_at,
         false,
         false,
         150::integer,
         close_audit.actor_user_id,
         close_audit.actor_role,
         c.facility_id,
         f.name,
         c.case_id,
         jsonb_build_object('outcome', c.outcome)
    from public.tb_cases c
    cross join caller x
    join public.facilities f on f.facility_id = c.facility_id
    left join lateral (
      select a.occurred_at, a.actor_user_id, a.actor_role
        from public.audit_logs a
       where a.entity_table = 'tb_cases'
         and a.entity_id = c.case_id
         and a.changes -> 'case_status' ->> 'to' = 'closed'
       order by a.occurred_at desc, a.audit_id desc
       limit 1
    ) close_audit on true
   where c.patient_id = p_patient_id
     and c.facility_id = x.facility_id
     and c.case_status = 'closed'
     and c.outcome_date is not null
)
select e.event_id, e.event_type, e.occurred_on, e.occurred_at,
       e.is_undated, e.occurred_on_is_derived, e.rank,
       e.actor_user_id, e.actor_role, e.facility_id, e.facility_name,
       e.case_id, e.detail
  from events e
 order by e.is_undated asc,
          e.occurred_on asc nulls last,
          e.rank asc,
          e.occurred_at asc nulls last,
          e.event_id asc
 limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$fn$;

revoke all on function public.patient_timeline(uuid, integer) from public;
revoke all on function public.patient_timeline(uuid, integer) from anon;
revoke all on function public.patient_timeline(uuid, integer) from service_role;
grant execute on function public.patient_timeline(uuid, integer) to authenticated;

comment on function public.patient_timeline(uuid, integer) is
  'Facility-scoped patient care timeline (0036). Read-time projection only; '
  'active TB-DOTS callers only. Each source arm is authorized independently. '
  'Never returns clinical free text, contact data, symptom flags, result values, '
  'or voided follow-ups. Referral transition dates are forward-only from 0035; '
  'older state is explicitly undated. Overdue is derived and distinct from missed.';
