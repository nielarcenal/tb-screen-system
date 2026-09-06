/**
 * BhwManagement — the barangay grouping on the admin's roster.
 *
 * A captain's list is one barangay's worth of people and reads fine flat. The
 * admin's spans the whole province, and the moment a barangay holds more than
 * one worker a flat roster of names stops answering the question anyone
 * actually has, which is "who covers where".
 *
 * These pin the grouping and, just as importantly, pin that the CAPTAIN's list
 * stays flat. Grouping both callers is the obvious way to write this and is
 * wrong: it would put a single heading above every row a captain owns, naming
 * the one barangay they already know they are looking at.
 *
 * The fixture mirrors the shape of the live data at the time of writing — four
 * barangays, one of them holding two workers — because a grouping that is only
 * ever exercised with one row per group proves nothing.
 */
import { render, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from '../i18n/locales/en';
import BhwManagement from './BhwManagement';

const mock = vi.hoisted(() => {
  const db = { rows: [] as unknown[] };
  const supabase = {
    rpc: (fn: string) =>
      fn === 'bhw_activity'
        ? Promise.resolve({ data: db.rows, error: null })
        : Promise.resolve({ data: null, error: null }),
    // The address cascade inside the create drawer reads ref_* tables; the
    // drawer is never opened here, but the chain must not blow up on import.
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
        eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  };
  return { db, supabase };
});

vi.mock('../lib/supabase', () => ({ supabase: mock.supabase }));

/** One bhw_activity() row. */
const bhw = (full_name: string, barangay_name: string | null, over = {}) => ({
  user_id: crypto.randomUUID(),
  full_name,
  first_name: full_name.split(' ')[0],
  middle_name: null,
  last_name: full_name.split(' ').slice(-1)[0],
  purok: null,
  email: `${full_name.toLowerCase().replace(/\s+/g, '.')}@tbscreen.ph`,
  barangay_code: barangay_name ? '1013120' + barangay_name.length : null,
  barangay_name,
  joined_at: '2026-07-08T00:00:00.000Z',
  active: true,
  screenings_n: 0,
  referrals_n: 0,
  ...over,
});

/**
 * The live distribution as of 2026-09-06 — four barangays, one holding two.
 *
 * Deliberately supplied OUT OF ORDER on both axes: Mt. Nebo's pair is reversed,
 * and the barangays do not arrive alphabetically. A fixture that is already
 * sorted cannot tell a working sort from a missing one — checked by removing
 * each sort in turn and confirming a test fails.
 */
const LIVE_SHAPE = [
  bhw('Niel Arcenal', 'Mt. Nebo'),
  bhw('BHW Tester', 'Casisang'),
  bhw('Ivan Arcenal', 'Mt. Nebo'),
  bhw('Ray Arcenal', 'Bagontaas'),
  bhw('Niel Ivan Ray Barcenas Arcenal', 'Bangcud'),
];

const headings = () =>
  [...document.querySelectorAll('.bhw-groupname')].map((n) => n.textContent);

const rowNames = () =>
  [...document.querySelectorAll('.bhw-name')].map((n) => n.textContent);

async function renderAdmin(rows: unknown[] = LIVE_SHAPE) {
  mock.db.rows = rows;
  render(<BhwManagement asAdmin />);
  await waitFor(() => expect(document.querySelectorAll('.bhw-name').length).toBe(rows.length));
}

beforeEach(() => {
  mock.db.rows = [];
});

describe('admin roster — grouped by barangay', () => {
  it('puts every worker under their barangay, barangays in alphabetical order', async () => {
    await renderAdmin();
    expect(headings()).toEqual(['Bagontaas', 'Bangcud', 'Casisang', 'Mt. Nebo']);
  });

  it('collects the two workers who share a barangay under one heading', async () => {
    await renderAdmin();
    const nebo = document.querySelectorAll('.bhw-group')[3] as HTMLElement;
    expect(within(nebo).getByText('Mt. Nebo')).toBeTruthy();
    // Sorted by name inside the group, not left in fetch order.
    expect([...nebo.querySelectorAll('.bhw-name')].map((n) => n.textContent)).toEqual([
      'Ivan Arcenal',
      'Niel Arcenal',
    ]);
  });

  it('counts each group, and inflects the count', async () => {
    await renderAdmin();
    const counts = [...document.querySelectorAll('.bhw-groupcount')].map((n) => n.textContent);
    expect(counts).toEqual([
      en.bhw.groupCount_one.replace('{{count}}', '1'),
      en.bhw.groupCount_one.replace('{{count}}', '1'),
      en.bhw.groupCount_one.replace('{{count}}', '1'),
      en.bhw.groupCount_other.replace('{{count}}', '2'),
    ]);
  });

  it('keeps a BHW with no barangay visible, in a named bucket', async () => {
    // An unassigned BHW is precisely the row an admin needs to find and fix.
    // Dropping it, or hiding it under a blank heading, is the failure here.
    await renderAdmin([...LIVE_SHAPE, bhw('Unassigned Worker', null)]);
    expect(headings()).toContain(en.bhw.barangayNone);
    expect(rowNames()).toContain('Unassigned Worker');
  });

  it('drops the barangay from the row sub-line, since the heading carries it', async () => {
    await renderAdmin([bhw('Ray Arcenal', 'Bagontaas', { purok: 'Purok 3' })]);
    const sub = document.querySelector('.bhw-sub')!.textContent;
    expect(sub).toBe('Purok 3');
    expect(sub).not.toContain('Bagontaas');
  });
});

describe('captain roster — deliberately not grouped', () => {
  it('renders a flat list with no barangay headings', async () => {
    // Every row a captain sees is in their one barangay; a heading naming it
    // above every row is furniture, not information.
    mock.db.rows = [bhw('Ivan Arcenal', 'Mt. Nebo'), bhw('Niel Arcenal', 'Mt. Nebo')];
    render(<BhwManagement />);
    await waitFor(() => expect(document.querySelectorAll('.bhw-name').length).toBe(2));
    expect(document.querySelectorAll('.bhw-grouphead').length).toBe(0);
  });

  it('keeps the barangay on the row sub-line, where it is the only place it appears', async () => {
    mock.db.rows = [bhw('Ivan Arcenal', 'Mt. Nebo', { purok: 'Purok 1' })];
    render(<BhwManagement />);
    await waitFor(() => expect(document.querySelectorAll('.bhw-name').length).toBe(1));
    expect(document.querySelector('.bhw-sub')!.textContent).toBe('Purok 1 · Mt. Nebo');
  });
});
