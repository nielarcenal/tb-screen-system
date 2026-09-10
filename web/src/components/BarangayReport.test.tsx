/**
 * BarangayReport — the properties that are easy to break and expensive to be
 * wrong about.
 *
 * The one that matters most is LIKE FOR LIKE. The first version asked for two
 * whole calendar years, so a nine-month current year was compared against a
 * twelve-month previous one and every barangay appeared to be improving. That
 * is not a cosmetic bug: it is a false finding, shown beside a health office's
 * real one. The comparison period must end on the same day of the year as the
 * selected period, and that is pinned here in both directions — partial year
 * and finished year.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import BarangayReport from './BarangayReport';

/** Fake PostgREST. Records every rpc() call and answers keyed on from_date. */
const mock = vi.hoisted(() => {
  const db = {
    byFrom: new Map<string, unknown[]>(),
    calls: [] as { from: string; to: string }[],
  };
  const supabase = {
    rpc: (_fn: string, args: { from_date: string; to_date: string }) => {
      db.calls.push({ from: args.from_date, to: args.to_date });
      return Promise.resolve({ data: db.byFrom.get(args.from_date) ?? [], error: null });
    },
  };
  return { db, supabase };
});

vi.mock('../lib/supabase', () => ({ supabase: mock.supabase }));

/** One barangay_report_v2() row, shaped as 0039 returns it. */
const row = (name: string, over: Partial<Record<string, number>> = {}) => ({
  barangay_code: `code-${name}`,
  barangay_name: name,
  city_name: 'Valencia City',
  screened_count: 0,
  referred_count: 0,
  case_count: 0,
  successful_outcome_count: 0,
  lost_to_follow_up_count: 0,
  ...over,
});

const thisYear = new Date().getFullYear();

beforeEach(() => {
  mock.db.byFrom.clear();
  mock.db.calls.length = 0;
});

describe('BarangayReport', () => {
  it('compares LIKE FOR LIKE: both periods end on the same month and day', async () => {
    mock.db.byFrom.set(`${thisYear}-01-01`, [row('POBLACION', { referred_count: 3 })]);
    render(<BarangayReport />);

    await waitFor(() => expect(mock.db.calls.length).toBe(2));
    const [a, b] = [...mock.db.calls].sort((x, y) => x.from.localeCompare(y.from));
    expect(a.from).toBe(`${thisYear - 1}-01-01`);
    expect(b.from).toBe(`${thisYear}-01-01`);
    expect(a.to.slice(4)).toBe(b.to.slice(4));
    expect(Number(b.to.slice(0, 4)) - Number(a.to.slice(0, 4))).toBe(1);
  });

  it('does not run the CURRENT year to 31 December — it stops at today', async () => {
    // Asking for the whole calendar year is the bug: it pads the current year
    // with months that have not happened and makes every count look lower.
    mock.db.byFrom.set(`${thisYear}-01-01`, [row('POBLACION', { referred_count: 3 })]);
    render(<BarangayReport />);

    await waitFor(() => expect(mock.db.calls.length).toBe(2));
    const current = mock.db.calls.find((c) => c.from.startsWith(String(thisYear)))!;
    expect(current.to.endsWith('-12-31')).toBe(false);
  });

  it('uses whole years once the selected year has finished', async () => {
    mock.db.byFrom.set(`${thisYear - 1}-01-01`, [row('POBLACION', { referred_count: 5 })]);
    render(<BarangayReport />);
    await waitFor(() => expect(mock.db.calls.length).toBe(2));

    mock.db.calls.length = 0;
    fireEvent.click(screen.getByRole('button', { name: String(thisYear - 1) }));

    await waitFor(() => expect(mock.db.calls.length).toBe(2));
    for (const c of mock.db.calls) {
      expect(c.from.slice(4)).toBe('-01-01');
      expect(c.to.slice(4)).toBe('-12-31');
    }
  });

  it('ranks by the SELECTED measure, not the order the RPC returned', async () => {
    mock.db.byFrom.set(`${thisYear}-01-01`, [
      row('ALPHA', { case_count: 9, referred_count: 1 }),
      row('BETA', { case_count: 0, referred_count: 7 }),
    ]);
    render(<BarangayReport />);

    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
    // The name is a <th scope="row">, not a cell — the rank number is the
    // first cell now. Read the whole row so the assertion survives either.
    const firstCell = () =>
      within(screen.getByRole('table')).getAllByRole('row')[2].textContent;
    expect(firstCell()).toContain('BETA');

    fireEvent.click(screen.getByRole('button', { name: 'Registered cases' }));
    await waitFor(() => expect(firstCell()).toContain('ALPHA'));
  });

  it('keeps a barangay with no activity, showing zeros rather than dropping it', async () => {
    // "No cases" and "not covered" are different statements; the table must not
    // collapse them. The health office sheet lists Vintar at 0 for 2024.
    mock.db.byFrom.set(`${thisYear}-01-01`, [
      row('POBLACION', { referred_count: 4 }),
      row('VINTAR'),
    ]);
    render(<BarangayReport />);

    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows.some((r) => r.textContent?.includes('VINTAR'))).toBe(true);
  });

  it('states the period, and states what the report is not', async () => {
    mock.db.byFrom.set(`${thisYear}-01-01`, [row('POBLACION', { referred_count: 1 })]);
    render(<BarangayReport />);

    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
    // The current year is partial, so the like-for-like sentence must be shown.
    expect(screen.getByText(/same dates/i)).toBeTruthy();
    expect(screen.getByText(/DOH ITIS/i)).toBeTruthy();
    expect(screen.getByText(/not automatically classified/i)).toBeTruthy();
  });
  it('search narrows the table without touching the ranking numbers', async () => {
    mock.db.byFrom.set(`${thisYear}-01-01`, [
      row('POBLACION', { referred_count: 9 }),
      row('VINTAR', { referred_count: 1 }),
    ]);
    render(<BarangayReport />);
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'vint' } });

    await waitFor(() => {
      const body = within(screen.getByRole('table')).getAllByRole('row').slice(2);
      expect(body).toHaveLength(1);
      expect(body[0].textContent).toContain('VINTAR');
    });
    // Rank is the barangay's position overall, not its position in the filtered
    // view: Vintar is 2nd by referrals and must still say 2 after searching.
    expect(within(screen.getByRole('table')).getAllByRole('row')[2].textContent).toMatch(/^2/);
  });

  it('pages the table rather than printing all 31 barangays at once', async () => {
    mock.db.byFrom.set(
      `${thisYear}-01-01`,
      Array.from({ length: 23 }, (_, i) =>
        row(`BRGY${String(i).padStart(2, '0')}`, { referred_count: 23 - i }),
      ),
    );
    render(<BarangayReport />);
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());

    const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(2);
    expect(bodyRows()).toHaveLength(10);

    fireEvent.click(screen.getByRole('button', { name: '3' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(3)); // 23 = 10 + 10 + 3
  });
});
