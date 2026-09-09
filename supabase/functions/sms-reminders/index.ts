/**
 * sms-reminders — Supabase Edge Function (Feature 9, brief §8.9).
 *
 * Runs daily (pg_cron, see migrations/0003_sms_reminders_cron.sql) and does two
 * things, both only for patients who opted into SMS (sms_consent = true):
 *
 *   1. REMINDERS — for check-ups still 'scheduled' that fall on one of the lead
 *      days ahead (REMINDER_OFFSETS, Asia/Manila): 5 days out AND the morning of
 *      the appointment itself. Idempotent per day: an appointment gets at most
 *      one reminder per calendar day, so re-runs never double-send and the
 *      5-day / same-day reminders (on different days) both go out.
 *   2. FOLLOW-UPS — for check-ups recently marked 'missed' (updated in the last
 *      FOLLOWUP_WINDOW_DAYS), a neutral nudge to reschedule — UNLESS the patient
 *      already has an upcoming 'scheduled' appointment (rebooked; UPCOMING means
 *      dated today or later, not merely still carrying that status). Sent once,
 *      except that a FAILED send — or a reservation abandoned by a run that
 *      died mid-send — is retried up to FOLLOWUP_MAX_ATTEMPTS.
 *
 * Every send is RESERVED in sms_log before the gateway is called, then settled to
 * its outcome afterwards — see sendLogged(). A text cannot be un-sent, so the
 * record has to exist first.
 *
 * Each patient is messaged in THEIR language (patients.preferred_language, 0015);
 * when unset (pre-0015 / SMS declined path) a combined English+Tagalog message is
 * sent. Every send is logged to sms_log with message_kind ('reminder'|'follow_up').
 *
 * PRIVACY (§4):
 *  - Only sms_consent = true patients are queried; the DB CHECK guarantees a
 *    contact_number exists only alongside consent.
 *  - Message text is NEUTRAL — no "TB", no patient details — SMS is readable by
 *    anyone holding the phone.
 *  - Service role (bypasses RLS): this function is the ONLY writer of sms_log.
 *
 * Auth: callers must present X-Cron-Secret matching the CRON_SECRET secret.
 *
 * Secrets (supabase secrets set ...):
 *   CRON_SECRET            required — shared secret for the cron caller
 *   SMS_GATEWAY            'stub' (default) | 'semaphore' | 'textbee'
 *   SEMAPHORE_API_KEY      required when SMS_GATEWAY=semaphore
 *   SEMAPHORE_SENDER_NAME  REQUIRED in practice when SMS_GATEWAY=semaphore.
 *                          Optional to the code, not to Semaphore: without an
 *                          APPROVED sender name every send is rejected with
 *                          HTTP 500 'No active sender name found'. Max 11
 *                          alphanumeric chars and must not contain 'TB' or
 *                          'DOTS' (§4).
 *   TEXTBEE_API_KEY        required when SMS_GATEWAY=textbee
 *   TEXTBEE_DEVICE_ID      optional; only needed once the TextBee account has
 *                          more than one registered device.
 *
 * Set SMS_GATEWAY together with its provider key — SMS_GATEWAY alone logs an
 * error and silently falls back to the stub (gateway.ts).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

import { createGateway, type SendOutcome } from './gateway.ts';
import {
  classifyFollowUpLogs,
  resolveAppointmentFacilityIds,
  SMS_FOLLOWUP_STATUS,
  SMS_REMINDER_STATUS,
  shouldFollowUp,
  shouldRemind,
  staleQueuedCutoff,
  type SmsLogRow,
} from '../_shared/selection.ts';

/**
 * Lead days before a check-up on which to remind (Asia/Manila).
 *
 * 0 means the morning of the appointment — the cron fires at 09:00 Manila, so a
 * same-day reminder lands before a normal clinic day starts. It is the reliable
 * one: it depends only on the booking existing before 09:00 that morning, which
 * for a date chosen days earlier it always does.
 *
 * 5 is the advance notice, and it is the one that is easy to miss. The run
 * matches scheduled_date EXACTLY, once a day, so an appointment booked less than
 * five clear days out — or booked on the five-day mark after 09:00 — never hits
 * that offset and the patient gets the same-day reminder only. That is by
 * design (the same-day one is the backstop), but it means the honest claim is
 * "UP TO two reminders", never "reminders at 5 days and on the day".
 */
