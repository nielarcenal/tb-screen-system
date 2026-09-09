/**
 * pullCursor — the incremental-pull boundary rule (BASE-05).
 *
 * The scenario these tests exist for cannot be produced reliably on a device:
 * "more rows share one `updated_at` than fit in a single response". It needs a
 * bulk server write and a known response cap, both outside the app's control.
 * So the rule lives in a pure module and the scenario is played out here
 * exactly, which is the only way it gets tested at all.
 *
 * The first test is the regression: it drives a full pull loop against a fake
 * server and asserts that every row arrives. Run against the OLD rule — one
 * request, cursor = max(updated_at), strict `>` — it fails, which is BASE-05.
 */
import { describe, expect, it } from 'vitest';

import {
  EPOCH_CURSOR,
  PULL_PAGE_SIZE,
  UNDRAINED,
  advance,
  formatCursor,
  healLegacyCursor,
  nextStep,
  parseCursor,
  type PullCursor,
  type PulledRow,
} from './pullCursor';

/** A row id that sorts the way a real primary key does under `order by id`. */
const id = (n: number) => `row-${String(n).padStart(4, '0')}`;

/**
 * A stand-in server holding rows in (updated_at, id) order, which answers the
 * two query shapes the engine issues and applies a hard response cap — the cap
 * being the thing the old code could not see.
 */
function fakeServer(rows: PulledRow[], pageSize: number) {
  const sorted = [...rows].sort((a, b) =>
    a.updated_at === b.updated_at
      ? a.id.localeCompare(b.id)
      : a.updated_at.localeCompare(b.updated_at),
  );
  return {
    query(step: ReturnType<typeof nextStep>): PulledRow[] {
      const matched =
        step.mode === 'drain'
          ? sorted.filter(
              (r) =>
                r.updated_at === step.updatedAt &&
                (step.afterId === null || r.id > step.afterId),
            )
          : sorted.filter((r) => r.updated_at > step.afterUpdatedAt);
      return matched.slice(0, pageSize);
    },
  };
}

/** Drive the real loop the engine runs, and report what the device received. */
function pullAll(rows: PulledRow[], startCursor: string, pageSize: number) {
  const server = fakeServer(rows, pageSize);
  let cursor: PullCursor = parseCursor(startCursor);
  const received: PulledRow[] = [];
  let requests = 0;

  for (let guard = 0; guard < 1000; guard++) {
    const step = nextStep(cursor);
    const page = server.query(step);
    requests++;
    received.push(...page);

    const outcome = advance(cursor, step, page, pageSize);
    cursor = outcome.cursor;
    if (!outcome.more) return { received, cursor, requests };
  }
  throw new Error('pull loop did not terminate');
}

describe('pullCursor — BASE-05 regression', () => {
  it('delivers every row when more share one timestamp than fit in a page', () => {
    // 12 rows, all written by one bulk transaction, so all carry one timestamp.
    // The response cap is 5. The old rule fetched 5, set the cursor to that
    // timestamp, and asked for `> timestamp` forever after: 7 rows lost.
    const tied = Array.from({ length: 12 }, (_, i) => ({
      updated_at: '2026-03-01T00:00:00.000Z',
      id: id(i),
    }));

    const { received } = pullAll(tied, EPOCH_CURSOR, 5);

    expect(received).toHaveLength(12);
    expect(new Set(received.map((r) => r.id)).size).toBe(12);
  });

  it('the old rule loses those rows — the defect, pinned', () => {
    // One request, cursor := max(updated_at) received, then strict `>`.
    const tied = Array.from({ length: 12 }, (_, i) => ({
      updated_at: '2026-03-01T00:00:00.000Z',
      id: id(i),
    }));
    const server = fakeServer(tied, 5);

    const first = server.query({ mode: 'advance', afterUpdatedAt: EPOCH_CURSOR });
    const oldCursor = first[first.length - 1].updated_at;
    const second = server.query({ mode: 'advance', afterUpdatedAt: oldCursor });

    expect(first).toHaveLength(5);
    expect(second).toHaveLength(0); // and it never recovers
  });

  it('drains a boundary group that is split across a page edge', () => {
    // Page size 5. Rows: 3 at T1, then 6 at T2. The first page ends in the
    // middle of the T2 group, which is exactly the case the old code mishandled.
    const rows: PulledRow[] = [
      ...Array.from({ length: 3 }, (_, i) => ({ updated_at: 'T1', id: id(i) })),
      ...Array.from({ length: 6 }, (_, i) => ({ updated_at: 'T2', id: id(10 + i) })),
    ];

    const { received } = pullAll(rows, EPOCH_CURSOR, 5);

    expect(received).toHaveLength(9);
    expect(received.filter((r) => r.updated_at === 'T2')).toHaveLength(6);
  });

  it('terminates and re-reads nothing when the delta fits in one page', () => {
    const rows = [
      { updated_at: 'T1', id: id(1) },
      { updated_at: 'T2', id: id(2) },
    ];

    const { received, requests, cursor } = pullAll(rows, EPOCH_CURSOR, PULL_PAGE_SIZE);

    // The common case must cost exactly what it cost before: one request.
    expect(requests).toBe(1);
    expect(received).toHaveLength(2);
    expect(cursor).toEqual({ updatedAt: 'T2', tieId: null });
  });

  it('is idempotent: a second pull from the finished cursor fetches nothing', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      updated_at: '2026-03-01T00:00:00.000Z',
      id: id(i),
    }));

    const first = pullAll(rows, EPOCH_CURSOR, 5);
    const second = pullAll(rows, formatCursor(first.cursor), 5);

    expect(second.received).toHaveLength(0);
  });

  it('resumes correctly when a pull is interrupted mid-group', () => {
    // Simulates losing connectivity after the first page: the cursor persisted
    // so far is the only state that survives.
    const rows = Array.from({ length: 12 }, (_, i) => ({
      updated_at: '2026-03-01T00:00:00.000Z',
      id: id(i),
    }));
    const server = fakeServer(rows, 5);

    let cursor = parseCursor(EPOCH_CURSOR);
    const step1 = nextStep(cursor);
    const page1 = server.query(step1);
    cursor = advance(cursor, step1, page1, 5).cursor;

    // ...app killed here. Restart from the persisted cursor.
    const resumed = pullAll(rows, formatCursor(cursor), 5);

    const all = [...page1, ...resumed.received];
    expect(new Set(all.map((r) => r.id)).size).toBe(12);
  });
});

