/**
 * Sync orchestration + automatic on-reconnect triggering (§7).
 *
 * Responsibilities:
 *  - Subscribe to connectivity (NetInfo) and fire a sync when the device goes
 *    from offline → online.
 *  - Serialize syncs: never run two at once; if a trigger arrives mid-sync,
 *    remember it and run exactly one more pass afterward (so a patient enrolled
 *    during a sync isn't stranded).
 *  - Skip silently when there is no auth session (an unauthenticated sync can't
 *    satisfy RLS; the pending rows simply wait).
 *  - Reflect status in the transient syncStore for the UI.
 *
 * Drives syncAll() (patients + screenings; later tables join there).
 */
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

import { supabase } from '../lib/supabase';
import { isAccountDenied, refreshAccountAccess } from '../lib/accountGate';
import { isSupabaseConfigured } from '../lib/env';
import { syncAll } from './syncEngine';
import { isConnectivityError } from './syncErrors';
import { useSyncStore } from '../store/syncStore';
import { useAppStore } from '../store/appStore';

let inFlight = false;
let rerunRequested = false;
let netInfoUnsub: (() => void) | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * How long to let a new connection settle before syncing. NetInfo reports
 * "online" the moment the phone associates with a Wi-Fi network, which is
 * before DNS and routing are actually usable — and the first thing a sync does
 * is refresh the auth token. A refresh sent into a half-up network can reach
 * the server and lose the reply, which burns the refresh token and signs the
 * BHW out. Waiting a few seconds costs nothing and avoids that window.
 */
const RECONNECT_SETTLE_MS = 4000;

/** Treat "connected AND internet reachable (or unknown)" as online. */
function deriveOnline(state: NetInfoState): boolean {
  return !!state.isConnected && state.isInternetReachable !== false;
}

/**
 * Run one sync pass, guarded. Safe to call from anywhere (button, reconnect,
 * app-foreground). No-ops (queues a rerun) if a sync is already running.
 */
export async function triggerSync(options?: {
  /**
   * Run even when the account has been refused (D-07). Set by the guarded
   * sign-out ONLY: that pass is the last chance to get a BHW's unsynced
   * patients to the server before the cache is wiped, and skipping it would
   * make the "N records could not be uploaded" count a lie — it would name
   * rows that were never even offered.
   */
  allowBlockedAccount?: boolean;
}): Promise<void> {
  if (inFlight) {
    rerunRequested = true;
    return;
  }

  // No backend configured yet (no .env) — stay offline-only, rows wait.
  if (!isSupabaseConfigured) return;

  // Can't sync without a session — RLS would reject writes. Leave rows pending.
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;

  // D-07: a refused account must not PULL patient data, and the sign-out that
  // follows a refusal is not instantaneous — the mid-session path waits on a
  // BHW reading a dialog. Without this guard, startAutoSync's reconnect timer
  // could fire a pass inside that window. Belt and braces: the refusal itself
  // already returns before triggerSync at sign-in, and ends the session after.
  //
  // The guarded sign-out opts out (above), because its pass exists to PUSH.
  if (!options?.allowBlockedAccount && isAccountDenied()) return;

  const store = useSyncStore.getState();
  inFlight = true;
  store.set({ phase: 'syncing', lastError: null });
  try {
    const { pushed, pulled, failures } = await syncAll();
    await pushAssignedBarangayIfDirty(data.session.user.id);
    useAppStore.getState().setLastSyncAt(new Date().toISOString());
    store.set({ lastResult: `pushed ${pushed}, pulled ${pulled}` });

    // D-07: re-ask who this is on every pass that got through. A BHW who is
    // deactivated, or whose role is changed, keeps a working session until the
    // access token expires, and nothing else on the device would notice —
    // manage-bhw changes the server row, not the phone. This is the cheapest
    // honest signal: the pass has already proved connectivity, so the answer
    // costs one small query and lands within one sync cycle.
    //
    // 'unknown' on a missing row here, not 'deny': mid-session a null cannot be
    // told apart from RLS declining to show the row, and refreshAccountAccess
    // discards an 'unknown' rather than storing it, so a failed check leaves an
    // existing session exactly as it was. It never revokes.
    await refreshAccountAccess(data.session.user.id, 'unknown');

    // The pass finished, but the server refused some rows (D-10). They are
    // still queued and will be retried, so this is not a failed sync — but it
    // must not read as a clean one either.
    if (failures.length > 0) {
      store.set({
        lastError: {
          kind: 'partial',
          count: failures.length,
          detail: failures.map((f) => `${f.row ?? f.table}: ${f.message}`).join('; '),
        },
      });
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    store.set({
      lastError: { kind: isConnectivityError(detail) ? 'offline' : 'unknown', detail },
    });
  } finally {
    inFlight = false;
    store.set({ phase: 'idle' });
    if (rerunRequested) {
      rerunRequested = false;
      void triggerSync();
    }
  }
}

/**
 * Best-effort push of the BHW's assigned barangay (Settings, §6) to their own
 * users row. Allowed by the users_update_self RLS policy. Non-fatal: if it
 * fails we stay dirty and retry on the next sync.
 */
async function pushAssignedBarangayIfDirty(userId: string): Promise<void> {
  const app = useAppStore.getState();
  if (!app.assignedBarangayDirty || !app.assignedBarangayCode) return;
  const { error } = await supabase
    .from('users')
    .update({ assigned_barangay_code: app.assignedBarangayCode })
    .eq('user_id', userId);
  if (!error) app.markAssignedBarangayPushed();
}

/**
 * Start listening for connectivity changes. Fires a sync on each offline→online
 * transition. Returns an unsubscribe fn; also stored so stopAutoSync() works.
 */
export function startAutoSync(): () => void {
  if (netInfoUnsub) return netInfoUnsub; // already started

  let wasOnline: boolean | null = null;
  netInfoUnsub = NetInfo.addEventListener((state) => {
    const online = deriveOnline(state);
    useSyncStore.getState().set({ isOnline: online });
    if (online && wasOnline === false) {
      // Just came back online (or moved to another Wi-Fi). Let it settle, and
      // restart the wait if connectivity flaps again in the meantime.
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void triggerSync();
      }, RECONNECT_SETTLE_MS);
    } else if (!online && reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    wasOnline = online;
  });
  return netInfoUnsub;
}

export function stopAutoSync(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (netInfoUnsub) {
    netInfoUnsub();
    netInfoUnsub = null;
  }
}
