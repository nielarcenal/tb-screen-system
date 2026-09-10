/**
 * Which sync message Home shows, and in what tone.
 *
 * This is a presentation decision, not a classification one — `syncErrors.ts`
 * has already decided WHAT went wrong; this decides what the BHW reads about
 * it. It lives in a plain module with no React Native imports so it can be
 * tested: `app/(tabs)/index.tsx` is a .tsx and vitest's node-env config cannot
 * load it at all.
 *
 * Two rules drive everything here, and both come from the design:
 *
 *  1. **Offline is calm and never red.** `tokens.ts` says it in as many words
 *     ("offline is a calm neutral, never red"), DESIGN_BRIEF §7 asks the design
 *     to show what is waiting to sync "without nagging", and `syncStore`'s own
 *     doc-comment on `kind: 'offline'` promises "a plain, reassuring message".
 *     Being out of signal in a barangay is the normal working condition, not a
 *     fault the BHW caused or can fix.
 *  2. **A partial failure must stay loud.** That is the dangerous case: rows the
 *     server refused, on a pass that otherwise looks clean. A BHW who believes
 *     records were uploaded when they were not is the one outcome worth
 *     alarming about.
 *
 * The offline note deliberately does NOT use `home.neverSynced`. That string
 * ("Not synced yet — tap the button above when online.") is a statement about
 * history, and the offline banner is a statement about right now. Rendering it
 * on `isOnline === false` alone put it directly above "Last synced 25/08/2026,
 * 10:06:59" on an offline cold start — two lines flatly contradicting each
 * other, with the alarming and untrue one on top. `home.neverSynced` still has
 * one correct use, as the fallback of the last-synced line, where it really is
 * reporting history.
 */
import type { SyncError } from '../store/syncStore';

/** How a notice should be painted. The screen owns the actual colors. */
export type NoticeTone =
  /** Neutral/secondary ink. Informational — nothing is wrong. */
  | 'calm'
  /** Error ink. Reserved for work that may not have reached the server. */
  | 'alarm';

export interface SyncNotice {
  /** i18n key, passed to `t()` by the screen. */
  key: string;
  /** Interpolation values for that key, if it takes any. */
  params?: Record<string, string | number>;
  tone: NoticeTone;
}

export interface SyncNoticeInput {
  /** `null` until the first NetInfo event — unknown, so claim nothing. */
  isOnline: boolean | null;
  lastError: SyncError | null;
}

export interface SyncNotices {
  /** The standing note near the top of Home. */
  offline: SyncNotice | null;
  /** The line under the sync button, reporting how the last pass ended. */
  error: SyncNotice | null;
}

export function syncNotices({ isOnline, lastError }: SyncNoticeInput): SyncNotices {
  // `null` means NetInfo has not reported yet. Showing an offline note then
  // would be a guess, and it is the alarming direction to guess in.
  const offline: SyncNotice | null =
    isOnline === false ? { key: 'home.syncOffline', tone: 'calm' } : null;

  return { offline, error: errorNotice(lastError, offline !== null) };
}

function errorNotice(lastError: SyncError | null, offlineShown: boolean): SyncNotice | null {
  if (!lastError) return null;

  switch (lastError.kind) {
    case 'offline':
      // The banner already carries this exact sentence — `home.syncOffline` is
      // both of them. Rendering it twice reads as two separate problems. It is
      // still shown when the banner is not: connectivity can come back between
      // the failed pass and this render, and a bare unexplained gap would be
      // worse than a slightly stale note.
      return offlineShown ? null : { key: 'home.syncOffline', tone: 'calm' };

    case 'partial':
      if (/TBSCREEN_DUPLICATE_PATIENT|already exists in the shared registry/i.test(lastError.detail)) {
        return { key: 'home.syncDuplicatePatient', tone: 'alarm' };
      }
      return {
        key: 'home.syncPartial',
        params: { count: lastError.count ?? 0 },
        tone: 'alarm',
      };

    case 'unknown':
      return { key: 'home.syncError', params: { message: lastError.detail }, tone: 'alarm' };
  }
}