describe('pullCursor — cursor encoding', () => {
  it('reads a legacy timestamp-only cursor written by an older build', () => {
    expect(parseCursor('2026-03-01T00:00:00.000Z')).toEqual({
      updatedAt: '2026-03-01T00:00:00.000Z',
      tieId: null,
    });
  });

  it('round-trips both forms', () => {
    for (const c of [
      { updatedAt: 'T1', tieId: null },
      { updatedAt: 'T1', tieId: 'row-0007' },
      { updatedAt: 'T1', tieId: UNDRAINED },
    ] as PullCursor[]) {
      expect(parseCursor(formatCursor(c))).toEqual(c);
    }
  });

  it('splits on the first separator only', () => {
    expect(parseCursor('T1|a|b')).toEqual({ updatedAt: 'T1', tieId: 'a|b' });
  });

  it('treats a missing or empty cursor as the epoch', () => {
    expect(parseCursor(null)).toEqual({ updatedAt: EPOCH_CURSOR, tieId: null });
    expect(parseCursor('')).toEqual({ updatedAt: EPOCH_CURSOR, tieId: null });
  });
});

describe('pullCursor — upgrade healing', () => {
  it('marks an existing cursor undrained so its group is re-read once', () => {
    expect(healLegacyCursor('2026-03-01T00:00:00.000Z')).toBe(
      `2026-03-01T00:00:00.000Z|${UNDRAINED}`,
    );
  });

  it('leaves the epoch alone — no group to recover, and it would cost a request', () => {
    expect(healLegacyCursor(EPOCH_CURSOR)).toBe(EPOCH_CURSOR);
  });

  it('is idempotent, so re-running the migration cannot double-mark', () => {
    const once = healLegacyCursor('T1');
    expect(healLegacyCursor(once)).toBe(once);
  });

  it('recovers rows the old build skipped at the boundary', () => {
    // The device already holds 5 of 12 tied rows and its cursor sits on that
    // timestamp — precisely the state BASE-05 leaves behind.
    const rows = Array.from({ length: 12 }, (_, i) => ({
      updated_at: '2026-03-01T00:00:00.000Z',
      id: id(i),
    }));

    const stranded = '2026-03-01T00:00:00.000Z';
    expect(pullAll(rows, stranded, 5).received).toHaveLength(0); // without healing

    const healed = healLegacyCursor(stranded);
    const recovered = pullAll(rows, healed, 5).received;
    expect(new Set(recovered.map((r) => r.id)).size).toBe(12);
  });
});

describe('pullCursor — advance()', () => {
  it('does not move the cursor when a pull returns nothing', () => {
    const cursor = { updatedAt: 'T5', tieId: null };
    const outcome = advance(cursor, nextStep(cursor), [], 5);
    expect(outcome).toEqual({ cursor: { updatedAt: 'T5', tieId: null }, more: false });
  });

  it('keeps the last id when a page is full, because the group may be cut', () => {
    const cursor = { updatedAt: 'T0', tieId: null };
    const page = Array.from({ length: 5 }, (_, i) => ({ updated_at: 'T9', id: id(i) }));
    expect(advance(cursor, nextStep(cursor), page, 5)).toEqual({
      cursor: { updatedAt: 'T9', tieId: id(4) },
      more: true,
    });
  });

  it('clears the id when a page is short, because the group is complete', () => {
    const cursor = { updatedAt: 'T0', tieId: null };
    const page = [{ updated_at: 'T9', id: id(0) }];
    expect(advance(cursor, nextStep(cursor), page, 5)).toEqual({
      cursor: { updatedAt: 'T9', tieId: null },
      more: false,
    });
  });

  it('a short drain ends the group but not the table', () => {
    const cursor = { updatedAt: 'T9', tieId: id(3) };
    const page = [{ updated_at: 'T9', id: id(4) }];
    const outcome = advance(cursor, nextStep(cursor), page, 5);
    expect(outcome.cursor).toEqual({ updatedAt: 'T9', tieId: null });
    expect(outcome.more).toBe(true); // later timestamps may still exist
  });
});
