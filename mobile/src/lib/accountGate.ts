/**
 * Asking the server who signed in, and acting on the answer (D-07).
 *
 * The decision itself is in `domain/accountAccess.ts`, which imports nothing
 * and is tested on its own. This module is the half that touches Supabase and
 * the session store, kept separate so both can be exercised with only their
 * edges faked — the same split, and the same `vi.mock` pattern, as
 * `signOutFlow.ts` / `signOutFlow.test.ts`.
 *
 * WHAT THIS IS NOT: enforcement. A client gate is a UX guarantee — a modified
 * app or a raw PostgREST call still reads whatever RLS allows, and 0007's
 * `patients_tbdots_read` currently allows a facility account to read every
 * patient in the province. The durable fix is server-side and is deliberately
 * out of scope here.
 *
 * What it DOES close, in practice:
 *  - the phone is no longer the place a facility, midwife or admin account can
 *    accidentally sync a province of patients onto;
 *  - a deactivated BHW is told they were deactivated instead of being shown
 *    "your session expired" (the auth ban that `manage-bhw` applies at
 *    index.ts:379 is what actually blocks their sign-in — this is what makes
 *    the phone honest about it).
 */
import { supabase } from './supabase';
import {
  AccountAccess,
  MissingRowPolicy,
  evaluateAccountAccess,
} from '../domain/accountAccess';
import { useSessionStore } from '../store/sessionStore';
import { useAppStore } from '../store/appStore';

/**
 * Read this account's role and active flag and turn them into a verdict.
 *
 * Never throws: every failure — offline, a 5xx, an RLS refusal, or something
 * unrecognised — becomes `unknown`, which blocks nothing and revokes nothing.
 * Callers can therefore await this on any path without a try/catch, including
 * inside a sync pass where a throw would be misreported as a sync failure.
 */
export async function checkAccountAccess(
  userId: string,
  missingRow: MissingRowPolicy,
): Promise<AccountAccess> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('role, active')
      .eq('user_id', userId)
      .maybeSingle();
    return evaluateAccountAccess({ data, error }, missingRow);
  } catch {
    return { kind: 'unknown' };
  }
}

/**
 * Record a verdict everywhere it has to be known.
 *
 * Two stores, deliberately:
 *  - the transient sessionStore holds the LIVE verdict for this run;
 *  - the persistent appStore REMEMBERS a refusal across restarts.
 *
 * The second exists because of a bypass found on the A54: with the verdict held
 * only in memory, a refused BHW could force-stop the app, go offline, and
 * relaunch into a fully working app — the launch lookup failed, 'unknown' does
 * not block, and the block screen never came back.
 *
 * An `unknown` still writes nothing to either store, so a failed check cannot
 * revoke a session OR raise a block screen. Only a definite answer moves
 * anything, and an `allowed` erases a remembered refusal — that is how a
 * reactivated account gets back in.
 */
export function recordAccountAccess(verdict: AccountAccess): void {
  if (verdict.kind === 'unknown') return;
  useSessionStore.getState().setAccountAccess(verdict);
  useAppStore
    .getState()
    .rememberAccountDenial(
      verdict.kind === 'denied' ? { reason: verdict.reason, role: verdict.role } : null,
    );
}

/**
 * Check, and record the answer for the rest of the app to react to.
 *
 * A denial recorded here is what raises the block screen; a later `allowed` (an
 * account reactivated) takes it back down again.
 */
export async function refreshAccountAccess(
  userId: string,
  missingRow: MissingRowPolicy,
): Promise<AccountAccess> {
  const verdict = await checkAccountAccess(userId, missingRow);
  recordAccountAccess(verdict);
  return verdict;
}

/**
 * Is this device's account refused right now?
 *
 * Consults the live verdict first and falls back to the remembered one, which
 * is the only thing that exists on a cold start before any lookup has come
 * back. Used by the sync guard so a refused account cannot pull patient data in
 * that window either.
 */
export function isAccountDenied(): boolean {
  const live = useSessionStore.getState().accountAccess;
  if (live) return live.kind === 'denied';
  return useAppStore.getState().deniedAccount !== null;
}

/**
 * End a session that was refused at sign-in.
 *
 * `beginSignOut()` first, so the SIGNED_OUT event that follows is read as
 * deliberate rather than as an expiry — otherwise the home screen would
 * announce "your session ended" on top of the refusal that just explained why.
 *
 * IT DOES NOT WIPE THE OFFLINE CACHE, and that is deliberate. A session can
 * expire while a BHW still holds unsynced rows, which leaves them at the
 * sign-in screen with their morning's work in sqlite. If somebody then typed
 * the wrong account into that screen, wiping on refusal would destroy work
 * belonging to a BHW who did nothing wrong. Nothing was pulled for the refused
 * account either — the refusal happens before any sync — so there is nothing of
 * theirs to clear. Cache wiping stays where it has always been: behind the
 * guarded sign-out in `signOutFlow.ts`, which counts pending rows and asks.
 */
export async function rejectSession(): Promise<void> {
  const session = useSessionStore.getState();
  session.beginSignOut();
  // scope: 'local' ends THIS device's session only; the default would revoke
  // the account everywhere, which for a facility account that merely opened the
  // wrong app would sign them out of the portal they are actually working in.
  await supabase.auth.signOut({ scope: 'local' });
  session.clearSession();
}
