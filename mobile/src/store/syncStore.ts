/**
 * TRANSIENT store — live sync/connectivity status for the UI. Not persisted (§3):
 * it reflects the current moment only and is rebuilt each launch.
 */
import { create } from 'zustand';

export type SyncPhase = 'idle' | 'syncing';

/**
 * A failed sync, classified for the UI. 'offline' = a connectivity problem
 * (no internet / DNS can't resolve the host / timeout) — shown as a plain,
 * reassuring message. 'unknown' = an unexpected failure, where `detail` (the
 * raw error) is surfaced so it can be diagnosed in the field.
 */
export type SyncError = { kind: 'offline' | 'unknown'; detail: string };

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
