-- ============================================================================
-- TB-Screen — 0033_appointment_upsert_compatibility.sql
--
-- The authenticated 0031 old-client gate found that every appointment upsert
-- stopped at table privileges. Migration 0031 granted UPDATE on the business
-- columns but a legacy whole-row payload also assigns appointment_id and
-- created_at in PostgREST's ON CONFLICT UPDATE clause. PostgreSQL requires
-- UPDATE privilege for every assigned column even when the incoming value is
-- identical, so the request never reached RLS or the ownership trigger.
--
-- Granting the two payload columns is safe only with an enforcement boundary:
-- appointment_id was already immutable; this migration also makes created_at
-- immutable. Identical retry values pass, real changes fail. Ownership columns
-- remain governed by enforce_appointment_ownership(), and tb_case_id remains
-- outside the client grant.
-- ============================================================================

do $guard$
begin
  if to_regprocedure('public.register_walkin(uuid,uuid,uuid,uuid,text,text,text,date,text,text,text,boolean,text,text,jsonb,text,numeric,numeric,numeric,integer,integer,integer,integer)') is null then
    raise exception '0033 requires migration 0032';
  end if;
  if to_regprocedure('public.enforce_appointment_ownership()') is null then
    raise exception '0033 requires migration 0031 appointment ownership';
  end if;
end;
$guard$;

drop trigger if exists appointments_immutable_columns on public.appointments;
create trigger appointments_immutable_columns
  before update on public.appointments
  for each row execute function public.enforce_immutable_columns(
    'appointment_id', 'patient_id', 'created_at'
  );

revoke update (appointment_id, created_at) on public.appointments from anon;
grant update (appointment_id, created_at) on public.appointments to authenticated;

comment on trigger appointments_immutable_columns on public.appointments is
  'Pins appointment_id, patient_id and created_at. UPDATE privilege on these '
  'columns exists only so whole-row PostgREST upsert retries can assign the '
  'same values; this trigger rejects any actual change (0033).';
