/**
 * Tests for the optional vital signs helpers (0024 / sqlite v10).
 *
 * Three separate things are guarded here:
 *
 *  1. PARSING, because the form is the last place a bad number can be caught
 *     cheaply. A value the form accepts and the database's CHECK rejects fails
 *     at sync time — hours later, on a different screen, long after the BHW
 *     left the household. So the ranges here are asserted to match migration
 *     0024 exactly, restated rather than imported for the usual reason: a test
 *     that reuses the implementation's constant cannot catch it changing.
 *
 *  2. BMI ARITHMETIC, including the two ways it can produce nonsense on a
 *     printed clinical document — a missing half, and a zero height.
 *
 *  3. The POSITIONING constraints (§1, §5), asserted structurally: this module
 *     must never gain a classifier, and nothing here may reach the referral
 *     decision. A future change that adds "underweight" or wires a vital into
 *     evaluateReferral fails here rather than shipping.
 */
import { describe, expect, it } from 'vitest';

import { SymptomFlags, Vitals, VITALS_KEYS } from '../db/types';
import { evaluateReferral } from './screeningRules';
import * as vitalsModule from './vitals';
import {
  bmiFrom,
  emptyVitals,
  formatBloodPressure,
  formatVital,
  hasAnyVital,
  parseVital,
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

describe('parseVital', () => {
  it('accepts a blank field on every vital — nothing is ever required', () => {
    for (const key of VITALS_KEYS) {
      expect(parseVital(key, ''), key).toEqual({ value: null, valid: true });
      expect(parseVital(key, '   '), key).toEqual({ value: null, valid: true });
    }
  });

  it('agrees with the database CHECK ranges at both ends', () => {
    for (const key of VITALS_KEYS) {
      const [min, max] = SQL_RANGES[key];
      expect(VITALS_RANGE[key].min, `${key} min`).toBe(min);
      expect(VITALS_RANGE[key].max, `${key} max`).toBe(max);
      // The boundaries themselves are legal — the SQL uses >= and <=.
      expect(parseVital(key, String(min)).valid, `${key} at min`).toBe(true);
      expect(parseVital(key, String(max)).valid, `${key} at max`).toBe(true);
      expect(parseVital(key, String(min - 1)).valid, `${key} below min`).toBe(false);
      expect(parseVital(key, String(max + 1)).valid, `${key} above max`).toBe(false);
    }
  });

  it('catches the two typos the ranges exist for', () => {
    // A slipped decimal point on a temperature, and a transposed height.
    expect(parseVital('temperature_c', '3.68').valid).toBe(false);
    expect(parseVital('height_cm', '1700').valid).toBe(false);
  });

  it('rejects text, and returns null rather than NaN', () => {
    const r = parseVital('weight_kg', 'abc');
    expect(r).toEqual({ value: null, valid: false });
  });

  it('rounds a decimal field to the one place the column holds', () => {
    expect(parseVital('temperature_c', '36.849')).toEqual({ value: 36.8, valid: true });
    expect(parseVital('weight_kg', '52.44')).toEqual({ value: 52.4, valid: true });
  });

  it('refuses a decimal on the whole-number fields', () => {
    // numeric(x,1) would silently round 88.5 bpm to 88.5 and the int column
    // would round it to 89 — neither is a reading anyone took.
    expect(parseVital('pulse_rate', '88.5').valid).toBe(false);
    expect(parseVital('systolic_bp', '120.5').valid).toBe(false);
    expect(parseVital('pulse_rate', '88').valid).toBe(true);
  });

  it('reads a comma decimal separator', () => {
    // Numeric keypads on some Android locales emit ',' — the reading is still
    // 36.8 and refusing it would mean a BHW simply cannot enter a temperature.
    expect(parseVital('temperature_c', '36,8')).toEqual({ value: 36.8, valid: true });
  });
});

describe('formatVital', () => {
  it('returns null for a vital that was never recorded', () => {
    for (const key of VITALS_KEYS) expect(formatVital(key, null), key).toBeNull();
  });

  it('keeps one decimal on the measured fields and none on the counted ones', () => {
    expect(formatVital('temperature_c', 37)).toBe('37.0');
    expect(formatVital('weight_kg', 52.4)).toBe('52.4');
    expect(formatVital('pulse_rate', 88)).toBe('88');
  });
});

describe('bmiFrom', () => {
  it('computes kg/m² to one decimal', () => {
    expect(bmiFrom(170, 65)).toBe(22.5);
    expect(bmiFrom(160, 45)).toBe(17.6);
  });

  it('returns null unless BOTH height and weight were recorded', () => {
    expect(bmiFrom(170, null)).toBeNull();
    expect(bmiFrom(null, 65)).toBeNull();
    expect(bmiFrom(null, null)).toBeNull();
  });

  it('refuses a zero or negative height rather than printing Infinity', () => {
    // Unreachable from the app (the 0024 CHECK floors height at 30cm), but a
    // pulled row is not the app, and "BMI: Infinity" on a clinical document is
    // the kind of thing that gets a capstone marked down.
    expect(bmiFrom(0, 65)).toBeNull();
    expect(bmiFrom(-170, 65)).toBeNull();
    expect(bmiFrom(170, 0)).toBeNull();
  });
});

describe('formatBloodPressure', () => {
  const withBp = (s: number | null, d: number | null): Vitals => ({
    ...emptyVitals,
    systolic_bp: s,
    diastolic_bp: d,
  });

  it('renders the pair the way a cuff shows it', () => {
    expect(formatBloodPressure(withBp(120, 80))).toBe('120/80');
  });

  it('renders nothing when only half was taken', () => {
    expect(formatBloodPressure(withBp(120, null))).toBeNull();
    expect(formatBloodPressure(withBp(null, 80))).toBeNull();
  });
});

describe('hasAnyVital', () => {
  it('is false when nothing was measured', () => {
    expect(hasAnyVital(emptyVitals)).toBe(false);
  });

  it('is true for any single recorded value', () => {
    for (const key of VITALS_KEYS) {
      expect(hasAnyVital({ ...emptyVitals, [key]: 1 }), key).toBe(true);
    }
  });
});

describe('positioning (§1, §5)', () => {
  it('exports no classifier — vitals are data, never a finding', () => {
    // Structural guard. If someone adds bmiCategory(), bpCategory(), isFebrile()
    // or anything else that turns a measurement into a verdict, this fails and
    // the reviewer has to justify it against §1 rather than merge it quietly.
    const CLASSIFIER = /categor|classif|status|severity|risk|score|normal|abnormal|febrile|flag/i;
    expect(Object.keys(vitalsModule).filter((k) => CLASSIFIER.test(k))).toEqual([]);
  });

  it('leaves the referral decision untouched — evaluateReferral takes flags only', () => {
    // The rule takes SymptomFlags and nothing else. Smuggling a full set of
    // vitals in alongside the flags — including values a scoring system would
    // certainly react to — must not change its answer.
    const flags: SymptomFlags = { cough_2wks: 'no', tb_contact: 'no' };
    const alarming = {
      height_cm: 150,
      weight_kg: 38,
      temperature_c: 39.5,
      systolic_bp: 180,
      diastolic_bp: 110,
      pulse_rate: 130,
      spo2_percent: 88,
    };
    const before = evaluateReferral(flags);
    const after = evaluateReferral({ ...flags, ...alarming } as SymptomFlags);
    expect(after).toEqual(before);
    expect(before.referred).toBe(false);
    // One parameter, and it is the checklist. A second would be the change
    // this project exists to refuse.
    expect(evaluateReferral.length).toBe(1);
  });
});
