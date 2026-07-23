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
import { isSupabaseConfigured } from '../lib/env';
import { syncAll } from './syncEngine';
import { useSyncStore } from '../store/syncStore';
import { useAppStore } from '../store/appStore';

let inFlight = false;
let rerunRequested = false;
let netInfoUnsub: (() => void) | null = null;

/** Treat "connected AND internet reachable (or unknown)" as online. */
function deriveOnline(state: NetInfoState): boolean {
  return !!state.isConnected && state.isInternetReachable !== false;
}

/**
 * Run one sync pass, guarded. Safe to call from anywhere (button, reconnect,
 * app-foreground). No-ops (queues a rerun) if a sync is already running.
 */
export async function triggerSync(): Promise<void> {
  if (inFlight) {
    rerunRequested = true;
    return;
  }

  // No backend configured yet (no .env) — stay offline-only, rows wait.
  if (!isSupabaseConfigured) return;

  // Can't sync without a session — RLS would reject writes. Leave rows pending.
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;

  const store = useSyncStore.getState();
  inFlight = true;
  store.set({ phase: 'syncing', lastError: null });
  try {
    const { pushed, pulled } = await syncAll();
    await pushAssignedBarangayIfDirty(data.session.user.id);
    useAppStore.getState().setLastSyncAt(new Date().toISOString());
    store.set({ lastResult: `pushed ${pushed}, pulled ${pulled}` });
  } catch (e) {
    store.set({ lastError: e instanceof Error ? e.message : String(e) });
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
      void triggerSync(); // just came back online
    }
    wasOnline = online;
  });
  return netInfoUnsub;
}

export function stopAutoSync(): void {
  if (netInfoUnsub) {
    netInfoUnsub();
    netInfoUnsub = null;
  }
}
