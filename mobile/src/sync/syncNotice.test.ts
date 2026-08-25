/**
 * Tests for the Home sync-notice decision.
 *
 * The defect these exist to prevent: the offline note rendered
 * `home.neverSynced` on `isOnline === false` alone, so an offline cold start
 * showed "Not synced yet — tap the button above when online." directly above
 * "Last synced 25/08/2026, 10:06:59". The first assertion below is that
 * contradiction, pinned.
 *
 * Assertions read the locale objects rather than hard-coding English, so a
 * reworded string does not fail a test that is about behaviour.
 */
import { describe, expect, it } from 'vitest';

import { en } from '../i18n/locales/en';
import type { SyncError } from '../store/syncStore';
import { syncNotices } from './syncNotice';

const OFFLINE: SyncError = { kind: 'offline', detail: 'fetch failed' };
const UNKNOWN: SyncError = { kind: 'unknown', detail: 'boom' };
const partial = (count: number): SyncError => ({ kind: 'partial', detail: 'rls', count });

describe('the offline note', () => {
  it('does not tell a BHW who has synced that they never have', () => {
    const { offline } = syncNotices({ isOnline: false, lastError: null });

    expect(offline).not.toBeNull();
    expect(offline?.key).not.toBe('home.neverSynced');
    expect(offline?.key).toBe('home.syncOffline');
  });

  it('says the work is safe and will sync by itself', () => {
    const { offline } = syncNotices({ isOnline: false, lastError: null });
    const copy = en.home[offline!.key.split('.')[1] as keyof typeof en.home] as string;

    // The reassurance is the whole point of the string; if it is ever reworded
    // away, this notice is no longer doing its job.
    expect(copy).toMatch(/automatically/i);
  });

  it('is calm, never an alarm', () => {
    expect(syncNotices({ isOnline: false, lastError: null }).offline?.tone).toBe('calm');
    expect(syncNotices({ isOnline: false, lastError: OFFLINE }).offline?.tone).toBe('calm');
  });

  it('is absent when online', () => {
    expect(syncNotices({ isOnline: true, lastError: null }).offline).toBeNull();
  });

  it('is absent before NetInfo has reported, rather than guessed at', () => {
    // `null` is "unknown". Guessing offline here would put an untrue note on
    // screen for every launch that renders before the first NetInfo event.
    expect(syncNotices({ isOnline: null, lastError: null }).offline).toBeNull();
  });
});

describe('the last-pass line', () => {
  it('is absent when the last pass did not fail', () => {
    expect(syncNotices({ isOnline: true, lastError: null }).error).toBeNull();
  });

  it('does not repeat the offline sentence the banner is already showing', () => {
    const { offline, error } = syncNotices({ isOnline: false, lastError: OFFLINE });

    expect(offline?.key).toBe('home.syncOffline');
    expect(error).toBeNull();
  });

  it('still explains an offline failure once connectivity is back', () => {
    // Connectivity can return between the failed pass and this render. Dropping
    // the line entirely would leave the failure unexplained.
    const { offline, error } = syncNotices({ isOnline: true, lastError: OFFLINE });

    expect(offline).toBeNull();
    expect(error?.key).toBe('home.syncOffline');
  });

  it('never paints an offline failure as an alarm', () => {
    expect(syncNotices({ isOnline: true, lastError: OFFLINE }).error?.tone).toBe('calm');
  });

  it('keeps a partial failure loud, and carries the count', () => {
    // Rows the server refused on an otherwise-clean pass. A BHW believing these
    // were uploaded is the one case worth alarming about.
    const { error } = syncNotices({ isOnline: true, lastError: partial(3) });

    expect(error).toEqual({ key: 'home.syncPartial', params: { count: 3 }, tone: 'alarm' });
  });

  it('shows a partial failure even while offline — the banner does not cover it', () => {
    const { offline, error } = syncNotices({ isOnline: false, lastError: partial(2) });

    expect(offline?.key).toBe('home.syncOffline');
    expect(error?.key).toBe('home.syncPartial');
  });

  it('defaults a partial count to 0 rather than rendering undefined', () => {
    const { error } = syncNotices({
      isOnline: true,
      lastError: { kind: 'partial', detail: 'rls' },
    });

    expect(error?.params).toEqual({ count: 0 });
  });

  it('surfaces an unknown failure with its raw detail, so it can be diagnosed', () => {
    const { error } = syncNotices({ isOnline: true, lastError: UNKNOWN });

    expect(error).toEqual({
      key: 'home.syncError',
      params: { message: 'boom' },
      tone: 'alarm',
    });
  });

  it('shows an unknown failure while offline too — it is not the same problem', () => {
    const { offline, error } = syncNotices({ isOnline: false, lastError: UNKNOWN });

    expect(offline?.key).toBe('home.syncOffline');
    expect(error?.key).toBe('home.syncError');
  });
});

describe('the keys it names', () => {
  it('only names keys that exist in the locale', () => {
    const inputs: SyncError[] = [OFFLINE, UNKNOWN, partial(1)];
    const keys = new Set<string>();

    for (const isOnline of [true, false, null] as const) {
      for (const lastError of [...inputs, null]) {
        const { offline, error } = syncNotices({ isOnline, lastError });
        if (offline) keys.add(offline.key);
        if (error) keys.add(error.key);
      }
    }

    expect(keys.size).toBeGreaterThan(0);
    for (const key of keys) {
      const [section, name] = key.split('.');
      expect(section).toBe('home');
      expect(en.home).toHaveProperty(name);
    }
  });
});
