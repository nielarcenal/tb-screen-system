/**
 * Rules for the password an account sets when it passes the D-06 forced-change
 * gate. Pure — no React, no I/O — so it unit-tests without a DOM.
 *
 * Mirrored, deliberately, at mobile/src/domain/passwordPolicy.ts: the two
 * packages share no workspace, and the app gate has to apply the same rules as
 * the portal gate. Change one, change the other — the tests live in both trees.
 *
 * The real floor is Supabase's own project-level password policy; whatever it
 * refuses comes back as an API error the gate surfaces. These rules run first
 * so the common mistakes are caught offline, without a round trip.
 */

/** Supabase's own default minimum is 6. Eight is the programme's floor. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * The exact shape manage-bhw's tempPassword() emits (TBS-4829-kfmq).
 *
 * Knowing the format is what lets the gate refuse offline the one bypass a
 * hurried user actually attempts: retyping the slip of paper the midwife
 * handed over. The whole point of D-06 is retiring a password somebody else
 * chose, so a "new" password in the provisioned format defeats it — even a
 * different one, which would just be another password the app generated rather
 * than one the holder picked.
 */
export const PROVISIONED_PASSWORD_RE = /^TBS-\d{4}-[a-z]{4}$/;

export type PasswordProblem = 'tooShort' | 'looksProvisioned' | 'mismatch';

/**
 * The first thing wrong with a proposed password, or null if it is acceptable.
 *
 * Order is deliberate: report what is wrong with the password itself before
 * complaining that the confirmation does not match it, so a user fixing a
 * too-short password is not also told off about the second field they have not
 * corrected yet.
 */
export function validateNewPassword(password: string, confirm: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'tooShort';
  if (PROVISIONED_PASSWORD_RE.test(password)) return 'looksProvisioned';
  if (password !== confirm) return 'mismatch';
  return null;
}
