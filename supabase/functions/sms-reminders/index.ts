/**
 * sms-reminders — Supabase Edge Function (Feature 9, brief §8.9).
 *
 * Runs daily (pg_cron, see migrations/0003_sms_reminders_cron.sql) and does two
 * things, both only for patients who opted into SMS (sms_consent = true):
 *
 *   1. REMINDERS — for check-ups still 'scheduled' that fall on one of the lead
 *      days ahead (REMINDER_OFFSETS, Asia/Manila): 3 days out AND the day before.
 *      Idempotent per day: an appointment gets at most one reminder per calendar
 *      day, so re-runs never double-send and the 3-day / 1-day reminders (on
 *      different days) both go out.
 *   2. FOLLOW-UPS — for check-ups recently marked 'missed' (updated in the last
 *      FOLLOWUP_WINDOW_DAYS), a one-time neutral nudge to reschedule — UNLESS the
 *      patient already has another upcoming 'scheduled' appointment (rebooked).
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
 *   SMS_GATEWAY            'stub' (default) | 'semaphore'
 *   SEMAPHORE_API_KEY      required when SMS_GATEWAY=semaphore
 *   SEMAPHORE_SENDER_NAME  optional registered sender name
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

import { createGateway } from './gateway.ts';

/** Lead days before a check-up on which to remind (Asia/Manila). */
const REMINDER_OFFSETS = [3, 1];
/** Only follow up on check-ups marked missed within this many days. */
const FOLLOWUP_WINDOW_DAYS = 14;

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

  // ======================= 1. REMINDERS =======================
  const reminderDates = REMINDER_OFFSETS.map(manilaDate);
  const todayMidnight = `${manilaDate(0)}T00:00:00+08:00`; // start of today, Manila
  const rem = { dates: reminderDates, due: 0, sent: 0, failed: 0, skipped: 0 };

  const { data: dueData, error: dueErr } = await supabase
    .from('appointments')
    .select('appointment_id, patient_id, scheduled_date, patients!inner(contact_number, sms_consent, preferred_language)')
    .eq('status', 'scheduled')
    .in('scheduled_date', reminderDates)
    .eq('patients.sms_consent', true);
  if (dueErr) return fail(`reminder query failed: ${dueErr.message}`);
  const due = (dueData ?? []) as unknown as ApptRow[];
  rem.due = due.length;

  // Skip appointments already reminded TODAY (idempotent same-day re-runs; the
  // 3-day and 1-day reminders land on different days, so both still go out).
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

  // Map each due patient to the (neutral) facility they were referred to — the
  // "where to go". Appointments carry no facility; the referral does.
  const facilityByPatient = new Map<string, string | null>();
  if (due.length > 0) {
    const pids = [...new Set(due.map((a) => a.patient_id))];
    const { data: refs, error: refErr } = await supabase
      .from('referrals')
      .select('patient_id, facility_id, created_at')
      .in('patient_id', pids)
      .order('created_at', { ascending: false });
    if (refErr) return fail(`referral lookup failed: ${refErr.message}`);
    const facIdByPatient = new Map<string, string>();
    for (const r of refs ?? []) {
      if (!facIdByPatient.has(r.patient_id as string)) {
        facIdByPatient.set(r.patient_id as string, r.facility_id as string);
      }
    }
    const fids = [...new Set(facIdByPatient.values())];
    const nameByFacility = new Map<string, string>();
    if (fids.length > 0) {
      const { data: facs, error: facErr } = await supabase
        .from('facilities')
        .select('facility_id, name')
        .in('facility_id', fids);
      if (facErr) return fail(`facility lookup failed: ${facErr.message}`);
      for (const f of facs ?? []) nameByFacility.set(f.facility_id as string, neutralFacility(f.name as string));
    }
    for (const [pid, fid] of facIdByPatient) facilityByPatient.set(pid, nameByFacility.get(fid) ?? null);
  }

  for (const a of due) {
    if (remindedToday.has(a.appointment_id) || !a.patients.contact_number) {
      rem.skipped++;
      continue;
    }
    const outcome = await gateway.send(
      a.patients.contact_number,
      reminderMessage(
        asLang(a.patients.preferred_language),
        a.scheduled_date,
        facilityByPatient.get(a.patient_id) ?? null,
      ),
    );
    const { error: insErr } = await supabase
      .from('sms_log')
      .insert({ appointment_id: a.appointment_id, delivery_status: outcome, message_kind: 'reminder' });
    if (insErr) console.error(`[sms-reminders] reminder log insert failed: ${insErr.message}`);
    outcome === 'failed' ? rem.failed++ : rem.sent++;
  }

  // ======================= 2. MISSED FOLLOW-UPS =======================
  const windowStart = new Date(Date.now() - FOLLOWUP_WINDOW_DAYS * 86_400_000).toISOString();
  const fup = { window_days: FOLLOWUP_WINDOW_DAYS, candidates: 0, sent: 0, failed: 0, skipped: 0 };

  const { data: missedData, error: missedErr } = await supabase
    .from('appointments')
    .select('appointment_id, patient_id, scheduled_date, patients!inner(contact_number, sms_consent, preferred_language)')
    .eq('status', 'missed')
    .gte('updated_at', windowStart)
    .eq('patients.sms_consent', true);
  if (missedErr) return fail(`missed query failed: ${missedErr.message}`);
  const missed = (missedData ?? []) as unknown as ApptRow[];
  fup.candidates = missed.length;

  if (missed.length > 0) {
    const apptIds = missed.map((a) => a.appointment_id);
    const patientIds = [...new Set(missed.map((a) => a.patient_id))];

    // Already followed up (send once, ever).
    const { data: doneLogs, error: dErr } = await supabase
      .from('sms_log')
      .select('appointment_id')
      .in('appointment_id', apptIds)
      .eq('message_kind', 'follow_up');
    if (dErr) return fail(`follow-up sms_log lookup failed: ${dErr.message}`);
    const alreadyFollowed = new Set((doneLogs ?? []).map((r) => r.appointment_id as string));

    // Rebooked patients — those with an upcoming scheduled check-up — are skipped.
    const { data: upcoming, error: uErr } = await supabase
      .from('appointments')
      .select('patient_id')
      .in('patient_id', patientIds)
      .eq('status', 'scheduled');
    if (uErr) return fail(`upcoming lookup failed: ${uErr.message}`);
    const rebooked = new Set((upcoming ?? []).map((r) => r.patient_id as string));

    for (const a of missed) {
      if (alreadyFollowed.has(a.appointment_id) || rebooked.has(a.patient_id) || !a.patients.contact_number) {
        fup.skipped++;
        continue;
      }
      const outcome = await gateway.send(
        a.patients.contact_number,
        followUpMessage(asLang(a.patients.preferred_language)),
      );
      const { error: insErr } = await supabase
        .from('sms_log')
        .insert({ appointment_id: a.appointment_id, delivery_status: outcome, message_kind: 'follow_up' });
      if (insErr) console.error(`[sms-reminders] follow-up log insert failed: ${insErr.message}`);
      outcome === 'failed' ? fup.failed++ : fup.sent++;
    }
  }

  const summary = { gateway: gateway.name, reminders: rem, followUps: fup };
  console.log(`[sms-reminders] ${JSON.stringify(summary)}`);
  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
});
