/**
 * Tests for evaluateReferral() — the DOH-NTP referral rule (brief §5).
 *
 * This is the clinical heart of the system and the only place a referral is
 * decided, so these tests guard two separate things:
 *
 *  1. The RULE itself — cardinal symptoms, the contact modifier, and the
 *     tri-state handling where only an explicit 'yes' ever counts.
 *  2. The POSITIONING constraints (§1) that the rule must keep satisfying:
 *     no score anywhere, and no PGI-S influence on the decision. Those are
 *     asserted structurally, so a future change that quietly introduces a
 *     score or wires PGI-S in fails here rather than shipping.
 */
import { describe, expect, it } from 'vitest';

import { SymptomFlags, TriState } from '../db/types';
import {
  SYMPTOM_KEYS,
  SymptomKey,
  evaluateReferral,
  isChecklistComplete,
} from './screeningRules';

/** Restated here on purpose rather than imported: the module's own list is not
 *  exported, and a test that reuses the implementation's constant cannot catch
 *  a symptom being moved between buckets. */
const CARDINAL: readonly SymptomKey[] = [
  'cough_2wks',
  'fever',
  'night_sweats',
  'weight_loss',
  'hemoptysis',
];

const NON_CARDINAL: readonly SymptomKey[] = ['chest_pain', 'fatigue', 'loss_of_appetite'];

/** Every checklist item answered with the same value. */
const allAnswered = (v: TriState): SymptomFlags =>
  Object.fromEntries(SYMPTOM_KEYS.map((k) => [k, v])) as SymptomFlags;

/** A fully answered checklist that is all 'no' except the given overrides. */
const only = (overrides: Partial<Record<SymptomKey, TriState>>): SymptomFlags => ({
  ...allAnswered('no'),
  ...overrides,
});

const NOT_REFERRED = { referred: false, reason: null };

describe('the checklist itself', () => {
  it('splits into cardinal, non-cardinal and tb_contact with nothing left over', () => {
    // Forces a decision about which bucket a new checklist item belongs to:
    // add a key to SYMPTOM_KEYS without classifying it here and this fails.
    expect([...CARDINAL, ...NON_CARDINAL, 'tb_contact'].sort()).toEqual([...SYMPTOM_KEYS].sort());
  });
});

describe('rule 1 — any single cardinal symptom flags for referral', () => {
  it.each(CARDINAL)('%s alone is enough', (key) => {
    expect(evaluateReferral(only({ [key]: 'yes' }))).toEqual({
      referred: true,
      reason: 'cardinal_symptom',
    });
  });

  it('reports cardinal_symptom even when a TB contact is also present', () => {
    // Rule 1 is checked first; the reason shown must be the stronger one.
    expect(evaluateReferral(only({ fever: 'yes', tb_contact: 'yes' }))).toEqual({
      referred: true,
      reason: 'cardinal_symptom',
    });
  });
});

describe('rule 2 — close TB contact plus any symptom', () => {
  it.each(NON_CARDINAL)('tb_contact with %s flags for referral', (key) => {
    expect(evaluateReferral(only({ tb_contact: 'yes', [key]: 'yes' }))).toEqual({
      referred: true,
      reason: 'contact_with_symptom',
    });
  });

  it('does not flag a TB contact who reports no symptoms at all', () => {
    // tb_contact is a modifier, not a symptom — on its own it fires nothing.
    expect(evaluateReferral(only({ tb_contact: 'yes' }))).toEqual(NOT_REFERRED);
  });

  it.each(NON_CARDINAL)('does not flag %s without a TB contact', (key) => {
    expect(evaluateReferral(only({ [key]: 'yes' }))).toEqual(NOT_REFERRED);
  });
});

describe('no symptoms', () => {
  it('does not flag an all-no checklist', () => {
    expect(evaluateReferral(allAnswered('no'))).toEqual(NOT_REFERRED);
  });

  it('does not flag an empty checklist, and does not throw on missing keys', () => {
    expect(evaluateReferral({})).toEqual(NOT_REFERRED);
  });
});

describe("'unsure' is recorded but never counts as yes (§5)", () => {
  it('does not flag a checklist answered entirely unsure', () => {
    expect(evaluateReferral(allAnswered('unsure'))).toEqual(NOT_REFERRED);
  });

  it.each(CARDINAL)('does not flag %s answered unsure', (key) => {
    expect(evaluateReferral(only({ [key]: 'unsure' }))).toEqual(NOT_REFERRED);
  });

  it('does not flag an unsure TB contact reporting a definite symptom', () => {
    expect(evaluateReferral(only({ tb_contact: 'unsure', fatigue: 'yes' }))).toEqual(NOT_REFERRED);
  });

  it('does not flag a definite TB contact reporting only an unsure symptom', () => {
    expect(evaluateReferral(only({ tb_contact: 'yes', fatigue: 'unsure' }))).toEqual(NOT_REFERRED);
  });
});

describe('positioning constraints (§1)', () => {
  it('returns only referred and reason — there is no score field', () => {
    const outcome = evaluateReferral(only({ cough_2wks: 'yes' }));
    expect(Object.keys(outcome).sort()).toEqual(['reason', 'referred']);
  });

  it('gives the same shape of answer for one symptom as for eight', () => {
    // Severity does not accumulate: the outcome is a boolean plus which rule
    // fired, never a count or a weighting.
    const one = evaluateReferral(only({ cough_2wks: 'yes' }));
    const many = evaluateReferral(allAnswered('yes'));
    expect(many).toEqual(one);
  });

  it('ignores PGI-S severity entirely', () => {
    // PGI-S is supplementary context only and must never influence referral.
    const flags = only({ fatigue: 'yes' });
    const withPgis = { ...flags, pgis_severity: 'very_severe' } as unknown as SymptomFlags;
    expect(evaluateReferral(withPgis)).toEqual(evaluateReferral(flags));
    expect(evaluateReferral(withPgis)).toEqual(NOT_REFERRED);
  });
});

describe('isChecklistComplete', () => {
  it('is true when every item is answered', () => {
    expect(isChecklistComplete(allAnswered('no'))).toBe(true);
  });

  it("counts 'unsure' as an answer", () => {
    expect(isChecklistComplete(allAnswered('unsure'))).toBe(true);
  });

  it('is false when an empty checklist is passed', () => {
    expect(isChecklistComplete({})).toBe(false);
  });

  it.each(SYMPTOM_KEYS)('is false when %s is left unanswered', (key) => {
    const flags = allAnswered('no');
    delete flags[key];
    expect(isChecklistComplete(flags)).toBe(false);
  });
});
