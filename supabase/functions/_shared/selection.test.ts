/**
 * selection — who gets an SMS, and the abandoned-reservation bug.
 *
 * The property worth protecting: a run that dies between reserving an sms_log
 * row and settling it must not retire that patient's follow-up FOREVER. It did,
 * because 'queued' is not 'failed' and the old classification counted anything
 * that was not 'failed' as done.
 *
 * The tests are written around the boundary rather than the happy path: a fresh
 * reservation must still suppress (that is the duplicate-prevention the reserve
 * exists for), a stale one must not, and in both cases the attempt cap must
 * still bound how many messages a patient can receive.
 */
import { describe, expect, it } from 'vitest';

import {
  STALE_QUEUED_MINUTES,
  classifyFollowUpLogs,
  shouldFollowUp,
  shouldRemind,
  staleQueuedCutoff,
  type SmsLogRow,
} from './selection.ts';

const NOW = Date.parse('2026-08-27T10:00:00.000Z');
const CUTOFF = staleQueuedCutoff(NOW);
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const row = (
  appointment_id: string,
  delivery_status: string,
  sent_at: string | null = ago(0),
): SmsLogRow => ({ appointment_id, delivery_status, sent_at });

describe('staleQueuedCutoff', () => {
  it('is one hour back by default', () => {
    expect(STALE_QUEUED_MINUTES).toBe(60);
    expect(CUTOFF).toBe(new Date(NOW - 3_600_000).toISOString());
  });

  it('sits far above one send round-trip and far below the daily cron gap', () => {
    // The bound only works if both inequalities hold; pin them so a future
    // tweak to the constant has to face them.
    expect(STALE_QUEUED_MINUTES).toBeGreaterThan(5);
    expect(STALE_QUEUED_MINUTES).toBeLessThan(24 * 60);
  });
});

describe('classifyFollowUpLogs', () => {
  it('counts sent and stubbed as settled', () => {
    const h = classifyFollowUpLogs([row('a', 'sent'), row('b', 'stubbed')], CUTOFF);
    expect(h.settled.has('a')).toBe(true);
    expect(h.settled.has('b')).toBe(true);
    expect(h.abandoned).toBe(0);
  });

  it('counts a failure as a spent attempt, not as settled', () => {
    const h = classifyFollowUpLogs([row('a', 'failed'), row('a', 'failed')], CUTOFF);
    expect(h.settled.has('a')).toBe(false);
    expect(h.attempts.get('a')).toBe(2);
  });

  it('leaves a FRESH queued reservation alone — that run may still settle it', () => {
    const h = classifyFollowUpLogs([row('a', 'queued', ago(5))], CUTOFF);
    expect(h.settled.has('a')).toBe(true);
    expect(h.attempts.get('a')).toBeUndefined();
    expect(h.abandoned).toBe(0);
  });

  it('ages out a STALE queued reservation as one spent attempt', () => {
    const h = classifyFollowUpLogs([row('a', 'queued', ago(90))], CUTOFF);
    expect(h.settled.has('a')).toBe(false); // the nudge is reachable again
    expect(h.attempts.get('a')).toBe(1); // but it cost a try
    expect(h.abandoned).toBe(1);
  });

  it('treats an undatable reservation as stale', () => {
    const h = classifyFollowUpLogs([row('a', 'queued', null)], CUTOFF);
    expect(h.settled.has('a')).toBe(false);
    expect(h.abandoned).toBe(1);
  });

  it('a later settled row wins over an earlier abandoned one', () => {
    // The retry that followed the crash succeeded: the appointment is done,
    // even though a stale reservation is still lying there.
    const h = classifyFollowUpLogs([row('a', 'queued', ago(300)), row('a', 'sent', ago(30))], CUTOFF);
    expect(h.settled.has('a')).toBe(true);
    expect(h.attempts.get('a')).toBe(1);
  });
});

describe('shouldFollowUp', () => {
  const cand = { appointment_id: 'a', patient_id: 'p', contact_number: '09171234567' };
  const none = new Set<string>();

  it('sends when nothing has happened yet', () => {
    const h = classifyFollowUpLogs([], CUTOFF);
    expect(shouldFollowUp(cand, h, none, 3)).toBe(true);
  });

  it('does not send without a contact number', () => {
    const h = classifyFollowUpLogs([], CUTOFF);
    expect(shouldFollowUp({ ...cand, contact_number: null }, h, none, 3)).toBe(false);
  });

  it('does not send when the patient has rebooked', () => {
    const h = classifyFollowUpLogs([], CUTOFF);
    expect(shouldFollowUp(cand, h, new Set(['p']), 3)).toBe(false);
  });

  it('THE D-08 BUG: a crashed run no longer retires the nudge for good', () => {
    const crashed = classifyFollowUpLogs([row('a', 'queued', ago(24 * 60))], CUTOFF);
    expect(shouldFollowUp(cand, crashed, none, 3)).toBe(true);
  });

  it('but a run still in flight does suppress it — no duplicate send', () => {
    const inflight = classifyFollowUpLogs([row('a', 'queued', ago(1))], CUTOFF);
    expect(shouldFollowUp(cand, inflight, none, 3)).toBe(false);
  });

  it('abandoned reservations are still capped, so a crash loop cannot spam', () => {
    const three = classifyFollowUpLogs(
      [row('a', 'queued', ago(300)), row('a', 'queued', ago(200)), row('a', 'failed', ago(100))],
      CUTOFF,
    );
    expect(three.attempts.get('a')).toBe(3);
    expect(shouldFollowUp(cand, three, none, 3)).toBe(false);
  });
});

describe('shouldRemind', () => {
  const cand = { appointment_id: 'a', contact_number: '09171234567' };

  it('sends when not yet reminded today', () => {
    expect(shouldRemind(cand, new Set())).toBe(true);
  });

  it('does not re-send on a same-day re-run', () => {
    expect(shouldRemind(cand, new Set(['a']))).toBe(false);
  });

  it('does not send without a contact number', () => {
    expect(shouldRemind({ ...cand, contact_number: null }, new Set())).toBe(false);
  });
});
