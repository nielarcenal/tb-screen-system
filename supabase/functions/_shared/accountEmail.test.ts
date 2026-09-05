/**
 * accountEmail — the retry predicate that D-15 turned on.
 *
 * The defect was a blanket `if (!createErr)`: every createUser failure advanced
 * the email suffix, so an outage, a bad key or a rate limit all came back to
 * the caller as 409 "could not allocate a unique email" after 48 round-trips.
 * These tests are mostly about the NEGATIVE cases — the errors that must not be
 * mistaken for a collision — because that direction is the one that regresses
 * silently: read a collision as an outage and provisioning visibly breaks, but
 * read an outage as a collision and it merely lies.
 */
import { describe, expect, it } from 'vitest';

import { candidateEmail, isEmailTaken, slugPart } from './accountEmail.ts';

describe('slugPart', () => {
  it('lowercases and strips everything that is not an ASCII letter', () => {
    expect(slugPart('Juan')).toBe('juan');
    expect(slugPart('Dela Cruz')).toBe('delacruz');
    expect(slugPart("O'Brien-Santos")).toBe('obriensantos');
    expect(slugPart('  Maria  ')).toBe('maria');
  });

  it('strips accents rather than dropping the letters under them', () => {
    // Peñaflor → penaflor, not pnaflor: the ñ decomposes to n + a combining
    // tilde, and only the tilde is removed.
    expect(slugPart('Peñaflor')).toBe('penaflor');
    expect(slugPart('José')).toBe('jose');
  });

  it('returns empty for a name with no letters at all — the caller rejects it', () => {
    expect(slugPart('123')).toBe('');
    expect(slugPart('   ')).toBe('');
  });
});

describe('candidateEmail', () => {
  it('leaves the first attempt unsuffixed and numbers the rest from 2', () => {
    expect(candidateEmail('juan.cruz', 1)).toBe('juan.cruz@tbscreen.ph');
    expect(candidateEmail('juan.cruz', 2)).toBe('juan.cruz.2@tbscreen.ph');
    expect(candidateEmail('juan.cruz', 49)).toBe('juan.cruz.49@tbscreen.ph');
  });

  it('never emits a ".1" address — those were never issued in the live project', () => {
    const all = Array.from({ length: 49 }, (_, i) => candidateEmail('a.b', i + 1));
    expect(all.filter((e) => e.includes('.1@'))).toEqual([]);
    expect(new Set(all).size).toBe(all.length); // and every attempt is distinct
  });
});

describe('isEmailTaken', () => {
  it('recognises a collision by error code', () => {
    expect(isEmailTaken({ code: 'email_exists', status: 422 })).toBe(true);
    expect(isEmailTaken({ code: 'user_already_exists', status: 422 })).toBe(true);
  });

  it('recognises a collision by message when no code is present', () => {
    for (const message of [
      'A user with this email address has already been registered',
      'User already registered',
      'Email address is already in use by another user',
      'duplicate key value violates unique constraint — already exists',
    ]) {
      expect(isEmailTaken({ message })).toBe(true);
    }
  });

  it('does NOT treat other failures as a collision — the whole point of D-15', () => {
    const notCollisions = [
      { message: 'Password should be at least 6 characters', code: 'weak_password', status: 422 },
      { message: 'Request rate limit reached', code: 'over_request_rate_limit', status: 429 },
      { message: 'Invalid API key', status: 401 },
      { message: 'Database error creating new user', status: 500 },
      { message: 'fetch failed' },
      { message: 'Unable to validate email address: invalid format', status: 400 },
    ];
    for (const err of notCollisions) {
      expect(isEmailTaken(err)).toBe(false);
    }
  });

  it('treats a 422 on its own as NOT a collision', () => {
    // 422 covers every unprocessable body. Matching on the status alone is the
    // over-broad reading this function replaced.
    expect(isEmailTaken({ status: 422 })).toBe(false);
    expect(isEmailTaken({ status: 422, message: 'Unprocessable Entity' })).toBe(false);
  });

  it('is false for no error at all', () => {
    expect(isEmailTaken(null)).toBe(false);
    expect(isEmailTaken(undefined)).toBe(false);
    expect(isEmailTaken({})).toBe(false);
  });
});
