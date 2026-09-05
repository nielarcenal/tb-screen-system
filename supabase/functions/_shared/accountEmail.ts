/**
 * Auto-generated account emails, and the one error that may be retried (D-15).
 *
 * Pure: imports nothing, touches no network, no Deno globals. That is what
 * makes it testable — see accountEmail.test.ts and the note in
 * supabase/functions/vitest.config.mts about why this directory exists.
 *
 * THE DEFECT THIS CLOSES. manage-bhw allocates an account email by trying
 * firstname.lastname@tbscreen.ph, then .2, .3, … and it decided whether to
 * advance the suffix with nothing more than `if (!createErr)`. So EVERY
 * failure of createUser was read as "that email is taken":
 *
 *   - the service being down            → 48 attempts, then 409 "could not
 *   - the auth admin key being wrong      allocate a unique email"
 *   - a rate limit                      → the same 409
 *   - a password the policy rejects      → the same 409
 *
 * The caller was told to pick a different name for a problem that had nothing
 * to do with the name, 48 pointless round-trips were made against a service
 * already in trouble, and the real error text was thrown away every time. A
 * rate limit in particular gets strictly worse the harder you retry it.
 *
 * So the suffix advances only for an error that actually means "taken", and
 * everything else is returned to the caller as itself.
 */

/** One name part → lowercase ASCII letters, inner spaces dropped
 *  ("Dela Cruz" → "delacruz"). Accents are stripped, not transliterated. */
export function slugPart(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');
}

/** The email to try on attempt n. n = 1 is the unsuffixed form; 2, 3, … add
 *  the suffix, matching the addresses already issued in the live project. */
export function candidateEmail(slug: string, n: number, domain = 'tbscreen.ph'): string {
  return n <= 1 ? `${slug}@${domain}` : `${slug}.${n}@${domain}`;
}

/** The shape of a GoTrue admin error, narrowed to what we branch on. */
export interface CreateUserError {
  message?: string | null;
  code?: string | null;
  status?: number | null;
}

/**
 * Does this createUser error mean "that address is already registered" — the
 * one condition under which trying the next suffix is the right move?
 *
 * Checked by code first: GoTrue returns `email_exists` and has done since the
 * error-code scheme was introduced. The message match is the fallback for
 * older responses, which carried the reason in prose only. Both are needed:
 * the code is absent on old deployments, and the prose has been reworded more
 * than once.
 *
 * Deliberately NOT matched: 422 alone. That status covers every unprocessable
 * body — a weak password, a malformed address — and treating it as a collision
 * is precisely the over-broad reading this function exists to replace.
 */
export function isEmailTaken(err: CreateUserError | null | undefined): boolean {
  if (!err) return false;
  if (err.code === 'email_exists' || err.code === 'user_already_exists') return true;
  const m = (err.message ?? '').toLowerCase();
  return (
    m.includes('already registered') ||
    m.includes('already been registered') ||
    m.includes('already exists') ||
    m.includes('email address is already in use')
  );
}
