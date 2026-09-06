/**
 * Optional vital signs — portal half (migration 0024).
 *
 * Mirrors mobile/src/domain/vitals.ts. Kept as a separate copy for the same
 * reason lib/types.ts is: the two packages share no workspace, and the portal
 * needs a subset. If you change a range here, change it there and in the SQL —
 * all three are asserted against each other by the tests on both sides.
 *
 * POSITIONING (§1) and NO-SCORING (§5) — read this before adding anything here:
 *
 *   Vitals are SUPPLEMENTARY CONTEXT, exactly like PGI-S. They are displayed so
 *   facility staff can read them, and they NEVER feed the referral decision,
 *   which comes from the DOH-NTP checklist alone.
 *
 *   This module therefore contains parsing, formatting and BMI arithmetic and
 *   NOTHING ELSE. It must never gain a classifier — no "underweight", no
 *   "hypertensive", no "febrile", no colour thresholds, no combined index.
 *   A number a nurse reads and interprets is data; the same number with a
 *   verdict attached is a finding, and this system does not produce findings.
 *
 * BMI is computed, not stored, for the same reason age is computed from
 * birthdate: a column would only add a way for the three values to disagree.
 */
import { Vitals, VITALS_KEYS } from './types';

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

/** True when at least one vital was recorded. Drives the "not recorded" copy. */
export function hasAnyVital(v: Vitals): boolean {
  return VITALS_KEYS.some((k) => v[k] !== null && v[k] !== undefined);
}

/**
 * Accepted range per field, mirroring the CHECK constraints in migration 0024.
 * Data-entry guards, not clinical thresholds: wide enough for any real reading,
 * narrow enough to catch a transposed digit or a slipped decimal point.
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
 * Parse one typed field into the value to store. Blank is always valid and
 * yields null — nothing here is ever required. An invalid entry yields null
 * too, so a caller that ignores `valid` stores nothing rather than garbage.
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

  return { value: decimals === 1 ? Math.round(n * 10) / 10 : n, valid: true };
}

/** A stored vital as text for display, or null when it was never recorded. */
export function formatVital(key: keyof Vitals, value: number | null): string | null {
  if (value === null || value === undefined) return null;
  return VITALS_RANGE[key].decimals === 1 ? value.toFixed(1) : String(Math.round(value));
}

/**
 * BMI (kg/m²) to one decimal, or null when either half is missing. NO category
 * is returned, deliberately — see the header. The height guard stops a bad
 * pulled row rendering "Infinity" where a clinician expects a number.
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

/**
 * The rows to display: only what was measured, each a plain "label — value unit"
 * pair with NO interpretation attached (§5). Labels arrive already translated so
 * this stays free of an i18n dependency; the call sites pass literal keys to
 * t() so the locale scan in i18n.test.ts can see them.
 */
export interface VitalsDisplayRow {
  key: string;
  label: string;
  value: string;
}

export function vitalsRows(
  v: Vitals,
  labels: Record<'height' | 'weight' | 'bmi' | 'temperature' | 'bloodPressure' | 'pulse' | 'spo2', string>,
  units: Record<'cm' | 'kg' | 'bmi' | 'c' | 'mmHg' | 'bpm' | 'percent', string>,
): VitalsDisplayRow[] {
  const rows: VitalsDisplayRow[] = [];
  const push = (key: string, label: string, value: string | null, unit: string) => {
    if (value !== null) rows.push({ key, label, value: `${value} ${unit}` });
  };

  push('height', labels.height, formatVital('height_cm', v.height_cm), units.cm);
  push('weight', labels.weight, formatVital('weight_kg', v.weight_kg), units.kg);

  const bmi = bmiFrom(v.height_cm, v.weight_kg);
  if (bmi !== null) rows.push({ key: 'bmi', label: labels.bmi, value: `${bmi.toFixed(1)} ${units.bmi}` });

  push('temperature', labels.temperature, formatVital('temperature_c', v.temperature_c), units.c);

  const bp = formatBloodPressure(v);
  if (bp !== null) {
    rows.push({ key: 'bp', label: labels.bloodPressure, value: `${bp} ${units.mmHg}` });
  }

  push('pulse', labels.pulse, formatVital('pulse_rate', v.pulse_rate), units.bpm);
  push('spo2', labels.spo2, formatVital('spo2_percent', v.spo2_percent), units.percent);

  return rows;
}
