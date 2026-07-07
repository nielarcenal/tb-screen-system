/**
 * Date-only helpers. appointments.scheduled_date is a Postgres `date` — we
 * always format in LOCAL time (never via toISOString, which converts to UTC
 * and can shift the calendar day for PH time, UTC+8).
 */
export function toDateOnly(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
