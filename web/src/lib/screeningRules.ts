/**
 * Referral recommendation logic — portal half.
 *
 * MIRRORS mobile/src/domain/screeningRules.ts, deliberately and exactly. The
 * facility can now record a screening of its own for a walk-in patient (0025),
 * and a walk-in must be judged by the same rule as a BHW referral: two
 * definitions that could drift apart would mean the same nine answers producing
 * different recommendations depending on who typed them. There is no shared
 * workspace between the two packages, so the copy is asserted against a
 * hand-restated table of cases in screeningRules.test.ts rather than trusted.
 *
 * POSITIONING (§1): this is NOT a diagnosis. The outcome is a referral
 * recommendation for presumptive TB — "flags for referral" — nothing more.
 * There is NO score, NO weighting, NO probability. The rule (DOH-NTP style,
 * confirmed with the user 2026-07-02):
 *
 *   Flag for referral when ANY ONE cardinal symptom is present:
 *     - cough for 2 weeks or more
 *     - unexplained fever
 *     - night sweats
 *     - unexplained weight loss
 *     - hemoptysis (coughing up blood)
 *   OR when the patient is a close contact of a known TB case AND reports
 *   ANY symptom on the checklist at all.
 *
 * Tri-state answers: only an explicit 'yes' counts. 'unsure' is recorded and
 * displayed but never treated as yes (§5).
 *
 * PGI-S and vitals are deliberately ABSENT from this module: both are
 * supplementary context and must never influence the decision (§5).
 */
import { SYMPTOM_KEYS, SymptomFlags, TriState } from './types';

export type SymptomKey = (typeof SYMPTOM_KEYS)[number];

/** Cardinal symptoms: any single 'yes' among these flags for referral. */
const CARDINAL_KEYS: readonly SymptomKey[] = [
  'cough_2wks',
  'fever',
  'night_sweats',
  'weight_loss',
  'hemoptysis',
];

/** Symptom keys excluding tb_contact (contact is a modifier, not a symptom). */
const SYMPTOM_ONLY_KEYS: readonly SymptomKey[] = SYMPTOM_KEYS.filter((k) => k !== 'tb_contact');

const isYes = (v: TriState | undefined): boolean => v === 'yes';

export interface ReferralOutcome {
  /** True = the checklist flags this patient for referral (presumptive TB). */
  referred: boolean;
  /** Which rule fired, for transparent display. Never a score. */
  reason: 'cardinal_symptom' | 'contact_with_symptom' | null;
}

export function evaluateReferral(flags: SymptomFlags): ReferralOutcome {
  // Rule 1 — any single cardinal symptom.
  if (CARDINAL_KEYS.some((k) => isYes(flags[k]))) {
    return { referred: true, reason: 'cardinal_symptom' };
  }

  // Rule 2 — close TB contact plus ANY reported symptom.
  if (isYes(flags.tb_contact) && SYMPTOM_ONLY_KEYS.some((k) => isYes(flags[k]))) {
    return { referred: true, reason: 'contact_with_symptom' };
  }

  return { referred: false, reason: null };
}

/** True when every checklist item has been answered (yes/no/unsure). */
export function isChecklistComplete(flags: SymptomFlags): boolean {
  return SYMPTOM_KEYS.every((k) => flags[k] !== undefined);
}
