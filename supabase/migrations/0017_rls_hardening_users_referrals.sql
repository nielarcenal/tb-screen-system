-- ============================================================================
-- TB-Screen — 0017_rls_hardening_users_referrals.sql
-- Two RLS/grant gaps found in the August 2026 audit. No schema change, no data
-- change — privileges and policies only.
--
-- 1. users: a signed-in account could rewrite ANY column of its own row.
--    The users_update_self policy (0002) correctly restricts WHICH ROW may be
--    updated (user_id = auth.uid()), but RLS cannot restrict WHICH COLUMNS.
--    A BHW could therefore PATCH their own row and set role = 'admin' or
--    move facility_id, escalating straight past every role check in the app.
--    Fix: revoke blanket UPDATE from `authenticated` and grant it back on the
--    single column a client legitimately writes — assigned_barangay_code,
--    pushed by mobile Settings (syncManager.pushAssignedBarangayIfDirty).
--    Every other write to public.users goes through the manage-bhw Edge
--    Function on the SERVICE ROLE key, which bypasses grants and RLS, so
--    provisioning, edits, deactivation and password resets are unaffected.
--    The users_update_self policy STAYS: grants and RLS are ANDed, and the
--    policy is still what stops one account writing another's barangay.
--
-- 2. referrals: had BHW read and insert policies but NO update policy, while
--    the mobile sync engine pushes referrals with upsert(onConflict:
--    referral_id). The upsert's conflict path is reached whenever a referral
--    INSERT lands on the server but the reply is lost, so the row stays
--    sync_status='pending' and is retried. That retry is rejected by RLS, and
--    syncEngine throws on the first row failure — so one interrupted referral
--    push stalls ALL syncing for that BHW until the app data is cleared.
--    Fix: a deliberately NARROW update policy. It is NOT a mirror of
--    referrals_bhw_insert: mirroring would let any BHW overwrite a result the
--    TB-DOTS facility had already recorded. The mobile app has no code path
--    that edits a referral after creation (referralsRepo has no update fn —
--    insertLocalReferral is the only writer), so the only update a BHW ever
--    needs is re-writing a still-untouched row with the same values.
--      USING      gates the OLD row — the facility has not acted on it yet.
--      WITH CHECK gates the NEW row — the BHW cannot record a result or
--                 advance the status themselves.
--    referrals_tbdots_update (0002) is untouched; facilities keep full control
--    of status/result/result_date/presented.
--
-- POSITIONING (§1) unchanged: no scoring, no diagnostic field, no new data.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. users — column-scoped UPDATE for clients.
-- ---------------------------------------------------------------------------
revoke update on public.users from authenticated;
grant  update (assigned_barangay_code) on public.users to authenticated;

comment on policy users_update_self on public.users is
  'A user may update only their own row. Which COLUMNS they may write is set '
  'by the column grant in 0017 (assigned_barangay_code only) — RLS cannot '
  'express that on its own. All other writes use the service role.';

-- ---------------------------------------------------------------------------
-- 2. referrals — narrow BHW UPDATE, for the interrupted-push retry only.
-- ---------------------------------------------------------------------------
drop policy if exists referrals_bhw_update on public.referrals;
create policy referrals_bhw_update on public.referrals
  for update to authenticated
  using (
    public.current_user_role() = 'bhw'
    and patient_id in (select public.bhw_visible_patient_ids())
    -- Still exactly as the BHW submitted it: the facility has not received,
    -- tested or closed it, and no result has been recorded.
    and status = 'submitted'
    and result is null
    and result_date is null
    and presented is null
  )
  with check (
    public.current_user_role() = 'bhw'
    and patient_id in (select public.bhw_visible_patient_ids())
    -- ...and it must stay that way. A BHW cannot record or fabricate a result.
    and status = 'submitted'
    and result is null
    and result_date is null
    and presented is null
  );

comment on policy referrals_bhw_update on public.referrals is
  'Retry path only: lets a BHW re-push a referral whose INSERT reply was lost. '
  'Deliberately narrower than referrals_bhw_insert — a referral the facility '
  'has already acted on is out of scope, and the BHW can never write a result.';
