/**
 * Tests for the sync failure classifier (D-10).
 *
 * The stake here is specific. isTransientError() returning true aborts the
 * whole sync pass, and syncAll() pushes appointments LAST — so a permanent
 * error misread as transient brings back exactly the bug D-10 removed: one
 * rejected row starving a BHW's attendance records forever. The RLS and
 * constraint cases below are the ones that must never drift.
 */
import { describe, expect, it } from 'vitest';

import {
  SyncFailure,
  TransientSyncError,
  isConnectivityError,
  isTransientError,
  runStep,
} from './syncErrors';

/** Real SQLSTATEs, with the Postgres condition name each one carries. */
const TRANSIENT_CODES: [string, string][] = [
  ['08000', 'connection_exception'],
  ['08003', 'connection_does_not_exist'],
  ['08006', 'connection_failure'],
  ['53300', 'too_many_connections'],
  ['57014', 'query_canceled'],
  ['58030', 'io_error'],
  ['40001', 'serialization_failure'],
  ['40P01', 'deadlock_detected'],
];

const PERMANENT_CODES: [string, string][] = [
  ['42501', 'insufficient_privilege — this is what an RLS denial looks like'],
  ['23505', 'unique_violation'],
  ['23503', 'foreign_key_violation'],
  ['23514', 'check_violation'],
  ['23502', 'not_null_violation'],
  ['22001', 'string_data_right_truncation'],
  ['42703', 'undefined_column'],
  ['22P02', 'invalid_text_representation'],
];

describe('isTransientError — by SQLSTATE', () => {
  it.each(TRANSIENT_CODES)('%s (%s) is transient, so the pass stops', (code) => {
    expect(isTransientError({ code, message: 'whatever the server said' })).toBe(true);
  });

  it.each(PERMANENT_CODES)('%s (%s) is permanent, so the pass continues', (code) => {
    expect(isTransientError({ code, message: 'whatever the server said' })).toBe(false);
  });

  it('treats PGRST301 (expired JWT) as transient', () => {
    // The next pass refreshes the token first, so the same row then succeeds.
    expect(isTransientError({ code: 'PGRST301', message: 'JWT expired' })).toBe(true);
  });

  it('does not treat the whole of class 40 as retryable', () => {
    // 40001 and 40P01 are retryable; a plain transaction_rollback is not, which
    // is why they are listed individually rather than matched by class.
    expect(isTransientError({ code: '40000', message: 'transaction_rollback' })).toBe(false);
  });

  it('trusts the code over the words in the message', () => {
    // A unique violation whose message happens to contain "network" must not
    // abort the pass. This is the single most dangerous misclassification.
    expect(
      isTransientError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "patients_pkey" (network)',
      }),
    ).toBe(false);
  });

  it('falls back to the message when the code is present but empty', () => {
    expect(isTransientError({ code: '   ', message: 'Network request failed' })).toBe(true);
  });
});

describe('isTransientError — by message, when there is no code', () => {
  it.each([
    'TypeError: Network request failed',
    'fetch failed: java.net.UnknownHostException: Unable to resolve host',
    'Unable to resolve host "abc.supabase.co": No address associated with hostname',
    'connect ETIMEDOUT 10.0.0.1:443',
    'ECONNREFUSED',
    'The request timed out',
  ])('treats %s as transient', (message) => {
    expect(isTransientError({ message })).toBe(true);
  });

  it.each([
    '503 Service Unavailable',
    '502 Bad Gateway',
    '504 Gateway Timeout',
    '429 Too Many Requests',
    'Service temporarily unavailable',
  ])('treats %s as transient — the server is busy, not the row bad', (message) => {
    expect(isTransientError({ message })).toBe(true);
  });

  it.each([
    'new row violates row-level security policy for table "patients"',
    'duplicate key value violates unique constraint "patients_pkey"',
    'insert or update on table "screenings" violates foreign key constraint',
    'null value in column "patient_id" violates not-null constraint',
    'permission denied for table referrals',
  ])('treats %s as permanent', (message) => {
    expect(isTransientError({ message })).toBe(false);
  });

  it('treats an empty message as permanent', () => {
    expect(isTransientError({ message: '' })).toBe(false);
  });
});

