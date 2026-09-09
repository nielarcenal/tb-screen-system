/**
 * The incremental-pull cursor, and the rule for advancing it (BASE-05).
 *
 * WHAT WAS WRONG. `pullTable` asked for every row with `updated_at > cursor`,
 * ordered by `updated_at` alone, with no explicit limit — then set the cursor to
 * the largest timestamp it received and used strict `>` next time.
 *
 * Two facts turn that into permanent data loss:
 *
 *   1. PostgREST caps the response server-side. The old code never set a limit,
 *      so it could not tell a CAPPED response from a COMPLETE one — the reply
 *      looks identical either way.
 *   2. `updated_at` is not unique. A bulk write gives many rows the same
 *      `now()`, and the app's own sync pushes rows in a loop inside one pass.
 *
 * So if more rows share the boundary timestamp T than fit in one response, the
 * device receives some of them, moves the cursor to T, and every later pull asks
 * for `> T`. The remainder can never satisfy that predicate again. The rows are
 * not delayed; they are gone, and the device looks fully synced.
 *
 * THE FIX is a keyset cursor: order by `(updated_at, id)` — a total order,
 * because `id` is a primary key — and remember BOTH parts. Then "where I got to"
 * is a position in that order rather than a timestamp that may cover many rows.
 * This module is that rule, and nothing else. It imports nothing and touches no
 * database, so the tie and truncation cases can be tested exactly, which is the
 * only way to test them: a device integration test cannot reliably manufacture
 * "more rows share one timestamp than fit in a response".
 *
 * It follows the split already used by domain/accountAccess.ts (the decision)
 * and lib/accountGate.ts (the half that talks to Supabase).
 *
 * WHAT THIS IS NOT: a sync-engine rewrite, which the sprint plan puts out of
 * scope. Push is untouched, table order is untouched, error classification is
 * untouched, and in the common case — a small delta that fits in one page — the
 * device makes exactly the same number of requests it made before.
 */

/**
 * How many rows to ask for per request.
 *
 * The value matters less than the fact that we choose it. An explicit limit is
 * what makes truncation OBSERVABLE: a full page means "there may be more", a
 * short page means "that is all there was". Without one, the server's own cap
 * silently truncates and the reply is indistinguishable from a complete answer,
 * which is the root of BASE-05.
 *
 * 500 is comfortably under Supabase's default max-rows so our limit, not
 * theirs, is the one in force.
 */
export const PULL_PAGE_SIZE = 500;

/** The epoch cursor a table starts from, and returns to on sign-out. */
export const EPOCH_CURSOR = '1970-01-01T00:00:00.000Z';

/**
 * Sentinel for "the timestamp group at `updatedAt` has NOT been drained".
 *
 * Written by the local database migration onto every pre-BASE-05 cursor, so the
 * first pull after upgrading re-reads that whole group and recovers whatever the
 * old code skipped. Upserts are last-write-wins, so re-reading rows the device
 * already has is a no-op.
 */
export const UNDRAINED = '*';

export interface PullCursor {
  /** ISO timestamp high-water mark. */
  updatedAt: string;
  /**
   * Position within the `updatedAt` group:
   *   null       the group is fully drained; continue strictly after it
   *   UNDRAINED  the group has not been read at all; read it from the start
   *   <id>       read up to and including this primary key
   */
  tieId: string | null;
}

/**
 * Stored form is `<iso>` or `<iso>|<tieId>`, in the existing
 * `sync_meta.last_pull_at` TEXT column — no schema change, and a value written
 * by an older build still parses.
 *
 * Split on the FIRST separator only. ISO timestamps never contain `|`, and
 * neither do the UUID primary keys, but splitting once means a stray separator
 * inside an id could never silently drop part of it.
 */
