/**
 * The guarded sign-out, exercised end to end with only its edges faked.
 *
 * This suite exists because the flow ends in `clearSyncableCache()`, which
 * destroys a BHW's unsynced work and cannot be undone. Everything here is one
 * question: which paths reach that call. The dialog is real (confirmDialog.ts
 * imports no React Native), so these tests drive it exactly as the on-screen
 * host does — by resolving whatever is currently pending.
 *
 * It also pins WHICH label is the safe one, because the host renders
 * `cancelLabel` first and `confirmLabel` in red. If those two were ever swapped
 * here, the screen would quietly invite the BHW to delete — which is precisely
 * the defect this replaced `Alert.alert` for.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { answerConfirm, useConfirmDialogStore } from './confirmDialog';

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(async () => ({ error: null })),
  clearSyncableCache: vi.fn(async () => {}),
  countPendingRows: vi.fn(async () => 0),
  triggerSync: vi.fn(async () => {}),
  beginSignOut: vi.fn(),
  clearSession: vi.fn(),
}));

vi.mock('./supabase', () => ({ supabase: { auth: { signOut: mocks.signOut } } }));
vi.mock('../db/database', () => ({
  clearSyncableCache: mocks.clearSyncableCache,
  countPendingRows: mocks.countPendingRows,
}));
vi.mock('../sync/syncManager', () => ({ triggerSync: mocks.triggerSync }));
vi.mock('../store/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({ beginSignOut: mocks.beginSignOut, clearSession: mocks.clearSession }),
  },
}));

// vi.mock is hoisted above this import, so the flow binds to the fakes above
// rather than the real modules — `supabase.ts` alone would pull in AsyncStorage
// and fail to load under the node-env config.
import { confirmSignOut } from './signOutFlow';

/** Keys, not English: the flow's job is to pass the right key, not the right prose. */
const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}(${JSON.stringify(options)})` : key;

/** Let the flow's awaits settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Answer the dialog the flow is currently showing, and hand it back. */
async function answerShown(confirmed: boolean) {
  await flush();
  const shown = useConfirmDialogStore.getState().pending;
  expect(shown, 'expected a dialog to be showing').not.toBeNull();
  answerConfirm(shown!.id, confirmed);
  await flush();
  return shown!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.countPendingRows.mockResolvedValue(0);
  useConfirmDialogStore.setState({ pending: null });
});

describe('the first question', () => {
  it('offers cancel as the safe answer and sign-out as the acting one', async () => {
    confirmSignOut(t);
    const shown = await answerShown(false);

    expect(shown.title).toBe('settings.signOutConfirmTitle');
    expect(shown.body).toBe('settings.signOutConfirmBody');
    expect(shown.cancelLabel).toBe('common.cancel');
    expect(shown.confirmLabel).toBe('settings.signOut');
  });

  it('answered no, changes nothing at all — not even a sync', async () => {
    confirmSignOut(t);
    await answerShown(false);

    expect(mocks.triggerSync).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.clearSyncableCache).not.toHaveBeenCalled();
  });
});

describe('when everything is uploaded', () => {
  it('signs out without asking a second time', async () => {
    mocks.countPendingRows.mockResolvedValue(0);
    confirmSignOut(t);
    await answerShown(true);

    expect(mocks.triggerSync).toHaveBeenCalledOnce();
    expect(mocks.beginSignOut).toHaveBeenCalledOnce();
    // 'local' ends this device's session only; 'global' would sign the same
    // BHW out of their other phone and the web portal mid-shift.
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.clearSyncableCache).toHaveBeenCalledOnce();
    expect(useConfirmDialogStore.getState().pending).toBeNull();
  });
});

describe('when rows could not be uploaded', () => {
  it('asks again, naming the count, with staying signed in as the safe answer', async () => {
    mocks.countPendingRows.mockResolvedValue(2);
    confirmSignOut(t);
    await answerShown(true);

    const second = useConfirmDialogStore.getState().pending;
    expect(second).not.toBeNull();
    expect(second!.title).toBe('settings.signOutPendingTitle');
    expect(second!.body).toBe('settings.signOutPendingBody({"count":2})');
    // The host draws cancelLabel first and confirmLabel in red. Staying signed
    // in must be the one that reads first.
    expect(second!.cancelLabel).toBe('settings.staySignedIn');
    expect(second!.confirmLabel).toBe('settings.signOutDiscard');
  });

  it('keeps the records when the BHW stays signed in', async () => {
    mocks.countPendingRows.mockResolvedValue(2);
    confirmSignOut(t);
    await answerShown(true);
    await answerShown(false);

    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.clearSyncableCache).not.toHaveBeenCalled();
  });

  it('keeps the records when the second dialog is dismissed rather than answered', async () => {
    mocks.countPendingRows.mockResolvedValue(2);
    confirmSignOut(t);
    await answerShown(true);

    // Back button / tap outside — the host resolves those as false.
    const second = useConfirmDialogStore.getState().pending!;
    answerConfirm(second.id, false);
    await flush();

    expect(mocks.clearSyncableCache).not.toHaveBeenCalled();
  });

  it('discards them only on an explicit yes', async () => {
    mocks.countPendingRows.mockResolvedValue(2);
    confirmSignOut(t);
    await answerShown(true);
    await answerShown(true);

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.clearSyncableCache).toHaveBeenCalledOnce();
  });
});

describe('the busy flag', () => {
  it('brackets the sync and is cleared before the BHW is asked to read anything', async () => {
    mocks.countPendingRows.mockResolvedValue(2);
    const busy: boolean[] = [];
    confirmSignOut(t, (b) => busy.push(b));

    await answerShown(true);
    // The second dialog is up; the BHW is reading, not being waited on, so the
    // button behind it must not still be spinning.
    expect(useConfirmDialogStore.getState().pending).not.toBeNull();
    expect(busy).toEqual([true, false]);
  });
});
