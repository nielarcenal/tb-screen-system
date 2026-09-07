/**
 * Who the BHW app lets in (D-07).
 *
 * `sign-in.tsx` used to authenticate and then never ask the server WHO had
 * signed in. Nothing checked `users.role` or `users.active`, so:
 *
 *  - A `tb_dots` account signing in on a phone satisfied 0007's
 *    `patients_tbdots_read`, which is an unconditional `true` for that role, and
 *    the first sync wrote EVERY patient in the province into that handset's
 *    sqlite file.
 *  - Midwife and admin accounts signed in successfully and then got an app
 *    where every query was denied, with no explanation.
 *  - A deactivated BHW's phone had no way to say so. (The auth ban that
 *    `manage-bhw` applies is what actually blocks a deactivated sign-in — see
 *    `accountGate.ts` — so this half is defence in depth plus an honest
 *    message, not the wall.)
 *
 * WHY THREE ANSWERS AND NOT TWO. The app is offline-first, and a two-state
 * gate has to decide what an UNANSWERED question means. Both readings are
 * wrong: "allowed" defeats the gate, "denied" throws a BHW out mid-shift
 * because the signal dropped. So a failed lookup is its own answer —
 * `unknown` — which never blocks and never revokes. This mirrors the tri-state
 * `mustChangePassword` in `sessionStore.ts`, which carries the same doctrine
 * for the same reason.
 *
 * This module is pure — it imports nothing — so it stays loadable under the
 * node-env vitest config (see vitest.config.mts, which cannot load the Expo
 * screens at all). The screens hand it what Supabase returned and act on the
 * verdict; the decision itself lives here where it can be tested.
 */

/** Why an account was turned away. Picks which message the BHW reads. */
export type DeniedReason =
  /** An active account, but not a BHW one — belongs on the portal. */
  | 'wrongRole'
  /** A BHW account that has been deactivated. */
  | 'inactive'
  /** Authenticated, but no `users` row came back. Sign-in only; see below. */
  | 'noAccount';

/** The answer. `unknown` is not a failure mode — it is a real third state. */
export type AccountAccess =
  | { kind: 'allowed' }
  | { kind: 'denied'; reason: DeniedReason; role: string | null }
  | { kind: 'unknown' };

/** A verdict the server actually gave. `unknown` is deliberately not one. */
export type SettledAccountAccess = Extract<AccountAccess, { kind: 'allowed' | 'denied' }>;

/**
 * What a missing row means, which depends on WHERE the question is asked.
 *
 *  - `'deny'` — at sign-in. Nothing is at stake yet: no local data, no unsynced
 *    work. Failing closed costs at most a confusing message for an account that
 *    is genuinely broken, and it is the only moment the province-wide read can
 *    be stopped before it happens.
 *  - `'unknown'` — for a session already running. `.maybeSingle()` returns
 *    `{ data: null, error: null }` both when the row is absent AND when RLS
 *    declines to show it, so a null here is more likely a policy quirk than a
 *    real revocation. Being wrong strands a BHW in front of a flow that can
 *    destroy their morning's work, so this direction fails open.
 *
 * The asymmetry costs nothing where it matters: the leak this defect is about
 * happens at sign-in, not mid-session.
 */
export type MissingRowPolicy = 'deny' | 'unknown';

/** The two columns the verdict turns on, as PostgREST returns them. */
export interface AccountRowLike {
  role?: string | null;
  active?: boolean | null;
}

/** The shape of a Supabase/PostgREST error, narrowed to what we look at. */
export interface AccountErrorLike {
  message: string;
  code?: string;
}

/** What `.maybeSingle()` resolves to, narrowed to what this module needs. */
export interface AccountLookup {
  data: AccountRowLike | null;
  error: AccountErrorLike | null;
}

/** The only role this app is for. */
const BHW_ROLE = 'bhw';

/**
 * Turn one `users` lookup into a verdict.
 *
 * ANY error is `unknown` — not just a connectivity one. A 500 from PostgREST is
 * not evidence that an account was revoked, and message-sniffing for "is this
 * really a network problem" is a heuristic we would be betting a BHW's shift
 * on. Treating every error alike is what makes "no server hiccup can sign you
 * out" true rather than approximately true.
 */
export function evaluateAccountAccess(
  lookup: AccountLookup,
  missingRow: MissingRowPolicy,
): AccountAccess {
  if (lookup.error) return { kind: 'unknown' };

  const row = lookup.data;
  if (!row) {
    return missingRow === 'deny'
      ? { kind: 'denied', reason: 'noAccount', role: null }
      : { kind: 'unknown' };
  }

  const role = row.role ?? null;

  // Role first, so a facility or midwife account is told where it DOES belong
  // rather than being told it was deactivated. An unrecognised role lands here
  // too: a migration that adds a role must not accidentally open the phone.
  if (role !== BHW_ROLE) return { kind: 'denied', reason: 'wrongRole', role };

  // Only an explicit `false` deactivates. The column is `not null default true`
  // server-side (0006), so a null means the select shape changed underneath us,
  // not that anybody was deactivated — and that is not grounds to lock a BHW
  // out of their own patients.
  if (row.active === false) return { kind: 'denied', reason: 'inactive', role };

  return { kind: 'allowed' };
}

/**
 * Which destination the "wrong app" message should name.
 *
 * Spelled out rather than built from the role string, so every key in this
 * module can be grepped for in the locale bundles — same idiom as
 * `PROBLEM_MESSAGE` in ChangePasswordGate.
 */
export function roleDestinationKey(role: string | null): string {
  switch (role) {
    case 'tb_dots':
      return 'blocked.roleFacility';
    case 'midwife':
      return 'blocked.roleMidwife';
    case 'admin':
      return 'blocked.roleAdmin';
    default:
      return 'blocked.roleOther';
  }
}
