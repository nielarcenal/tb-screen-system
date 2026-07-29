-- ============================================================================
-- TB-Screen BHW — 0015_sms_language_and_kinds.sql
-- Improve SMS reminders (Feature 9): send each patient a reminder in THEIR
-- language, and distinguish a day-of reminder from a missed-appointment follow-up.
--
-- 1. patients.preferred_language — the language a patient's SMS reminders use
--    (en/tl/ceb), captured at enrollment on the SMS opt-in card. Nullable: rows
--    enrolled before this migration (and patients who declined SMS) have none,
--    and the reminder function falls back to a combined English+Tagalog message.
--
-- 2. sms_log.message_kind — 'reminder' (a scheduled check-up is coming up) vs
--    'follow_up' (the patient missed a check-up). Kept separate so the two never
--    collide in the idempotency check and can be reported/counted independently.
--    Defaults to 'reminder' so existing rows keep their meaning.
--
-- POSITIONING (§1/§4) unchanged: language + a message kind are delivery metadata.
-- The message text stays neutral — no "TB", no patient details (SMS is readable
-- by anyone holding the phone).
-- ============================================================================

alter table public.patients
  add column if not exists preferred_language text
    check (preferred_language is null or preferred_language in ('en', 'tl', 'ceb'));

comment on column public.patients.preferred_language is
  'Language for this patient''s SMS reminders (en/tl/ceb). Null = not captured '
  '(pre-0015 or SMS declined); the reminder function then sends a combined message.';

alter table public.sms_log
  add column if not exists message_kind text not null default 'reminder'
    check (message_kind in ('reminder', 'follow_up'));

comment on column public.sms_log.message_kind is
  'reminder = upcoming check-up notice; follow_up = missed-appointment nudge. '
  'Separates the two so reminder idempotency and follow-up idempotency are distinct.';