export function parseCursor(stored: string | null | undefined): PullCursor {
  if (!stored) return { updatedAt: EPOCH_CURSOR, tieId: null };
  const at = stored.indexOf('|');
  if (at === -1) return { updatedAt: stored, tieId: null };
  const tieId = stored.slice(at + 1);
  return { updatedAt: stored.slice(0, at), tieId: tieId === '' ? null : tieId };
}

export function formatCursor(cursor: PullCursor): string {
  return cursor.tieId === null ? cursor.updatedAt : `${cursor.updatedAt}|${cursor.tieId}`;
}

/**
 * What the next request should ask for.
 *
 *   drain    rows inside the `updatedAt` group, after `afterId` (or from the
 *            start of the group when `afterId` is null), ordered by id
 *   advance  rows strictly after `updatedAt`, ordered by (updated_at, id)
 *
 * A drain is only ever issued when the previous page was full, so a device with
 * a small delta never pays for one.
 */
export type PullStep =
  | { mode: 'drain'; updatedAt: string; afterId: string | null }
  | { mode: 'advance'; afterUpdatedAt: string };

export function nextStep(cursor: PullCursor): PullStep {
  if (cursor.tieId === null) {
    return { mode: 'advance', afterUpdatedAt: cursor.updatedAt };
  }
  return {
    mode: 'drain',
    updatedAt: cursor.updatedAt,
    afterId: cursor.tieId === UNDRAINED ? null : cursor.tieId,
  };
}

/** The two fields this module needs from a pulled row. */
export interface PulledRow {
  updated_at: string;
  id: string;
}

export interface StepOutcome {
  /** Where the cursor now sits. Persist this before the next request. */
  cursor: PullCursor;
  /** False once the table is exhausted. */
  more: boolean;
}

/**
 * Advance the cursor over one page of results.
 *
 * The whole correctness argument is here, so it is worth stating plainly:
 *
 *   * A page that is NOT full means the server had nothing else to give for
 *     that predicate, so everything up to and including the last row is
 *     accounted for. After a drain that means the group is complete; after an
 *     advance it means the table is complete.
 *   * A FULL page means there may be more, and — critically — the last row's
 *     timestamp group may be cut in half. So the cursor keeps that row's id and
 *     the next request drains the rest of that group by id. Nothing is skipped
 *     on the assumption that a timestamp was finished.
 *
 * Progress is guaranteed: a drain strictly increases `tieId` within a group, an
 * advance strictly increases `updatedAt`, and both are bounded. So the loop
 * cannot spin even when one timestamp holds far more rows than a page.
 */
export function advance(
  cursor: PullCursor,
  step: PullStep,
  page: PulledRow[],
  pageSize: number = PULL_PAGE_SIZE,
): StepOutcome {
  const full = page.length >= pageSize;
  const last = page.length > 0 ? page[page.length - 1] : null;

  if (step.mode === 'drain') {
    if (last === null || !full) {
      // Group finished. Fall through to `advance` on the next call; there may
      // still be later timestamps, so this is not the end of the table.
      return { cursor: { updatedAt: cursor.updatedAt, tieId: null }, more: true };
    }
    return { cursor: { updatedAt: cursor.updatedAt, tieId: last.id }, more: true };
  }

  if (last === null) {
    // Nothing after the cursor at all. Leave the cursor where it is — moving it
    // would mean trusting a local clock we have no reason to trust.
    return { cursor: { updatedAt: cursor.updatedAt, tieId: null }, more: false };
  }

  return {
    cursor: { updatedAt: last.updated_at, tieId: full ? last.id : null },
    more: full,
  };
}

/**
 * Rewrite a pre-BASE-05 cursor so the first pull after upgrading re-reads its
 * boundary group and recovers rows the old code skipped.
 *
 * The epoch is left alone: there is no group to re-read, and it would cost every
 * fresh install one pointless request per table.
 */
export function healLegacyCursor(stored: string): string {
  if (stored === EPOCH_CURSOR || stored.includes('|')) return stored;
  return `${stored}|${UNDRAINED}`;
}
