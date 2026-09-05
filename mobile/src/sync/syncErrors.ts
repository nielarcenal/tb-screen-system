/**
 * Classifying sync failures (D-10).
 *
 * The push loops used to throw on the first row that failed, which stopped the
 * whole pass — and because syncAll() runs tables in FK order with appointments
 * LAST, one permanently-rejected patient meant a BHW's attendance records never
 * reached the server again on any subsequent sync. Fixing that needs one
 * decision per failure: is this worth retrying right now, or is this row simply
 * not acceptable to the server?
 *
 *  - TRANSIENT — offline, DNS, timeout, a 5xx, an expired token. Nothing else
 *    in this pass will succeed either, so the engine stops immediately and
 *    leaves everything pending. This is what already happened when offline and
 *    is deliberately unchanged: retrying every remaining row into a dead
 *    network just drains the battery.
 *  - PERMANENT — RLS denial, a constraint violation, malformed data. This row
 *    will never be accepted as it stands, so it is recorded and the engine
 *    moves on to the next row and the next table.
 *
 * UNKNOWN FAILURES COUNT AS PERMANENT, which is the safe default here and the
 * opposite of what it sounds like. Rows are never abandoned — a permanent
 * failure still leaves the row `pending` and it is retried on the next sync —
 * so the worst case is a few doomed requests in one pass. Defaulting to
 * transient would mean any error this module fails to recognise aborts the
 * whole pass, which is exactly the bug D-10 exists to remove.
 */

/** One row (or one whole table, for a pull) that did not sync. */
export interface SyncFailure {
  /** Table the failure happened on. */
  table: string;
  /** The row that failed — display code where there is one, otherwise its id.
   *  Absent when the whole table failed, e.g. a pull request that errored. */
  row?: string;
  message: string;
}

/** The shape of a Supabase/PostgREST error, narrowed to what we classify on. */
export interface SyncErrorLike {
  message: string;
  /** SQLSTATE (e.g. '23505') or a PostgREST code (e.g. 'PGRST301'). */
  code?: string;
}

/** Thrown to unwind the current pass when retrying now cannot help. */
export class TransientSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientSyncError';
  }
}

/**
 * A connectivity problem — the device is offline, DNS cannot resolve the
 * Supabase host, or the request timed out — rather than a server or data error.
 * The UI uses this to show a plain "you're offline" message instead of a raw
 * technical string (e.g. "fetch failed: java.net.UnknownHostException…").
 */
export function isConnectivityError(message: string): boolean {
  return /fetch failed|failed to fetch|network request failed|unable to resolve host|unknownhostexception|no address associated|enotfound|econnrefused|econnreset|etimedout|timeout|timed out|socketexception|network/i.test(
    message,
  );
}

/** Server-side "come back later" responses, which arrive without a SQLSTATE. */
function isServerBusyMessage(message: string): boolean {
  return /service unavailable|bad gateway|gateway timeout|too many requests|temporarily unavailable|rate limit/i.test(
    message,
  );
}

/** SQLSTATE classes that mean "try again", not "this row is bad":
 *  08 connection exception, 53 insufficient resources, 57 operator
 *  intervention, 58 external system error. */
const TRANSIENT_SQLSTATE_CLASS = /^(08|53|57|58)/;

/** Serialization failure and deadlock — retryable, but in class 40 alongside
 *  plain transaction rollbacks, so they are listed rather than matched. */
const TRANSIENT_SQLSTATE_EXACT = new Set(['40001', '40P01']);

/** PostgREST's own codes. JWT expired is transient: the next pass refreshes the
 *  token first, so the same row will go through. */
const TRANSIENT_POSTGREST = new Set(['PGRST301']);

/**
 * True when the failure is worth aborting the pass for. See the module comment
 * for why anything unrecognised deliberately returns false.
 */
export function isTransientError(err: SyncErrorLike): boolean {
  const code = err.code?.trim();
  if (code) {
    // A recognised SQLSTATE is authoritative — a 23505 unique violation is
    // permanent no matter what words happen to be in its message.
    return (
      TRANSIENT_POSTGREST.has(code) ||
      TRANSIENT_SQLSTATE_EXACT.has(code) ||
      TRANSIENT_SQLSTATE_CLASS.test(code)
    );
  }
  return isConnectivityError(err.message) || isServerBusyMessage(err.message);
}

/**
 * Run one step of a sync pass and apply the policy above to whatever it throws:
 * a TransientSyncError unwinds the pass, anything else is recorded against
 * `table` and the pass carries on with the next step.
 *
 * Lives here rather than in syncEngine so it can be tested — syncEngine imports
 * Supabase and cannot be loaded outside the app.
 */
export async function runStep(
  table: string,
  failures: SyncFailure[],
  run: () => Promise<number>,
): Promise<number> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof TransientSyncError) throw e;
    failures.push({ table, message: e instanceof Error ? e.message : String(e) });
    return 0;
  }
}
