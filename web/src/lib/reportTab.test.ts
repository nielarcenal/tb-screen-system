/**
 * reportTabVisible — the rule that decides whether a whole nav item exists.
 *
 * Worth pinning because the correct behaviour is asymmetric and the wrong one
 * is simpler: hide on "function not found", show on everything else. A future
 * `!error` refactor passes a casual reading and silently removes the tab
 * whenever the network blips.
 */
import { describe, expect, it } from 'vitest';

import { reportTabVisible } from './types';

describe('reportTabVisible', () => {
  it('shows the tab when the probe succeeds', () => {
    expect(reportTabVisible(null)).toBe(true);
    expect(reportTabVisible(undefined)).toBe(true);
  });

  it('hides the tab when the function does not exist yet (migration unapplied)', () => {
    expect(reportTabVisible({ code: 'PGRST202' })).toBe(false);
  });

  it('KEEPS the tab on any other failure, so a blip is not mistaken for a missing feature', () => {
    // A dropped connection, a permission error, a timeout: the view itself can
    // explain these and offer a retry. Vanishing from the nav cannot be retried.
    expect(reportTabVisible({ code: '42501' })).toBe(true); // insufficient privilege
    expect(reportTabVisible({ code: 'PGRST301' })).toBe(true); // JWT expired
    expect(reportTabVisible({})).toBe(true); // no code at all
  });
});
