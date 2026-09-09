/**
 * Who gets an SMS this run — the decision half of sms-reminders, extracted so
 * it can be tested (the function itself is Deno + network + a live gateway and
 * cannot be). Pure: imports nothing, reads no clock of its own. Every "now" is
 * passed in.
 *
 * The two policies differ on purpose, and the difference is the thing most
 * likely to be flattened by someone tidying up later:
 *
 *   REMINDERS are anchored to a date and idempotent PER CALENDAR DAY. Any
 *   logged attempt today — a failure included — retires today's reminder. The
 *   cron runs once a day, so "retry" would mean tomorrow regardless, and the
 *   same-day reminder is already the backstop for a 5-day one that went missing.
 *
 *   FOLLOW-UPS are anchored to an event and sent ONCE, except that a failure is
 *   retried up to a cap. Counting any row as done let one gateway hiccup retire
 *   the nudge for good; not counting failures at all would burn a send a day on
 *   a dead number for the whole window.
 *
 * ── The abandoned reservation (the reason classifyFollowUpLogs takes a clock)
 *
 * sendLogged() reserves an sms_log row as 'queued' BEFORE calling the gateway,
 * then settles it to the outcome. If the run dies in between — a crash, a
 * timeout, a redeploy — the row is left 'queued' forever. Nothing ever settles
 * it, because the next run is a fresh invocation with no memory of it.
 *
 * A 'queued' row is not 'failed', so the old classification counted it as a
 * settled attempt and the follow-up for that appointment was suppressed
 * PERMANENTLY, by a message that may never have been sent at all.
 *
 * The fix is to age them out: past `staleBefore`, a 'queued' row is no longer
 * evidence that anything was delivered, so it counts as ONE spent attempt
 * rather than as completion. The nudge becomes reachable again, and the
 * existing attempt cap still bounds it — so the worst case is the same bounded
 * handful of messages a run of gateway failures already produces.
 *
 * Note what this deliberately is NOT: it does not rewrite the row. An UPDATE
 * sweep would have to guess whether a row belongs to a dead run or to a live
 * one still mid-send, and guessing wrong settles a reservation out from under
 * a request that is about to succeed. Reading the age at selection time needs
 * no such guess, is idempotent, and leaves the audit trail intact — a 'queued'
 * row that stays 'queued' is a true record of a run that never came back.
 *
 * Choosing `staleBefore`: it must be far longer than one reserve→send→settle
 * round trip (seconds) and shorter than the gap between runs (a day). An hour
 * satisfies both by a wide margin in each direction.
 */

/** Minutes after which an unsettled 'queued' reservation is treated as spent
 *  rather than as a delivery. See the header for how the bound was chosen. */
export const STALE_QUEUED_MINUTES = 60;
export const SMS_REMINDER_STATUS = 'scheduled';
export const SMS_FOLLOWUP_STATUS = 'missed';

/** The `sent_at` cutoff for the above, as an ISO string to compare rows to. */
export function staleQueuedCutoff(nowMs: number, minutes = STALE_QUEUED_MINUTES): string {
  return new Date(nowMs - minutes * 60_000).toISOString();
}

/** The sms_log columns selection reads. `sent_at` stamps the ATTEMPT (the
 *  reservation), not the delivery — see sendLogged's header. */
export interface SmsLogRow {
  appointment_id: string;
  delivery_status: string;
  sent_at?: string | null;
}

export interface FollowUpHistory {
  /** Appointments with a settled, non-failed attempt: genuinely done. */
  settled: Set<string>;
  /** Spent attempts per appointment — failures, plus abandoned reservations. */
  attempts: Map<string, number>;
  /** How many rows were aged out this run. Logged, so an invisible failure
   *  mode becomes a number someone can watch. */
  abandoned: number;
}

/**
 * Fold the follow-up sms_log rows for this run's candidates into the two
 * questions the loop asks: has it been done, and how many tries has it had.
 *
 * `staleBefore` is an ISO timestamp; a 'queued' row older than it is counted
 * as a spent attempt, and one newer is treated as in flight — that run may
 * still settle it, and a duplicate send is exactly what the reservation exists
 * to prevent.
 */
export function classifyFollowUpLogs(
  rows: readonly SmsLogRow[],
  staleBefore: string,
): FollowUpHistory {
  const settled = new Set<string>();
  const attempts = new Map<string, number>();
  let abandoned = 0;

  const spend = (id: string) => attempts.set(id, (attempts.get(id) ?? 0) + 1);

  for (const r of rows) {
    const id = r.appointment_id;
    if (r.delivery_status === 'failed') {
      spend(id);
    } else if (r.delivery_status === 'queued') {
      // No sent_at at all is treated as stale: the column is NOT NULL with a
      // now() default, so a missing value means a row we cannot date, and an
      // undatable reservation is not evidence of a delivery.
      if (!r.sent_at || r.sent_at < staleBefore) {
        abandoned++;
        spend(id);
      } else {
        settled.add(id); // still in flight — leave it alone this run
      }
    } else {
      settled.add(id); // 'sent' or 'stubbed'
    }
  }

  return { settled, attempts, abandoned };
}

export interface FollowUpCandidate {
  appointment_id: string;
  patient_id: string;
  contact_number: string | null;
}

/**
 * Should this missed check-up get a follow-up nudge now?
 *
 * `rebooked` holds patients with an UPCOMING scheduled check-up — dated today
 * or later, not merely still carrying that status. Without the date bound one
 * stale 'scheduled' row suppresses a patient's follow-ups forever.
 */
export function shouldFollowUp(
  a: FollowUpCandidate,
  history: FollowUpHistory,
  rebooked: ReadonlySet<string>,
  maxAttempts: number,
): boolean {
  if (!a.contact_number) return false;
  if (history.settled.has(a.appointment_id)) return false;
  if ((history.attempts.get(a.appointment_id) ?? 0) >= maxAttempts) return false;
  if (rebooked.has(a.patient_id)) return false;
  return true;
}

export interface ReminderCandidate {
  appointment_id: string;
  contact_number: string | null;
}

export interface FacilityAppointment {
  appointment_id: string;
  patient_id: string;
  facility_id: string | null;
}

export interface FacilityReferral {
  patient_id: string;
  facility_id: string;
}

/** Explicit appointment ownership wins. Newest-first referrals are only a
 * compatibility fallback for legacy appointments whose owner is still NULL. */
export function resolveAppointmentFacilityIds(
  appointments: readonly FacilityAppointment[],
  referrals: readonly FacilityReferral[],
): Map<string, string | null> {
  const fallbackByPatient = new Map<string, string>();
  for (const referral of referrals) {
    if (!fallbackByPatient.has(referral.patient_id)) {
      fallbackByPatient.set(referral.patient_id, referral.facility_id);
    }
  }
  return new Map(
    appointments.map((appointment) => [
      appointment.appointment_id,
      appointment.facility_id ?? fallbackByPatient.get(appointment.patient_id) ?? null,
    ]),
  );
}

/** Should this upcoming check-up get a reminder now? See the header for why
 *  today's failures count as done here but not in the follow-up path. */
export function shouldRemind(
  a: ReminderCandidate,
  remindedToday: ReadonlySet<string>,
): boolean {
  if (!a.contact_number) return false;
  return !remindedToday.has(a.appointment_id);
}
