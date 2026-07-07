/**
 * sms-reminders — Supabase Edge Function (Feature 9, brief §8.9).
 *
 * Runs daily (pg_cron, see migrations/0003_sms_reminders_cron.sql): finds
 * appointments scheduled for TOMORROW (Asia/Manila) whose patient opted into
 * SMS (sms_consent = true), sends one reminder through the swappable gateway
 * module, and logs every attempt to sms_log.
 *
 * PRIVACY (§4):
 *  - Only patients with sms_consent = true are even queried; the DB CHECK
 *    guarantees a contact_number exists only alongside consent.
 *  - The message text is deliberately NEUTRAL — no "TB", no patient details —
 *    because SMS can be read by anyone holding the phone.
 *  - Uses the service role (bypasses RLS) — this function is the ONLY writer
 *    of sms_log; clients have no policies on it at all.
 *
 * Auth: callers must present the X-Cron-Secret header matching the CRON_SECRET
 * secret (defense in depth on top of the platform JWT check).
 *
 * Secrets (supabase secrets set ...):
 *   CRON_SECRET            required — shared secret for the cron caller
 *   SMS_GATEWAY            'stub' (default) | 'semaphore'
 *   SEMAPHORE_API_KEY      required when SMS_GATEWAY=semaphore
 *   SEMAPHORE_SENDER_NAME  optional registered sender name
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

import { createGateway } from './gateway.ts';

/**
 * Reminder text — bilingual English/Tagalog, neutral wording (see PRIVACY
 * above). TODO i18n verify: the app does not store a per-patient language, so
 * one combined message is sent. {date} is YYYY-MM-DD.
 */
function reminderMessage(date: string): string {
  return (
    `Reminder: you have a health check-up appointment tomorrow, ${date}. ` +
    `Paalala: may check-up appointment kayo bukas, ${date}. - TB-Screen`
  );
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

interface DueAppointment {
  appointment_id: string;
  scheduled_date: string;
  patients: { contact_number: string | null; sms_consent: boolean };
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
  const tomorrow = manilaDate(1);

  // --- appointments one day out, still scheduled, with SMS consent ---
  const { data, error } = await supabase
    .from('appointments')
    .select('appointment_id, scheduled_date, patients!inner(contact_number, sms_consent)')
    .eq('status', 'scheduled')
    .eq('scheduled_date', tomorrow)
    .eq('patients.sms_consent', true);

  if (error) {
    console.error(`[sms-reminders] query failed: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const due = (data ?? []) as unknown as DueAppointment[];

  // --- skip appointments already reminded (idempotent re-runs) ---
  const ids = due.map((a) => a.appointment_id);
  const already = new Set<string>();
  if (ids.length > 0) {
    const { data: logged, error: logErr } = await supabase
      .from('sms_log')
      .select('appointment_id')
      .in('appointment_id', ids)
      .in('delivery_status', ['sent', 'stubbed']);
    if (logErr) {
      console.error(`[sms-reminders] sms_log lookup failed: ${logErr.message}`);
      return new Response(JSON.stringify({ error: logErr.message }), { status: 500 });
    }
    for (const row of logged ?? []) already.add(row.appointment_id as string);
  }

  // --- send + log, one row per attempt ---
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const appt of due) {
    if (already.has(appt.appointment_id) || !appt.patients.contact_number) {
      skipped++;
      continue;
    }
    const outcome = await gateway.send(
      appt.patients.contact_number,
      reminderMessage(appt.scheduled_date),
    );
    const { error: insErr } = await supabase.from('sms_log').insert({
      appointment_id: appt.appointment_id,
      delivery_status: outcome,
    });
    if (insErr) console.error(`[sms-reminders] log insert failed: ${insErr.message}`);
    if (outcome === 'failed') failed++;
    else sent++;
  }

  const summary = { gateway: gateway.name, date: tomorrow, due: due.length, sent, failed, skipped };
  console.log(`[sms-reminders] ${JSON.stringify(summary)}`);
  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
});
