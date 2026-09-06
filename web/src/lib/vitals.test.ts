/**
 * Tests for the portal's vital signs helpers (migration 0024).
 *
 * This is the second copy of the module — mobile/src/domain/vitals.ts is the
 * first — so on top of the usual parsing and BMI checks these guard the thing
 * a duplicate is actually at risk of: DRIFT. The ranges are restated by hand
 * from the SQL, so a change made on one side and not the other fails here.
 *
 * The positioning guard (§1, §5) is the same one the mobile suite carries: this
 * module must never gain a classifier. Vitals are measurements a nurse reads,
 * never a verdict the system hands them.
 */
import { describe, expect, it } from 'vitest';

import { Vitals, VITALS_KEYS } from './types';
import * as vitalsModule from './vitals';
import {
  bmiFrom,
  emptyVitals,
  formatBloodPressure,
  formatVital,
  hasAnyVital,
  parseVital,
  vitalsRows,
  VITALS_RANGE,
} from './vitals';

/** The CHECK ranges in supabase/migrations/0024, restated by hand. */
const SQL_RANGES: Record<keyof Vitals, [number, number]> = {
  height_cm: [30, 250],
  weight_kg: [1, 400],
  temperature_c: [30, 45],
  systolic_bp: [50, 300],
  diastolic_bp: [20, 200],
  pulse_rate: [20, 250],
  spo2_percent: [50, 100],
};

const LABELS = {
  height: 'Height',
  weight: 'Weight',
  bmi: 'BMI',
  temperature: 'Temperature',
  bloodPressure: 'Blood pressure',
  pulse: 'Pulse rate',
  spo2: 'Oxygen saturation',
};

const UNITS = {
  cm: 'cm',
  kg: 'kg',
  bmi: 'kg/m²',
  c: '°C',
  mmHg: 'mmHg',
  bpm: 'bpm',
  percent: '%',
};

describe('parseVital', () => {
  it('accepts a blank field on every vital — nothing is ever required', () => {
    for (const key of VITALS_KEYS) {
      expect(parseVital(key, ''), key).toEqual({ value: null, valid: true });
    }
  });

  it('agrees with the database CHECK ranges at both ends', () => {
    for (const key of VITALS_KEYS) {
      const [min, max] = SQL_RANGES[key];
      expect(VITALS_RANGE[key].min, `${key} min`).toBe(min);
      expect(VITALS_RANGE[key].max, `${key} max`).toBe(max);
      expect(parseVital(key, String(min)).valid, `${key} at min`).toBe(true);
      expect(parseVital(key, String(max)).valid, `${key} at max`).toBe(true);
      expect(parseVital(key, String(min - 1)).valid, `${key} below min`).toBe(false);
      expect(parseVital(key, String(max + 1)).valid, `${key} above max`).toBe(false);
    }
  });

  it('catches a slipped decimal point and a transposed height', () => {
    expect(parseVital('temperature_c', '3.68').valid).toBe(false);
    expect(parseVital('height_cm', '1700').valid).toBe(false);
  });

  it('refuses a decimal on the whole-number fields', () => {
    expect(parseVital('pulse_rate', '88.5').valid).toBe(false);
    expect(parseVital('pulse_rate', '88').valid).toBe(true);
  });

  it('rounds a decimal field to the one place the column holds', () => {
    expect(parseVital('temperature_c', '36.849')).toEqual({ value: 36.8, valid: true });
  });
});

describe('bmiFrom', () => {
  it('computes kg/m² to one decimal', () => {
    expect(bmiFrom(170, 65)).toBe(22.5);
  });

  it('returns null unless BOTH height and weight were recorded', () => {
    expect(bmiFrom(170, null)).toBeNull();
    expect(bmiFrom(null, 65)).toBeNull();
  });

  it('refuses a zero height rather than rendering Infinity', () => {
    expect(bmiFrom(0, 65)).toBeNull();
  });
});

describe('formatVital / formatBloodPressure / hasAnyVital', () => {
  it('renders nothing for a vital that was never taken', () => {
    for (const key of VITALS_KEYS) expect(formatVital(key, null), key).toBeNull();
    expect(hasAnyVital(emptyVitals)).toBe(false);
  });

  it('needs both halves before it shows a blood pressure', () => {
    expect(formatBloodPressure({ ...emptyVitals, systolic_bp: 120, diastolic_bp: 80 })).toBe(
      '120/80',
    );
    expect(formatBloodPressure({ ...emptyVitals, systolic_bp: 120 })).toBeNull();
  });
});

describe('vitalsRows', () => {
  it('lists only what was measured, and slips BMI in after weight', () => {
    const rows = vitalsRows(
      { ...emptyVitals, height_cm: 170, weight_kg: 65, pulse_rate: 82 },
      LABELS,
      UNITS,
    );
    expect(rows.map((r) => r.key)).toEqual(['height', 'weight', 'bmi', 'pulse']);
    expect(rows.map((r) => r.value)).toEqual(['170.0 cm', '65.0 kg', '22.5 kg/m²', '82 bpm']);
  });

  it('is empty when nothing was measured', () => {
    expect(vitalsRows(emptyVitals, LABELS, UNITS)).toEqual([]);
  });

  it('states values with units and no interpretation (§5)', () => {
    // Readings a scoring system would react to. Every rendered string must be
    // the number and its unit — nothing that reads as a judgement.
    const rows = vitalsRows(
      { ...emptyVitals, temperature_c: 39.5, systolic_bp: 180, diastolic_bp: 110, spo2_percent: 88 },
      LABELS,
      UNITS,
    );
    const VERDICT = /high|low|normal|abnormal|fever|febrile|hyper|hypo|severe|critical|warning/i;
    for (const r of rows) {
      expect(VERDICT.test(r.value), `${r.key}: ${r.value}`).toBe(false);
      expect(r.value).toMatch(/^[\d./]+ /);
    }
  });
});

describe('positioning (§1, §5)', () => {
  it('exports no classifier — vitals are data, never a finding', () => {
    // Structural guard, matching the mobile suite. If someone adds
    // bmiCategory(), isFebrile() or anything else that turns a measurement into
    // a verdict, this fails and the reviewer has to justify it against §1.
    const CLASSIFIER = /categor|classif|status|severity|risk|score|normal|abnormal|febrile|flag/i;
    expect(Object.keys(vitalsModule).filter((k) => CLASSIFIER.test(k))).toEqual([]);
  });
});
