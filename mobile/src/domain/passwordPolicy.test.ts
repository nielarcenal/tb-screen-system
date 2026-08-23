/**
 * Rules for the D-06 forced-change gate.
 *
 * Mirrored at web/src/lib/passwordPolicy.test.ts — the portal and the app must
 * refuse the same passwords, and two copies that drift apart would mean a BHW
 * and a captain being told different things about the same rule.
 */
import { describe, expect, it } from 'vitest';

import {
  MIN_PASSWORD_LENGTH,
  PROVISIONED_PASSWORD_RE,
  validateNewPassword,
} from './passwordPolicy';

describe('validateNewPassword', () => {
  it('accepts a password the holder chose', () => {
    expect(validateNewPassword('malakas na tao', 'malakas na tao')).toBeNull();
  });

  it('rejects anything under the minimum length', () => {
    expect(validateNewPassword('short12', 'short12')).toBe('tooShort');
  });

  it('accepts a password of exactly the minimum length', () => {
    const exact = 'a'.repeat(MIN_PASSWORD_LENGTH);
    expect(exact).toHaveLength(8);
    expect(validateNewPassword(exact, exact)).toBeNull();
  });

  it('rejects the provisioned temp-password format', () => {
    // The slip of paper the captain handed over, retyped.
    expect(validateNewPassword('TBS-4829-kfmq', 'TBS-4829-kfmq')).toBe('looksProvisioned');
  });

  it('rejects any password in that format, not just the one issued', () => {
    // A different TBS-#### string is still a password the system generated
    // rather than one the holder picked — D-06 is about retiring those.
    expect(validateNewPassword('TBS-0000-aaaa', 'TBS-0000-aaaa')).toBe('looksProvisioned');
  });

  it('allows a password that merely starts like one', () => {
    expect(validateNewPassword('TBS-4829-kfmq!', 'TBS-4829-kfmq!')).toBeNull();
    expect(validateNewPassword('my TBS-4829-kfmq', 'my TBS-4829-kfmq')).toBeNull();
  });

  it('reports the mismatch when the confirmation differs', () => {
    expect(validateNewPassword('malakas na tao', 'malakas na tap')).toBe('mismatch');
  });

  it('is case-sensitive about the confirmation', () => {
    expect(validateNewPassword('Malakas12', 'malakas12')).toBe('mismatch');
  });

  it('complains about the password itself before the confirmation', () => {
    // Both are wrong here; a user still fixing the first field should not be
    // told off about the second one they have not corrected yet.
    expect(validateNewPassword('short', 'different')).toBe('tooShort');
    expect(validateNewPassword('TBS-4829-kfmq', 'different')).toBe('looksProvisioned');
  });

  it('does not trim — a password is whatever was typed', () => {
    expect(validateNewPassword('  spaces  ', '  spaces  ')).toBeNull();
    expect(validateNewPassword('  spaces  ', 'spaces')).toBe('mismatch');
  });
});

describe('PROVISIONED_PASSWORD_RE', () => {
  it('matches exactly what manage-bhw generates', () => {
    // tempPassword(): `TBS-${1000-9999}-${four letters from a 23-char alphabet}`
    expect(PROVISIONED_PASSWORD_RE.test('TBS-1000-abcd')).toBe(true);
    expect(PROVISIONED_PASSWORD_RE.test('TBS-9999-zzzz')).toBe(true);
  });

  it('does not match near misses', () => {
    expect(PROVISIONED_PASSWORD_RE.test('TBS-999-abcd')).toBe(false); // three digits
    expect(PROVISIONED_PASSWORD_RE.test('TBS-9999-abc')).toBe(false); // three letters
    expect(PROVISIONED_PASSWORD_RE.test('TBS-9999-ABCD')).toBe(false); // upper case
    expect(PROVISIONED_PASSWORD_RE.test('tbs-9999-abcd')).toBe(false); // lower prefix
    expect(PROVISIONED_PASSWORD_RE.test('TBS-9999-abcd ')).toBe(false); // trailing space
  });
});
