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
 */
import { Alert } from 'react-native';

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
 * `onBusyChange` brackets the sync, so the caller can disable its button.
 */
export function confirmSignOut(t: Translate, onBusyChange?: (busy: boolean) => void): void {
  Alert.alert(t('settings.signOutConfirmTitle'), t('settings.signOutConfirmBody'), [
    { text: t('common.cancel'), style: 'cancel' },
    {
      text: t('settings.signOut'),
      style: 'destructive',
      onPress: () => {
        void (async () => {
          onBusyChange?.(true);
          try {
            await triggerSync(); // push pending rows if we're online
            const pending = await countPendingRows();
            if (pending === 0) {
              await performSignOut();
              return;
            }
            Alert.alert(
              t('settings.signOutPendingTitle'),
              t('settings.signOutPendingBody', { count: pending }),
              [
                { text: t('settings.staySignedIn'), style: 'cancel' },
                {
                  text: t('settings.signOutDiscard'),
                  style: 'destructive',
                  onPress: () => void performSignOut(),
                },
              ],
            );
          } finally {
            onBusyChange?.(false);
          }
        })();
      },
    },
  ]);
}
