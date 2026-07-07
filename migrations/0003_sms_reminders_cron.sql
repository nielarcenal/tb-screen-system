-- ============================================================================
-- TB-Screen BHW — 0003_sms_reminders_cron.sql
-- Feature 9: daily schedule for the sms-reminders Edge Function (brief §8.9).
--
-- ⚠️  FILL IN THE THREE PLACEHOLDERS BEFORE RUNNING — and do NOT commit the
--     filled-in values (same rule as .env, brief §9):
--       <PROJECT_REF>   your Supabase project ref (dashboard URL / Settings→API)
--       <ANON_KEY>      the anon public key (passes the platform JWT check;
--                       the real gate is CRON_SECRET, verified in the function)
--       <CRON_SECRET>   the same value you set with:
--                       supabase secrets set CRON_SECRET=...
--
-- Schedule: 01:00 UTC = 09:00 Asia/Manila (pg_cron runs in UTC). The function
-- itself computes "tomorrow" in Asia/Manila, so the exact hour only affects
-- when patients receive the text, not which appointments are picked.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent re-run: drop an existing job with the same name first.
do $$
begin
  perform cron.unschedule('sms-reminders-daily')
  where exists (select 1 from cron.job where jobname = 'sms-reminders-daily');
end;
$$;

select cron.schedule(
  'sms-reminders-daily',
  '0 1 * * *',  -- 01:00 UTC daily = 09:00 Asia/Manila
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/sms-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <ANON_KEY>',
      'X-Cron-Secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);
