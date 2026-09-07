/**
 * The D-07 verdict, pinned.
 *
 * Two of these tests exist to stop a plausible-sounding future change:
 *
 *  - the pair over `{ data: null, error: null }` is the only thing that makes
 *    the sign-in / mid-session asymmetry a DECISION rather than an accident of
 *    whichever call site was written first;
 *  - "a server error is not a denial" is what fails if someone later
 *    "tightens" the gate by treating unrecognised errors as revocations, which
 *    would reintroduce exactly the spurious sign-outs this design forbids.
 */
import { describe, expect, it } from 'vitest';

import {
  AccountLookup,
  evaluateAccountAccess,
  roleDestinationKey,
} from './accountAccess';

/** A lookup that succeeded and returned a row. */
const row = (role: string | null, active: boolean | null): AccountLookup => ({
  data: { role, active },
  error: null,
});

/** A lookup that failed. */
const failed = (message: string, code?: string): AccountLookup => ({
  data: null,
  error: { message, code },
});

/** A lookup that succeeded and returned nothing. */
const empty: AccountLookup = { data: null, error: null };

describe('an active BHW', () => {
  it('is allowed, wherever the question is asked', () => {
    expect(evaluateAccountAccess(row('bhw', true), 'deny')).toEqual({ kind: 'allowed' });
    expect(evaluateAccountAccess(row('bhw', true), 'unknown')).toEqual({ kind: 'allowed' });
  });

  it('is still allowed when `active` is absent, because the column cannot be null', () => {
    // `active` is `not null default true` server-side (0006). A null here means
    // the select changed shape, not that anyone was deactivated — and that must
    // not lock a BHW out of their own patients.
    expect(evaluateAccountAccess(row('bhw', null), 'deny')).toEqual({ kind: 'allowed' });
    expect(evaluateAccountAccess({ data: { role: 'bhw' }, error: null }, 'deny')).toEqual({
      kind: 'allowed',
    });
  });
});

describe('a deactivated BHW', () => {
  it('is denied with the reason that picks the "talk to your midwife" message', () => {
    // The reason is asserted, not just the denial: it is what chooses between
    // telling them to contact their midwife and sending them to the portal.
    for (const policy of ['deny', 'unknown'] as const) {
      expect(evaluateAccountAccess(row('bhw', false), policy)).toEqual({
        kind: 'denied',
        reason: 'inactive',
        role: 'bhw',
      });
    }
  });
});

describe('an account that is not a BHW account', () => {
  // tb_dots gets its own assertion rather than sharing a loop: it is the role
  // that carries 0007's unconditional province-wide patient read, so it is the
  // single case this whole defect is about.
  it('refuses a facility (tb_dots) account, at sign-in and mid-session', () => {
    for (const policy of ['deny', 'unknown'] as const) {
      expect(evaluateAccountAccess(row('tb_dots', true), policy)).toEqual({
        kind: 'denied',
        reason: 'wrongRole',
        role: 'tb_dots',
      });
    }
  });

  it('refuses a midwife account', () => {
    expect(evaluateAccountAccess(row('midwife', true), 'deny')).toEqual({
      kind: 'denied',
      reason: 'wrongRole',
      role: 'midwife',
    });
  });

  it('refuses an admin account', () => {
    expect(evaluateAccountAccess(row('admin', true), 'deny')).toEqual({
      kind: 'denied',
      reason: 'wrongRole',
      role: 'admin',
    });
  });

  it('refuses a role it has never heard of', () => {
    // A future migration adding a role must not open the phone by default.
    expect(evaluateAccountAccess(row('supervisor', true), 'deny')).toEqual({
      kind: 'denied',
      reason: 'wrongRole',
      role: 'supervisor',
    });
    expect(evaluateAccountAccess(row(null, true), 'deny')).toEqual({
      kind: 'denied',
      reason: 'wrongRole',
      role: null,
    });
  });

  it('reports the wrong role even when that account is also deactivated', () => {
    // Where they belong is more useful than the fact they are switched off.
    expect(evaluateAccountAccess(row('midwife', false), 'deny')).toEqual({
      kind: 'denied',
      reason: 'wrongRole',
      role: 'midwife',
    });
  });
});

describe('no users row came back', () => {
  it('is DENIED at sign-in, where nothing is at stake yet', () => {
    expect(evaluateAccountAccess(empty, 'deny')).toEqual({
      kind: 'denied',
      reason: 'noAccount',
      role: null,
    });
  });

  it('is UNKNOWN for a session already running, so nobody is thrown out', () => {
    // `.maybeSingle()` cannot tell "row absent" from "RLS declined to show it".
    // Mid-shift that is far more likely to be a policy quirk than a real
    // revocation, and being wrong here costs a BHW their morning's work.
    expect(evaluateAccountAccess(empty, 'unknown')).toEqual({ kind: 'unknown' });
  });
});

describe('the lookup failed', () => {
  it('is unknown when the phone is offline', () => {
    for (const policy of ['deny', 'unknown'] as const) {
      expect(evaluateAccountAccess(failed('Network request failed'), policy)).toEqual({
        kind: 'unknown',
      });
      expect(
        evaluateAccountAccess(failed('fetch failed: java.net.UnknownHostException'), policy),
      ).toEqual({ kind: 'unknown' });
    }
  });

  it('is unknown for a server error too — an error is never a denial', () => {
    // The one that matters. A 500, an RLS error or a string we do not
    // recognise is not evidence that an account was revoked, and sniffing
    // messages for "is this really the network" is a heuristic we would be
    // betting a BHW's shift on. If this test ever fails, the gate has been
    // "tightened" into signing people out on a server hiccup.
    for (const policy of ['deny', 'unknown'] as const) {
      expect(evaluateAccountAccess(failed('Internal Server Error'), policy)).toEqual({
        kind: 'unknown',
      });
      expect(evaluateAccountAccess(failed('permission denied', '42501'), policy)).toEqual({
        kind: 'unknown',
      });
      expect(evaluateAccountAccess(failed('JWT expired', 'PGRST301'), policy)).toEqual({
        kind: 'unknown',
      });
    }
  });

  it('is unknown even if a row somehow came back alongside the error', () => {
    expect(
      evaluateAccountAccess({ data: { role: 'bhw', active: true }, error: { message: 'x' } }, 'deny'),
    ).toEqual({ kind: 'unknown' });
  });
});

describe('the destination named in the wrong-app message', () => {
  it('sends each role to the right place', () => {
    expect(roleDestinationKey('tb_dots')).toBe('blocked.roleFacility');
    expect(roleDestinationKey('midwife')).toBe('blocked.roleMidwife');
    expect(roleDestinationKey('admin')).toBe('blocked.roleAdmin');
  });

  it('falls back to a generic line for anything else', () => {
    expect(roleDestinationKey('supervisor')).toBe('blocked.roleOther');
    expect(roleDestinationKey(null)).toBe('blocked.roleOther');
  });
});
