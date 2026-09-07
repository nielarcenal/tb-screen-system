/**
 * What the D-07 gate DOES, as opposed to what it decides.
 *
 * `domain/accountAccess.test.ts` pins the verdicts. This suite pins the
 * consequences, because those are the part that can lose data or leak it:
 *
 *  - a refused sign-in must never reach a sync (that sync is the province-wide
 *    patient pull the whole defect is about);
 *  - a refused sign-in must never wipe the offline cache, which may hold an
 *    entirely different BHW's unsynced work;
 *  - a check that FAILED must never revoke a session, however it failed.
 *
 * Only the edges are faked, in the same style as signOutFlow.test.ts —
 * `supabase.ts` alone would pull in AsyncStorage and fail to load under the
 * node-env config.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const app = {
    deniedAccount: null as unknown,
    rememberAccountDenial: vi.fn((d: unknown) => {
      app.deniedAccount = d;
    }),
  };
  const state = {
    accountAccess: null as unknown,
    beginSignOut: vi.fn(),
    clearSession: vi.fn(),
    setAccountAccess: vi.fn((value: { kind: string }) => {
      // Mirrors the real store: an 'unknown' is discarded, never stored.
      if (value.kind === 'unknown') return;
      state.accountAccess = value;
    }),
  };
  return {
    state,
    app,
    maybeSingle: vi.fn(),
    signOut: vi.fn(async () => ({ error: null })),
    clearSyncableCache: vi.fn(async () => {}),
    triggerSync: vi.fn(async () => {}),
  };
});

vi.mock('./supabase', () => ({
  supabase: {
    auth: { signOut: mocks.signOut },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
  },
}));
vi.mock('../store/sessionStore', () => ({
  useSessionStore: { getState: () => mocks.state },
}));
vi.mock('../store/appStore', () => ({
  useAppStore: { getState: () => mocks.app },
}));
// Imported only to prove it is NEVER reached from this module.
vi.mock('../db/database', () => ({
  clearSyncableCache: mocks.clearSyncableCache,
  countPendingRows: vi.fn(async () => 0),
}));
vi.mock('../sync/syncManager', () => ({ triggerSync: mocks.triggerSync }));

import {
  checkAccountAccess,
  isAccountDenied,
  recordAccountAccess,
  refreshAccountAccess,
  rejectSession,
} from './accountGate';

/** The server answered, with this row. */
const answers = (row: { role: string | null; active: boolean | null } | null) =>
  mocks.maybeSingle.mockResolvedValue({ data: row, error: null });

/** The lookup failed. */
const fails = (message: string) =>
  mocks.maybeSingle.mockResolvedValue({ data: null, error: { message } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.accountAccess = null;
  mocks.app.deniedAccount = null;
});

describe('checking who signed in', () => {
  it('allows an active BHW', async () => {
    answers({ role: 'bhw', active: true });
    expect(await checkAccountAccess('u1', 'deny')).toEqual({ kind: 'allowed' });
  });

  it('refuses a facility account, which is the one that could pull the province', async () => {
    answers({ role: 'tb_dots', active: true });
    expect(await checkAccountAccess('u1', 'deny')).toEqual({
      kind: 'denied',
      reason: 'wrongRole',
      role: 'tb_dots',
    });
  });

  it('refuses a deactivated BHW', async () => {
    answers({ role: 'bhw', active: false });
    expect(await checkAccountAccess('u1', 'deny')).toEqual({
      kind: 'denied',
      reason: 'inactive',
      role: 'bhw',
    });
  });

  it('applies the missing-row policy it was given, in both directions', async () => {
    answers(null);
    expect(await checkAccountAccess('u1', 'deny')).toEqual({
      kind: 'denied',
      reason: 'noAccount',
      role: null,
    });
    answers(null);
    expect(await checkAccountAccess('u1', 'unknown')).toEqual({ kind: 'unknown' });
  });

  it('never throws, whatever the client does', async () => {
    // A rejected promise from the query builder must not escape into a sync
    // pass, where the outer catch would report it as a failed sync.
    mocks.maybeSingle.mockRejectedValue(new Error('boom'));
    expect(await checkAccountAccess('u1', 'unknown')).toEqual({ kind: 'unknown' });
  });
});

