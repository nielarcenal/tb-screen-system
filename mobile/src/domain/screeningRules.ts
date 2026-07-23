/**
 * Referral recommendation logic (brief §5) — the ONLY place in the system that
 * decides whether a screening flags a patient for referral.
 *
 * POSITIONING (§1): this is NOT a diagnosis. The outcome is a referral
 * recommendation for presumptive TB — "flags for referral" — nothing more.
 * There is NO score, NO weighting, NO probability. The decision is a plain
 * boolean rule over the DOH-NTP symptom checklist, chosen with the user
 * (DOH-NTP style, confirmed 2026-07-02):
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
 * Tri-state answers: only an explicit 'yes' counts toward the rule. 'unsure'
 * is recorded and displayed but never treated as yes (§5).
 *
 * PGI-S is deliberately ABSENT from this module: it is supplementary context
 * only and must never influence the referral decision (§5).
 */
import { SymptomFlags, TriState } from '../db/types';

/** Checklist items, in display order. Keys match the jsonb stored on the server. */
export const SYMPTOM_KEYS = [
  'cough_2wks',
  'weight_loss',
  'night_sweats',
  'fever',
  'hemoptysis',
  'chest_pain',
  'fatigue',
  'loss_of_appetite',
  'tb_contact',
] as const;

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
const SYMPTOM_ONLY_KEYS: readonly SymptomKey[] = SYMPTOM_KEYS.filter(
  (k) => k !== 'tb_contact',
);

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
