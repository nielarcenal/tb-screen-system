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

/**
 * Whole-year age on today's date from a YYYY-MM-DD birthdate, or null when the
 * input is missing/invalid/out of range (0–129, matching the DB CHECK on age).
 */
export function ageFromBirthdate(birthdate: string | null | undefined): number | null {
  if (!birthdate) return null;
  const [y, m, d] = birthdate.split('-').map(Number);
  if (!y || !m || !d) return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return Number.isInteger(age) && age >= 0 && age < 130 ? age : null;
}
