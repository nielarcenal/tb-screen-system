/**
 * Optional vital signs (server migration 0024, local sqlite v10).
 *
 * POSITIONING (§1) and NO-SCORING (§5) — read this before adding anything here:
 *
 *   Vitals are SUPPLEMENTARY CONTEXT, exactly like PGI-S. They are recorded,
 *   displayed, and printed on the referral document so the TB-DOTS facility has
 *   them on arrival. They NEVER feed the referral decision, which comes from
 *   evaluateReferral() over the DOH-NTP checklist alone (screeningRules.ts).
 *
 *   This module therefore contains parsing, formatting and BMI arithmetic and
 *   NOTHING ELSE. It must never gain a classifier — no "underweight", no
 *   "hypertensive", no "febrile", no colour thresholds, no combined index. Those
 *   are clinical findings, and the app does not produce findings. A number a
 *   nurse reads and interprets is data; the same number with a verdict attached
 *   is a diagnosis, and this system does not make one.
 *
 * WHY BMI IS COMPUTED AND NOT STORED. Same reasoning as age-from-birthdate
 * (lib/dates.ts): it is arithmetic on two values that ARE stored, so a column
 * would only add a way for the three to disagree. Derived at display and print
 * time, it is visibly a restatement of height and weight rather than a finding
 * of its own.
 */
import { Vitals, VITALS_KEYS } from '../db/types';

/** Every vitals field null — a screening where nothing was measured. */
export const emptyVitals: Vitals = {
  height_cm: null,
  weight_kg: null,
  temperature_c: null,
  systolic_bp: null,
  diastolic_bp: null,
  pulse_rate: null,
  spo2_percent: null,
};

/** True when at least one vital was recorded. Drives "not recorded" copy. */
export function hasAnyVital(v: Vitals): boolean {
  return VITALS_KEYS.some((k) => v[k] !== null && v[k] !== undefined);
}

/**
 * Accepted range per field, mirroring the CHECK constraints in migration 0024.
 *
 * These are DATA-ENTRY GUARDS, not clinical thresholds: wide enough to admit
 * any real human reading, narrow enough to catch a transposed digit or a
 * slipped decimal point (1700 cm for 170, 3.68 °C for 36.8). Keeping them in
 * step with the SQL matters — a value the form accepts and the database
 * rejects would fail at sync time, long after the BHW left the household.
 */
export const VITALS_RANGE: Record<keyof Vitals, { min: number; max: number; decimals: 0 | 1 }> = {
  height_cm: { min: 30, max: 250, decimals: 1 },
  weight_kg: { min: 1, max: 400, decimals: 1 },
  temperature_c: { min: 30, max: 45, decimals: 1 },
  systolic_bp: { min: 50, max: 300, decimals: 0 },
  diastolic_bp: { min: 20, max: 200, decimals: 0 },
  pulse_rate: { min: 20, max: 250, decimals: 0 },
  spo2_percent: { min: 50, max: 100, decimals: 0 },
};

/**
 * Parse one typed field into the value to store.
 *
 *   ''      → { value: null, valid: true }   — blank is always allowed
 *   '36.8'  → { value: 36.8, valid: true }
 *   '3.68'  → { value: null, valid: false }  — out of range for temperature
 *   'abc'   → { value: null, valid: false }
 *
 * Blank and invalid both yield a null value, so a caller that ignores `valid`
 * still stores nothing rather than garbage; the form uses `valid` to show the
 * field in error instead of silently discarding what was typed.
 */
export function parseVital(
  key: keyof Vitals,
  raw: string,
): { value: number | null; valid: boolean } {
  const text = raw.trim();
  if (text === '') return { value: null, valid: true };

  const n = Number(text.replace(',', '.'));
  if (!Number.isFinite(n)) return { value: null, valid: false };

  const { min, max, decimals } = VITALS_RANGE[key];
  if (n < min || n > max) return { value: null, valid: false };
  if (decimals === 0 && !Number.isInteger(n)) return { value: null, valid: false };

  // One decimal place is all the columns hold (numeric(x,1)); rounding here
  // rather than letting Postgres do it keeps what is shown and what is stored
  // the same value.
  return { value: decimals === 1 ? Math.round(n * 10) / 10 : n, valid: true };
}

/** A stored vital as text for display, or null when it was never recorded. */
export function formatVital(key: keyof Vitals, value: number | null): string | null {
  if (value === null || value === undefined) return null;
  return VITALS_RANGE[key].decimals === 1 ? value.toFixed(1) : String(Math.round(value));
}

/**
 * BMI (kg/m²) to one decimal from the recorded height and weight, or null when
 * either is missing. NO category is returned, deliberately — see the header.
 *
 * The height guard is not defensive padding: heights below the 0024 CHECK floor
 * cannot reach here from the app, but a row pulled from the server predates
 * nothing and division by a zero height would render "Infinity" on a printed
 * clinical document.
 */
export function bmiFrom(heightCm: number | null, weightKg: number | null): number | null {
  if (heightCm === null || weightKg === null) return null;
  if (!Number.isFinite(heightCm) || !Number.isFinite(weightKg)) return null;
  if (heightCm <= 0 || weightKg <= 0) return null;
  const metres = heightCm / 100;
  return Math.round((weightKg / (metres * metres)) * 10) / 10;
}

/** Blood pressure as the single "120/80" reading a cuff shows, or null unless
 *  BOTH halves were recorded — half a blood pressure is not a blood pressure. */
export function formatBloodPressure(v: Vitals): string | null {
  if (v.systolic_bp === null || v.diastolic_bp === null) return null;
  return `${Math.round(v.systolic_bp)}/${Math.round(v.diastolic_bp)}`;
}
