/**
 * Date-only helpers.
 *
 * Two different questions live here, and they must not be conflated:
 *
 *  - toDateOnly(d) formats a Date the USER PICKED. A picker hands back local
 *    midnight of the day that was tapped, so reading its local fields is the
 *    only way to get that day back. Do NOT reinterpret it in another zone —
 *    on a device set east of Manila that would shift the pick a day earlier.
 *  - manilaToday() answers "what is today on the BUSINESS calendar?". That is
 *    always Asia/Manila, whatever the device clock is set to, so the app and
 *    the server (see manila_today() in migration 0018) agree on the same day.
 */

/** Asia/Manila is UTC+8 and has had no DST since 1978. Offset arithmetic keeps
 *  this identical on Hermes, in the browser and in Deno — Intl timeZone support
 *  is not guaranteed on every RN build, and a silent fallback to UTC here would
 *  be the exact bug this helper exists to prevent. */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Today's calendar date (YYYY-MM-DD) in Asia/Manila. */
export function manilaToday(): string {
  return new Date(Date.now() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** A user-picked Date as YYYY-MM-DD, read in the device's own local time —
 *  never via toISOString, which converts to UTC and can shift the day. */
export function toDateOnly(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Whole-year age on today's date from a YYYY-MM-DD birthdate, or null when the
 * input is missing/invalid/out of range (0–129, matching the DB CHECK on age).
 * "Today" is the Manila business day, so a patient's recorded age does not
 * depend on which timezone the device happens to be set to.
 */
export function ageFromBirthdate(birthdate: string | null | undefined): number | null {
  if (!birthdate) return null;
  const [y, m, d] = birthdate.split('-').map(Number);
  if (!y || !m || !d) return null;
  const [ty, tm, td] = manilaToday().split('-').map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age--;
  return Number.isInteger(age) && age >= 0 && age < 130 ? age : null;
}
