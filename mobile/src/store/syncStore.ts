/**
 * TRANSIENT store — live sync/connectivity status for the UI. Not persisted (§3):
 * it reflects the current moment only and is rebuilt each launch.
 */
import { create } from 'zustand';

export type SyncPhase = 'idle' | 'syncing';

/**
 * A failed sync, classified for the UI.
 *  - 'offline'  — a connectivity problem (no internet / DNS can't resolve the
 *    host / timeout). Shown as a plain, reassuring message.
 *  - 'partial'  — the pass ran to the end but the server refused some rows
 *    (D-10). Everything else went through and the refused rows stay queued.
 *    `count` is how many. This must stay visible: a partial failure that looks
 *    like a clean sync is the dangerous case, because a BHW would believe
 *    records had been uploaded when they had not.
 *  - 'unknown'  — an unexpected failure, where `detail` (the raw error) is
 *    surfaced so it can be diagnosed in the field.
 */
export type SyncError = {
  kind: 'offline' | 'partial' | 'unknown';
  detail: string;
  /** Number of rows refused. Only set when kind is 'partial'. */
  count?: number;
};

interface SyncState {
  isOnline: boolean | null; // null = unknown until first NetInfo event
  phase: SyncPhase;
  lastError: SyncError | null;
  lastResult: string | null; // e.g. "pushed 1, pulled 0"
  set: (patch: Partial<Omit<SyncState, 'set'>>) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  isOnline: null,
  phase: 'idle',
  lastError: null,
  lastResult: null,
  set: (patch) => set(patch),
}));
