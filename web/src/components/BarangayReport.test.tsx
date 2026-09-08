/**
 * BarangayReport — the properties that are easy to break and expensive to be
 * wrong about.
 *
 * The report is the artifact a health office would read next to its own signed
 * sheet, so the things pinned here are the ones that would quietly turn it into
 * a different claim:
 *
 *   1. It asks for TWO years, not one. The year-over-year column is the whole
 *      reason it mirrors the CHO sheet; a refactor that drops the second fetch
 *      leaves the previous-year column silently reading 0 for everyone.
 *   2. The ranking follows the SELECTED measure. The RPC orders by positives,
 *      so a component that renders the rows as they arrive looks correct until
 *      someone picks a different measure — and then shows a ranking that
 *      contradicts its own numbers.
 *   3. A barangay with no activity still appears with zeros. The CHO sheet
 *      lists Vintar with 0 cases in 2024; dropping empty rows would misreport
 *      "no data recorded" as "barangay not covered".
 *   4. The scope disclaimer renders. It is the sentence that keeps a screenshot
 *      of this view from reading as a claim to be the city case register.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import BarangayReport from './BarangayReport';

/**
 * Fake PostgREST. Records every rpc() call so the two-year fetch can be
 * asserted, and answers from a per-year table.
 */
const mock = vi.hoisted(() => {
  const db = { byYear: new Map<string, unknown[]>(), calls: [] as { from: string; to: string }[] };
  const supabase = {
    rpc: (_fn: string, args: { from_date: string; to_date: string }) => {
      db.calls.push({ from: args.from_date, to: args.to_date });
      const year = args.from_date.slice(0, 4);
      return Promise.resolve({ data: db.byYear.get(year) ?? [], error: null });
    },
  };
  return { db, supabase };
});

vi.mock('../lib/supabase', () => ({ supabase: mock.supabase }));

/** One barangay_report() row, shaped as 0027 returns it. */
const row = (name: string, over: Partial<Record<string, number>> = {}) => ({
  barangay_code: `code-${name}`,
  barangay_name: name,
  city_name: 'Valencia City',
  screened_count: 0,
  referred_count: 0,
  presented_count: 0,
  tested_count: 0,
  positive_count: 0,
  missed_count: 0,
  ...over,
});

const thisYear = new Date().getFullYear();

beforeEach(() => {
  mock.db.byYear.clear();
  mock.db.calls.length = 0;
});

describe('BarangayReport', () => {
  it('fetches the selected year AND the one before it', async () => {
    mock.db.byYear.set(String(thisYear), [row('POBLACION', { referred_count: 3 })]);
    render(<BarangayReport />);

    await waitFor(() => expect(mock.db.calls.length).toBe(2));
    const years = mock.db.calls.map((c) => c.from.slice(0, 4)).sort();
    expect(years).toEqual([String(thisYear - 1), String(thisYear)]);
  });

  it('asks for whole calendar years, so the columns line up with the health office sheet', async () => {
    mock.db.byYear.set(String(thisYear), [row('POBLACION', { referred_count: 1 })]);
    render(<BarangayReport />);

    await waitFor(() => expect(mock.db.calls.length).toBe(2));
    for (const c of mock.db.calls) {
      expect(c.from.slice(4)).toBe('-01-01');
      expect(c.to.slice(4)).toBe('-12-31');
    }
  });

  it('ranks by the SELECTED measure, not by the order the RPC returned', async () => {
    // Arrives ordered by positives (as 0027 orders): ALPHA leads on positives,
    // BETA leads on referrals. Switching the measure must re-rank.
    mock.db.byYear.set(String(thisYear), [
      row('ALPHA', { positive_count: 9, referred_count: 1 }),
      row('BETA', { positive_count: 0, referred_count: 7 }),
    ]);
    render(<BarangayReport />);

    // Default measure is Referred, so BETA outranks ALPHA in the table.
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
    const firstCell = () =>
      within(within(screen.getByRole('table')).getAllByRole('row')[1]).getAllByRole('cell')[0]
        .textContent;
    expect(firstCell()).toContain('BETA');

    fireEvent.click(screen.getByRole('button', { name: 'Positive' }));
    await waitFor(() => expect(firstCell()).toContain('ALPHA'));
  });

  it('keeps a barangay with no activity, showing zeros rather than dropping it', async () => {
    // The CHO sheet lists Vintar at 0 for 2024. "No cases" and "not covered"
    // are different statements and the table must not collapse them.
    mock.db.byYear.set(String(thisYear), [
      row('POBLACION', { referred_count: 4 }),
      row('VINTAR'),
    ]);
    render(<BarangayReport />);

    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows.some((r) => r.textContent?.includes('VINTAR'))).toBe(true);
  });

  it('states what the report is not', async () => {
    mock.db.byYear.set(String(thisYear), [row('POBLACION', { referred_count: 1 })]);
    render(<BarangayReport />);

    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
    expect(screen.getByText(/not a replacement for it/i)).toBeTruthy();
    expect(screen.getByText(/does not track treatment/i)).toBeTruthy();
  });
});
