/**
 * The guarded sign-out (D-02), extracted from the Settings screen so the
 * forced-password-change gate can offer the same escape hatch.
 *
 * It is NOT duplicated for the gate deliberately: this flow ends with an
 * irreversible wipe of the offline cache, and two copies of an irreversible
 * path drift. One of them then wipes a BHW's unsynced work without the
 * "1 record could not be uploaded" question that exists to prevent exactly
 * that. The behaviour here is unchanged from the Settings version it came
 * from — same order, same two dialogs, same wording.
 *
 * The dialogs are drawn by the app (showConfirm) rather than by
 * `Alert.alert`, because Android renders a stacked AlertDialog's POSITIVE
 * button on top and the Tagalog/Cebuano labels are long enough to stack —
 * which put "sign out and delete" in the first-read position. The full
 * reasoning, and why shortening the translations was rejected, is in
 * confirmDialog.ts.
 */
import { showConfirm } from './confirmDialog';
import { supabase } from './supabase';
import { clearSyncableCache, countPendingRows } from '../db/database';
import { useSessionStore } from '../store/sessionStore';
import { triggerSync } from '../sync/syncManager';

/** Structural stand-in for react-i18next's `t`, so callers just pass theirs. */
type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * End the session and wipe the offline cache, so another account on the same
 * phone can never read the previous account's patients (the server scopes each
 * pull; the cache must not outlive the session that fetched it).
 *
 * Only ever called once we know nothing unsynced is about to be destroyed, or
 * once the BHW has explicitly agreed to discard it.
 */
async function performSignOut(): Promise<void> {
  const session = useSessionStore.getState();
  session.beginSignOut(); // marks the SIGNED_OUT below as deliberate, not expiry
  // scope: 'local' ends THIS device's session only. The default ('global')
  // revokes the account everywhere, which signed the same BHW out of their
  // other phone or the web portal mid-shift.
  await supabase.auth.signOut({ scope: 'local' }); // listener clears the store too
  session.clearSession();
  await clearSyncableCache();
}

/**
 * Sign out, with a final push first so a day's work isn't lost when online.
 *
 * The cache wipe is irreversible, so it must not run on a guess: triggerSync()
 * never throws (it records failures in useSyncStore.lastError), so wrapping it
 * in try/catch proves nothing. Instead we ask the database afterwards how many
 * rows are still pending, and only wipe when the answer is zero — otherwise the
 * BHW is told exactly how many records would be destroyed and can stay signed
 * in until they find a signal.
 *
 * `onBusyChange` brackets the sync, so the caller can disable its button. It is
 * cleared before the second question is asked: the BHW is being asked to read
 * something, not waited on.
 *
 * Returns void rather than the promise it runs, because both callers are
 * `onPress` handlers with nothing to await.
 */
export function confirmSignOut(t: Translate, onBusyChange?: (busy: boolean) => void): void {
  void (async () => {
    const goAhead = await showConfirm({
      title: t('settings.signOutConfirmTitle'),
      body: t('settings.signOutConfirmBody'),
      cancelLabel: t('common.cancel'),
      confirmLabel: t('settings.signOut'),
    });
    if (!goAhead) return;

    let stillPending = 0;
    onBusyChange?.(true);
    try {
      // allowBlockedAccount: this runs from the D-07 block screen too, where
      // the account has been refused and ordinary syncs are suppressed. This
      // pass is the one that must still go: it is the last chance to get a
      // BHW's unsynced patients to the server before the cache is wiped, and
      // the count below is only truthful if the rows were actually offered.
      await triggerSync({ allowBlockedAccount: true }); // push pending rows if online
      stillPending = await countPendingRows();
      if (stillPending === 0) {
        await performSignOut();
        return;
      }
    } finally {
      onBusyChange?.(false);
    }

    const discard = await showConfirm({
      title: t('settings.signOutPendingTitle'),
      body: t('settings.signOutPendingBody', { count: stillPending }),
      cancelLabel: t('settings.staySignedIn'),
      confirmLabel: t('settings.signOutDiscard'),
    });
    if (discard) await performSignOut();
  })();
}