describe('the unknown-is-permanent default', () => {
  it('does not abort the pass for an unrecognised SQLSTATE', () => {
    // Deliberate, and the opposite of what it sounds like: a permanent failure
    // still leaves the row pending and retries next pass, so the cost is a few
    // doomed requests. Defaulting the other way would let any unrecognised
    // error stop the pass — which is the bug D-10 exists to remove.
    expect(isTransientError({ code: 'XX000', message: 'internal error' })).toBe(false);
  });

  it('does not abort the pass for an unrecognised message', () => {
    expect(isTransientError({ message: 'something nobody has seen before' })).toBe(false);
  });
});

describe('isConnectivityError', () => {
  it('is true for a connectivity failure', () => {
    expect(isConnectivityError('fetch failed')).toBe(true);
  });

  it('is false for a server-side rejection', () => {
    expect(isConnectivityError('new row violates row-level security policy')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isConnectivityError('UnknownHostException')).toBe(true);
  });

  it('is narrower than isTransientError — a busy server is not an offline phone', () => {
    // The UI leans on this: "you are offline" would be a lie during a 503.
    expect(isConnectivityError('503 Service Unavailable')).toBe(false);
    expect(isTransientError({ message: '503 Service Unavailable' })).toBe(true);
  });
});

describe('runStep — the isolation D-10 is actually about', () => {
  it('passes a successful count straight through and records nothing', async () => {
    const failures: SyncFailure[] = [];
    await expect(runStep('patients', failures, async () => 3)).resolves.toBe(3);
    expect(failures).toEqual([]);
  });

  it('records a permanent failure, returns 0, and does not throw', async () => {
    const failures: SyncFailure[] = [];
    await expect(
      runStep('patients', failures, async () => {
        throw new Error('new row violates row-level security policy');
      }),
    ).resolves.toBe(0);
    expect(failures).toEqual([
      { table: 'patients', message: 'new row violates row-level security policy' },
    ]);
  });

  it('rethrows a transient failure so the caller can abandon the pass', async () => {
    const failures: SyncFailure[] = [];
    await expect(
      runStep('patients', failures, async () => {
        throw new TransientSyncError('offline');
      }),
    ).rejects.toBeInstanceOf(TransientSyncError);
    // Nothing recorded: the row is not bad, the network is.
    expect(failures).toEqual([]);
  });

  it('lets later steps run after an earlier one failed permanently', async () => {
    // This is the whole bug. Appointments are the LAST step of syncAll(), so
    // before D-10 a rejected patient meant attendance never reached the server.
    const failures: SyncFailure[] = [];
    const ran: string[] = [];

    const patients = await runStep('patients', failures, async () => {
      ran.push('patients');
      throw new Error('rejected');
    });
    const appointments = await runStep('appointments', failures, async () => {
      ran.push('appointments');
      return 2;
    });

    expect(ran).toEqual(['patients', 'appointments']);
    expect(patients).toBe(0);
    expect(appointments).toBe(2);
    expect(failures).toHaveLength(1);
    expect(failures[0].table).toBe('patients');
  });

  it('stops later steps once a transient failure is thrown', async () => {
    const failures: SyncFailure[] = [];
    const ran: string[] = [];

    const pass = async () => {
      await runStep('patients', failures, async () => {
        ran.push('patients');
        throw new TransientSyncError('offline');
      });
      await runStep('appointments', failures, async () => {
        ran.push('appointments');
        return 2;
      });
    };

    await expect(pass()).rejects.toBeInstanceOf(TransientSyncError);
    expect(ran).toEqual(['patients']); // appointments never attempted
  });

  it('accumulates failures across steps into one list', async () => {
    const failures: SyncFailure[] = [];
    await runStep('patients', failures, async () => {
      throw new Error('one');
    });
    await runStep('referrals', failures, async () => {
      throw new Error('two');
    });
    expect(failures.map((f) => f.table)).toEqual(['patients', 'referrals']);
  });

  it('stringifies a non-Error throw rather than losing it', async () => {
    const failures: SyncFailure[] = [];
    await runStep('patients', failures, async () => {
      throw 'a bare string';
    });
    expect(failures[0].message).toBe('a bare string');
  });
});

describe('TransientSyncError', () => {
  it('is an Error, so instanceof narrowing in the engine works', () => {
    const e = new TransientSyncError('offline');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(TransientSyncError);
    expect(e.name).toBe('TransientSyncError');
    expect(e.message).toBe('offline');
  });

  it('is distinguishable from a plain Error', () => {
    // step() relies on exactly this to tell "stop the pass" from "record it
    // and carry on".
    expect(new Error('boom')).not.toBeInstanceOf(TransientSyncError);
  });
});