describe('the re-check that runs after a successful sync', () => {
  // syncManager itself cannot be loaded here — it imports NetInfo, which is
  // native. What it does on a successful pass is exactly one call to
  // refreshAccountAccess(userId, 'unknown'), so that is what is pinned.

  it('records a deactivation, which is what raises the block screen', async () => {
    mocks.state.accountAccess = { kind: 'allowed' };
    answers({ role: 'bhw', active: false });

    const verdict = await refreshAccountAccess('u1', 'unknown');

    expect(verdict).toEqual({ kind: 'denied', reason: 'inactive', role: 'bhw' });
    expect(mocks.state.accountAccess).toEqual({
      kind: 'denied',
      reason: 'inactive',
      role: 'bhw',
    });
  });

  it('records a role change to a portal account', async () => {
    mocks.state.accountAccess = { kind: 'allowed' };
    answers({ role: 'midwife', active: true });

    await refreshAccountAccess('u1', 'unknown');

    expect(mocks.state.accountAccess).toEqual({
      kind: 'denied',
      reason: 'wrongRole',
      role: 'midwife',
    });
  });

  it('takes the block screen back down when the account is reactivated', async () => {
    mocks.state.accountAccess = { kind: 'denied', reason: 'inactive', role: 'bhw' };
    answers({ role: 'bhw', active: true });

    await refreshAccountAccess('u1', 'unknown');

    expect(mocks.state.accountAccess).toEqual({ kind: 'allowed' });
  });

  it('leaves a working session alone when the check fails', async () => {
    // The requirement, stated as a test: a failed account fetch is UNKNOWN and
    // must not revoke anything. If this fails, a flaky signal blocks a BHW
    // mid-shift.
    mocks.state.accountAccess = { kind: 'allowed' };
    for (const message of ['Network request failed', 'Internal Server Error', 'weird']) {
      fails(message);
      const verdict = await refreshAccountAccess('u1', 'unknown');
      expect(verdict).toEqual({ kind: 'unknown' });
      expect(mocks.state.accountAccess).toEqual({ kind: 'allowed' });
    }
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('leaves a working session alone when the row cannot be read mid-session', async () => {
    mocks.state.accountAccess = { kind: 'allowed' };
    answers(null);

    await refreshAccountAccess('u1', 'unknown');

    expect(mocks.state.accountAccess).toEqual({ kind: 'allowed' });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});

describe('remembering a refusal across restarts', () => {
  // The A54 found the hole this closes: with the verdict held only in memory, a
  // refused BHW could force-stop the app, go offline and relaunch into a fully
  // working app — the launch lookup failed, 'unknown' does not block, and the
  // block screen never came back.

  it('writes a refusal to the persistent store', async () => {
    answers({ role: 'bhw', active: false });

    await refreshAccountAccess('u1', 'unknown');

    expect(mocks.app.deniedAccount).toEqual({ reason: 'inactive', role: 'bhw' });
  });

  it('erases it once the account is allowed again', async () => {
    mocks.app.deniedAccount = { reason: 'inactive', role: 'bhw' };
    answers({ role: 'bhw', active: true });

    await refreshAccountAccess('u1', 'unknown');

    expect(mocks.app.deniedAccount).toBeNull();
  });

  it('leaves it untouched when the check fails', async () => {
    // The offline rule still holds in BOTH directions: a failed lookup neither
    // revokes a good session nor invents a block screen.
    mocks.app.deniedAccount = { reason: 'inactive', role: 'bhw' };
    fails('Network request failed');

    await refreshAccountAccess('u1', 'unknown');

    expect(mocks.app.deniedAccount).toEqual({ reason: 'inactive', role: 'bhw' });
    expect(mocks.app.rememberAccountDenial).not.toHaveBeenCalled();
  });

  it('never invents a refusal from a failed lookup on a clean device', async () => {
    fails('Internal Server Error');

    await refreshAccountAccess('u1', 'unknown');

    expect(mocks.app.deniedAccount).toBeNull();
  });

  it('does not write anything at all for an unknown verdict', () => {
    recordAccountAccess({ kind: 'unknown' });

    expect(mocks.state.setAccountAccess).not.toHaveBeenCalled();
    expect(mocks.app.rememberAccountDenial).not.toHaveBeenCalled();
  });
});

describe('is this device refused right now', () => {
  it('uses the live verdict when there is one', () => {
    mocks.state.accountAccess = { kind: 'allowed' };
    mocks.app.deniedAccount = { reason: 'inactive', role: 'bhw' };

    // A fresh 'allowed' beats a stale memory — this is how a reactivated
    // account gets back in rather than being stuck behind an old refusal.
    expect(isAccountDenied()).toBe(false);
  });

  it('falls back to the remembered refusal before any lookup returns', () => {
    // Cold start: the live verdict is still null. This is the exact state the
    // bypass exploited.
    mocks.state.accountAccess = null;
    mocks.app.deniedAccount = { reason: 'inactive', role: 'bhw' };

    expect(isAccountDenied()).toBe(true);
  });

  it('is false on a clean device with nothing known', () => {
    expect(isAccountDenied()).toBe(false);
  });
});

describe('refusing a sign-in', () => {
  it('ends the session without ever syncing', async () => {
    await rejectSession();

    // The whole point: no pull happened, so no patient data reached this phone.
    expect(mocks.triggerSync).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.state.clearSession).toHaveBeenCalledOnce();
  });

  it('marks the sign-out deliberate BEFORE it happens', async () => {
    await rejectSession();

    // Order matters. clearSession() reads the signingOut latch to decide
    // whether the session "expired"; setting it late would put a stray
    // "your session ended" banner on top of the refusal that just explained
    // exactly what happened.
    expect(mocks.state.beginSignOut).toHaveBeenCalledOnce();
    expect(mocks.state.beginSignOut.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signOut.mock.invocationCallOrder[0],
    );
  });

  it('never wipes the offline cache', async () => {
    // A session can expire while a BHW still holds unsynced rows, which leaves
    // them at the sign-in screen with their morning's work in sqlite. Wiping on
    // a refusal would destroy the work of a BHW who did nothing but let someone
    // type the wrong account. Cache wiping stays behind the guarded sign-out in
    // signOutFlow.ts, which counts pending rows and asks first.
    await rejectSession();

    expect(mocks.clearSyncableCache).not.toHaveBeenCalled();
  });
});