const REMINDER_OFFSETS = [5, 0];
/** Only follow up on check-ups marked missed within this many days. */
const FOLLOWUP_WINDOW_DAYS = 14;
/**
 * Give up on a missed check-up after this many FAILED follow-up attempts.
 *
 * Uncapped, a dead number is retried on every run for the whole window — ~14
 * paid sends — and each retry is another chance to duplicate a message that did
 * arrive but was reported failed. Three rides out a gateway outage and is cheap
 * enough to be wrong about.
 */
const FOLLOWUP_MAX_ATTEMPTS = 3;

type Lang = 'en' | 'tl' | 'ceb';
// Neutral signature — no "TB" (§4: SMS is readable by anyone holding the phone).
const SIGN = '- Health Reminder';

// Localized FULL weekday + month names. Deno's Intl has no reliable Cebuano data,
// so map them explicitly (like the rest of the app's i18n). Index 0 = Sunday / January.
const WEEKDAYS: Record<Lang, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  tl: ['Linggo', 'Lunes', 'Martes', 'Miyerkoles', 'Huwebes', 'Biyernes', 'Sabado'],
  ceb: ['Dominggo', 'Lunes', 'Martes', 'Miyerkules', 'Huwebes', 'Biyernes', 'Sabado'],
};
const MONTHS: Record<Lang, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  tl: ['Enero', 'Pebrero', 'Marso', 'Abril', 'Mayo', 'Hunyo', 'Hulyo', 'Agosto', 'Setyembre', 'Oktubre', 'Nobyembre', 'Disyembre'],
  ceb: ['Enero', 'Pebrero', 'Marso', 'Abril', 'Mayo', 'Hunyo', 'Hulyo', 'Agosto', 'Septyembre', 'Oktubre', 'Nobyembre', 'Disyembre'],
};

