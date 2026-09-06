/**
 * Tests for the portal's copy of the DOH-NTP referral rule.
 *
 * The rule now exists twice — mobile/src/domain/screeningRules.ts and here —
 * because a facility can record its own screening for a walk-in (0025). The
 * risk a duplicate carries is DRIFT: the same nine answers producing different
 * recommendations depending on whether a BHW or a nurse typed them. So this
 * suite is written to be about the RULE, not about the implementation:
 *
 *  - the cardinal and non-cardinal buckets are restated by hand, so a symptom
 *    quietly moved between them fails here;
 *  - the exhaustive one-yes sweep below is the same shape as the mobile
 *    suite's, so both sides are pinned to the same table of cases.
 *
 * It also guards the POSITIONING constraints (§1, §5) structurally: no score,
 * and no PGI-S or vitals influence on the decision.
 */
import { describe, expect, it } from 'vitest';

import { SYMPTOM_KEYS, SymptomFlags, TriState } from './types';
import { evaluateReferral, isChecklistComplete, SymptomKey } from './screeningRules';

/** Restated by hand, never imported: a test that reuses the implementation's
 *  own constant cannot catch a symptom being moved between buckets. */
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

describe('evaluateReferral', () => {
  it('flags on any single cardinal symptom, and only names that rule', () => {
    for (const key of CARDINAL) {
      const flags = { ...allAnswered('no'), [key]: 'yes' } as SymptomFlags;
      expect(evaluateReferral(flags), key).toEqual({
        referred: true,
        reason: 'cardinal_symptom',
      });
    }
  });

  it('does not flag on a non-cardinal symptom alone', () => {
    for (const key of NON_CARDINAL) {
      const flags = { ...allAnswered('no'), [key]: 'yes' } as SymptomFlags;
      expect(evaluateReferral(flags), key).toEqual({ referred: false, reason: null });
    }
  });

  it('does not flag on TB contact alone — contact is a modifier, not a symptom', () => {
    const flags = { ...allAnswered('no'), tb_contact: 'yes' } as SymptomFlags;
    expect(evaluateReferral(flags)).toEqual({ referred: false, reason: null });
  });

  it('flags on TB contact plus ANY symptom, including a non-cardinal one', () => {
    for (const key of NON_CARDINAL) {
      const flags = { ...allAnswered('no'), tb_contact: 'yes', [key]: 'yes' } as SymptomFlags;
      expect(evaluateReferral(flags), key).toEqual({
        referred: true,
        reason: 'contact_with_symptom',
      });
    }
  });

  it('never treats "unsure" as yes', () => {
    // Every single item unsure, including all five cardinals, must not flag.
    expect(evaluateReferral(allAnswered('unsure'))).toEqual({ referred: false, reason: null });
    for (const key of SYMPTOM_KEYS) {
      const flags = { ...allAnswered('no'), [key]: 'unsure' } as SymptomFlags;
      expect(evaluateReferral(flags).referred, key).toBe(false);
    }
  });

  it('does not flag when nothing is reported', () => {
    expect(evaluateReferral(allAnswered('no'))).toEqual({ referred: false, reason: null });
    expect(evaluateReferral({})).toEqual({ referred: false, reason: null });
  });
});

describe('isChecklistComplete', () => {
  it('needs every item answered', () => {
    expect(isChecklistComplete(allAnswered('no'))).toBe(true);
    expect(isChecklistComplete({})).toBe(false);
    const oneMissing = { ...allAnswered('no') };
    delete oneMissing.fatigue;
    expect(isChecklistComplete(oneMissing)).toBe(false);
  });
});

describe('positioning (§1, §5)', () => {
  it('returns a boolean and a reason — never a number', () => {
    const outcome = evaluateReferral({ ...allAnswered('no'), fever: 'yes' } as SymptomFlags);
    expect(Object.keys(outcome).sort()).toEqual(['reason', 'referred']);
    expect(typeof outcome.referred).toBe('boolean');
    expect(Object.values(outcome).some((v) => typeof v === 'number')).toBe(false);
  });

  it('ignores PGI-S and vitals entirely', () => {
    // Both are stored on the same screening row, so the realistic way this
    // breaks is someone passing the whole row in. Severe PGI-S and readings a
    // scoring system would react to must change nothing.
    const flags = allAnswered('no');
    const withContext = {
      ...flags,
      pgis_severity: 'severe',
      temperature_c: 39.5,
      spo2_percent: 88,
      systolic_bp: 180,
    } as SymptomFlags;
    expect(evaluateReferral(withContext)).toEqual(evaluateReferral(flags));
    expect(evaluateReferral(withContext).referred).toBe(false);
    // One parameter, and it is the checklist.
    expect(evaluateReferral.length).toBe(1);
  });
});