/** "Weekday, Month D, YYYY" in the given language, from a YYYY-MM-DD string. */
function formatDate(lang: Lang, iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[lang][dow]}, ${MONTHS[lang][m - 1]} ${d}, ${y}`;
}

/** Drop the TB-identifying "DOTS" token so the SMS names the place without outing the patient (§4). */
function neutralFacility(name: string): string {
  return name.replace(/\bDOTS\b/gi, '').replace(/\s{2,}/g, ' ').trim();
}

/** Enriched neutral reminder: weekday + full date + where to go. */
function buildReminder(lang: Lang, iso: string, facility: string | null): string {
  const when = formatDate(lang, iso);
  const at = facility ? (lang === 'en' ? ` at ${facility}` : ` sa ${facility}`) : '';
  if (lang === 'en') return `Reminder: it's important to go to your health check-up on ${when}${at}. Please don't miss it. ${SIGN}`;
  if (lang === 'tl') return `Paalala: mahalagang pumunta sa inyong health check-up sa ${when}${at}. Huwag pong kalimutan. ${SIGN}`;
  return `Pahinumdom: importante nga moadto ka sa imong health check-up sa ${when}${at}. Palihug ayaw kalimti. ${SIGN}`;
}

/** Neutral missed-appointment follow-up per language. */
const FOLLOWUP: Record<Lang, () => string> = {
  en: () => `You missed your health check-up. Please visit your health worker to set a new date. ${SIGN}`,
  tl: () => `Hindi kayo nakadalo sa inyong health check-up. Pakibisita ang inyong health worker para sa bagong petsa. ${SIGN}`,
  ceb: () => `Wala ka nakatambong sa imong health check-up. Palihug bisitaha ang imong health worker para sa bag-ong petsa. ${SIGN}`,
};

function asLang(l: string | null | undefined): Lang | null {
  return l === 'en' || l === 'tl' || l === 'ceb' ? l : null;
}
function reminderMessage(lang: Lang | null, iso: string, facility: string | null): string {
  return lang
    ? buildReminder(lang, iso, facility)
    : `${buildReminder('en', iso, facility)} / ${buildReminder('tl', iso, facility)}`;
}
function followUpMessage(lang: Lang | null): string {
  return lang ? FOLLOWUP[lang]() : `${FOLLOWUP.en()} / ${FOLLOWUP.tl()}`;
}

/** Calendar date in Asia/Manila, offset by N days (en-CA ⇒ YYYY-MM-DD). */
function manilaDate(offsetDays: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

interface ApptRow {
  appointment_id: string;
  patient_id: string;
  facility_id: string | null;
  scheduled_date: string;
  patients: { contact_number: string | null; preferred_language: string | null };
}

Deno.serve(async (req) => {
  // --- auth: shared secret from the cron job (or a manual test call) ---
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, // service role: server-side only
  );
  const gateway = createGateway(Deno.env);

  const fail = (msg: string) => {
    console.error(`[sms-reminders] ${msg}`);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  };

  /**
   * Send one message, recording the attempt BEFORE the gateway is called.
   *
   * The obvious order — send, then log — loses the record whenever the insert
   * fails, and the next run re-sends a message the patient already received. A
   * text cannot be un-sent, so a log failure discovered afterwards has no remedy
   * at all; the only place a hard stop can work is before the send.
   *
   * So reserve first: insert a 'queued' row (that value has been the column's
   * own default and permitted by its CHECK since 0001, and was never once used),
   * and if THAT insert fails, skip the row WITHOUT sending. Then send. Then
   * settle the row to the real outcome.
   *
   * A crash between the reserve and the settle leaves a 'queued' row behind
   * that nothing will ever settle, because the next run is a fresh invocation
   * with no memory of it. Within one calendar day that is the intended
   * outcome for a REMINDER — a missed nudge is cheaper than a duplicate one,
   * and the BHW still sees the patient in the app either way.
   *
   * For a FOLLOW-UP it was not, and that was the bug: nothing bounds how long
   * the row suppresses the nudge, so one crashed run retired it permanently.
   * classifyFollowUpLogs() now ages those reservations out — see
   * _shared/selection.ts, which explains why they are aged at read time
   * rather than swept with an UPDATE.
   *
   * sms_log.sent_at therefore stamps the ATTEMPT, not the delivery. The two
   * differ by one gateway round-trip, and the reminder idempotency window is a
   * whole calendar day, so nothing depends on the distinction.
   */
  const sendLogged = async (
    appointmentId: string,
    kind: 'reminder' | 'follow_up',
    number: string,
    message: string,
  ): Promise<SendOutcome | 'unreserved'> => {
    const { data: reserved, error: resErr } = await supabase
      .from('sms_log')
      .insert({ appointment_id: appointmentId, delivery_status: 'queued', message_kind: kind })
      .select('sms_id')
      .single();
    if (resErr || !reserved) {
      console.error(
        `[sms-reminders] ${kind} reserve failed, NOT sending: ${resErr?.message ?? 'no row returned'}`,
      );
      return 'unreserved';
    }

    const outcome = await gateway.send(number, message);

    const { error: updErr } = await supabase
      .from('sms_log')
      .update({ delivery_status: outcome })
      .eq('sms_id', reserved.sms_id);
    // The message has already gone; the row simply stays 'queued', which reads
    // as handled. There is nothing to roll back — log it and move on.
    if (updErr) console.error(`[sms-reminders] ${kind} settle to '${outcome}' failed: ${updErr.message}`);
    return outcome;
  };

  // ======================= 1. REMINDERS =======================
  const reminderDates = REMINDER_OFFSETS.map(manilaDate);
  const todayMidnight = `${manilaDate(0)}T00:00:00+08:00`; // start of today, Manila
  const rem = { dates: reminderDates, due: 0, sent: 0, failed: 0, skipped: 0 };

  const { data: dueData, error: dueErr } = await supabase
    .from('appointments')
    .select('appointment_id, patient_id, facility_id, scheduled_date, patients!inner(contact_number, sms_consent, preferred_language)')
    .eq('status', SMS_REMINDER_STATUS)
    .in('scheduled_date', reminderDates)
    .eq('patients.sms_consent', true);
  if (dueErr) return fail(`reminder query failed: ${dueErr.message}`);
  const due = (dueData ?? []) as unknown as ApptRow[];
  rem.due = due.length;

  // Skip appointments already reminded TODAY (idempotent same-day re-runs; the
  // 5-day and same-day reminders land on different days, so both still go out).
  // ANY attempt counts here, a 'failed' one included — unlike the follow-up
  // path below, which retries failures. A reminder is anchored to a date: the
  // cron runs once a day, so retrying would mean the next offset day regardless,
  // and the same-day reminder is already the backstop for a 5-day one that
  // missed. Note the same-day offset has no backstop of its own — it IS the
  // last one — so a failure there is the end of the line for that appointment.
  const remindedToday = new Set<string>();
  if (due.length > 0) {
    const { data: logged, error: logErr } = await supabase
      .from('sms_log')
      .select('appointment_id')
      .in('appointment_id', due.map((a) => a.appointment_id))
      .eq('message_kind', 'reminder')
      .gte('sent_at', todayMidnight);
    if (logErr) return fail(`reminder sms_log lookup failed: ${logErr.message}`);
    for (const r of logged ?? []) remindedToday.add(r.appointment_id as string);
  }

  // The appointment owns its destination (0031). Only legacy NULL rows fall
  // back to the newest referral; a later referral cannot redirect this visit.
  const facilityByAppointment = new Map<string, string | null>();
  if (due.length > 0) {
    const legacyPids = [...new Set(due.filter((a) => !a.facility_id).map((a) => a.patient_id))];
    let refs: { patient_id: string; facility_id: string }[] = [];
    if (legacyPids.length > 0) {
      const { data, error: refErr } = await supabase
        .from('referrals')
        .select('patient_id, facility_id, created_at')
        .in('patient_id', legacyPids)
        .order('created_at', { ascending: false });
      if (refErr) return fail(`referral lookup failed: ${refErr.message}`);
      refs = (data ?? []) as { patient_id: string; facility_id: string }[];
    }
    const ids = resolveAppointmentFacilityIds(due, refs);
    const fids = [...new Set([...ids.values()].filter((id): id is string => !!id))];
    const nameByFacility = new Map<string, string>();
    if (fids.length > 0) {
      const { data: facs, error: facErr } = await supabase
        .from('facilities')
        .select('facility_id, name')
        .in('facility_id', fids);
      if (facErr) return fail(`facility lookup failed: ${facErr.message}`);
      for (const f of facs ?? []) nameByFacility.set(f.facility_id as string, neutralFacility(f.name as string));
    }
    for (const [appointmentId, facilityId] of ids) {
      facilityByAppointment.set(
        appointmentId,
        facilityId ? nameByFacility.get(facilityId) ?? null : null,
      );
    }
  }

  for (const a of due) {
    const candidate = {
      appointment_id: a.appointment_id,
      contact_number: a.patients.contact_number,
    };
    if (!shouldRemind(candidate, remindedToday)) {
      rem.skipped++;
      continue;
    }
    const outcome = await sendLogged(
      a.appointment_id,
      'reminder',
      a.patients.contact_number,
      reminderMessage(
        asLang(a.patients.preferred_language),
        a.scheduled_date,
        facilityByAppointment.get(a.appointment_id) ?? null,
      ),
    );
    if (outcome === 'unreserved') rem.skipped++;
    else if (outcome === 'failed') rem.failed++;
    else rem.sent++;
  }

  // ======================= 2. MISSED FOLLOW-UPS =======================
  const windowStart = new Date(Date.now() - FOLLOWUP_WINDOW_DAYS * 86_400_000).toISOString();
  const fup = {
    window_days: FOLLOWUP_WINDOW_DAYS,
    max_attempts: FOLLOWUP_MAX_ATTEMPTS,
    candidates: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    /** Reservations aged out this run — a crash between reserve and settle.
     *  Non-zero means runs are dying mid-send; worth watching in the logs. */
    abandoned: 0,
  };

  const { data: missedData, error: missedErr } = await supabase
    .from('appointments')
    .select('appointment_id, patient_id, facility_id, scheduled_date, patients!inner(contact_number, sms_consent, preferred_language)')
    .eq('status', SMS_FOLLOWUP_STATUS)
    .gte('updated_at', windowStart)
    .eq('patients.sms_consent', true);
  if (missedErr) return fail(`missed query failed: ${missedErr.message}`);
  const missed = (missedData ?? []) as unknown as ApptRow[];
  fup.candidates = missed.length;

  if (missed.length > 0) {
    const apptIds = missed.map((a) => a.appointment_id);
    const patientIds = [...new Set(missed.map((a) => a.patient_id))];

    // Already followed up. DONE means a settled, non-failed row — 'sent' or
    // 'stubbed' — plus a 'queued' reservation young enough that the run which
    // made it may still be mid-send. A failed attempt is NOT done: treating it
    // as done let a single gateway hiccup retire the nudge permanently, while
    // retrying failures freely would burn a send a day on a dead number, so
    // they are counted and capped at FOLLOWUP_MAX_ATTEMPTS instead.
    //
    // sent_at is selected for the age test: a 'queued' row older than the
    // cutoff belongs to a run that died between reserve and settle and will
    // never be settled by anyone, so it counts as a spent attempt rather than
    // as a delivery. classifyFollowUpLogs owns that rule — see
    // _shared/selection.ts for why it is read at selection time rather than
    // swept with an UPDATE.
    const { data: doneLogs, error: dErr } = await supabase
      .from('sms_log')
      .select('appointment_id, delivery_status, sent_at')
      .in('appointment_id', apptIds)
      .eq('message_kind', 'follow_up');
    if (dErr) return fail(`follow-up sms_log lookup failed: ${dErr.message}`);
    const history = classifyFollowUpLogs(
      (doneLogs ?? []) as unknown as SmsLogRow[],
      staleQueuedCutoff(Date.now()),
    );
    fup.abandoned = history.abandoned;

    // Rebooked patients — those with an UPCOMING scheduled check-up — are
    // skipped. The date bound is the whole point: without it a single stale
    // 'scheduled' row, however old, suppresses that patient's follow-ups
    // forever. The comment said upcoming; the query said ever.
    const { data: upcoming, error: uErr } = await supabase
      .from('appointments')
      .select('patient_id')
      .in('patient_id', patientIds)
      .eq('status', 'scheduled')
      .gte('scheduled_date', manilaDate(0));
    if (uErr) return fail(`upcoming lookup failed: ${uErr.message}`);
    const rebooked = new Set((upcoming ?? []).map((r) => r.patient_id as string));

    for (const a of missed) {
      const candidate = {
        appointment_id: a.appointment_id,
        patient_id: a.patient_id,
        contact_number: a.patients.contact_number,
      };
      if (!shouldFollowUp(candidate, history, rebooked, FOLLOWUP_MAX_ATTEMPTS)) {
        fup.skipped++;
        continue;
      }
      const outcome = await sendLogged(
        a.appointment_id,
        'follow_up',
        a.patients.contact_number,
        followUpMessage(asLang(a.patients.preferred_language)),
      );
      if (outcome === 'unreserved') fup.skipped++;
      else if (outcome === 'failed') fup.failed++;
      else fup.sent++;
    }
  }

  const summary = { gateway: gateway.name, reminders: rem, followUps: fup };
  console.log(`[sms-reminders] ${JSON.stringify(summary)}`);
  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
});
