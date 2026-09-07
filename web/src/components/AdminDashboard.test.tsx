/**
 * AdminDashboard — the active/deactivated split (0023).
 *
 * Before 0023 the Midwives and BHWs tiles counted deactivated accounts inside
 * their headline number, so "5 BHWs" could mean three who can sign in and two
 * who cannot. 0023 made the headline ACTIVE-only and surfaced the deactivated
 * figure beside it.
 *
 * These pin the part that live data cannot currently reach: every account in
 * the project database is active, so the non-zero branch renders nowhere and a
 * regression in it would be invisible until the first account is deactivated —
 * which is exactly when someone is relying on the number.
 *
 * The zero case is pinned too, and deliberately: appending "0 deactivated" to
 * every tile in the ordinary case is the obvious way to write this and is
 * wrong, so the absence is a behaviour worth holding still.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AdminDashboard from './AdminDashboard';

/**
 * Fake PostgREST. Hoisted because vi.mock's factory runs before the module
 * body. AdminDashboard builds exactly one call: supabase.rpc('admin_overview').
 */
const mock = vi.hoisted(() => {
  const db = { rows: [] as unknown[] };
  const supabase = { rpc: () => Promise.resolve({ data: db.rows, error: null }) };
  return { db, supabase };
});

// ../lib/supabase throws at import time without VITE_SUPABASE_URL.
vi.mock('../lib/supabase', () => ({ supabase: mock.supabase }));

/** One admin_overview() row, shaped as the 0023 function returns it. */
const facility = (over: Partial<Record<string, unknown>> = {}) => ({
  facility_id: crypto.randomUUID(),
  facility_name: 'Malaybalay City Health DOTS Center',
  midwives: 0,
  midwives_inactive: 0,
  bhws: 0,
  bhws_inactive: 0,
  open_referrals: 0,
  ...over,
});

/** The tile whose label matches, as rendered text. */
const tileText = (label: string) =>
  screen.getAllByText(label).map((el) => el.closest('.dtile')?.textContent ?? '')[0] ?? '';

beforeEach(() => {
  mock.db.rows = [];
});

describe('AdminDashboard deactivated split', () => {
  it('shows no deactivated note when every account is active', async () => {
    mock.db.rows = [facility({ midwives: 1, bhws: 5 })];
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getAllByText('BHWs').length).toBeGreaterThan(0));

    expect(tileText('BHWs')).toContain('5');
    expect(tileText('BHWs')).not.toMatch(/deactivated/i);
    expect(tileText('Midwives')).not.toMatch(/deactivated/i);
  });

  it('counts only ACTIVE accounts in the headline number', async () => {
    // The pre-0023 behaviour would render 7 here, not 5.
    mock.db.rows = [facility({ bhws: 5, bhws_inactive: 2 })];
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getAllByText('BHWs').length).toBeGreaterThan(0));

    const text = tileText('BHWs');
    expect(text).toContain('5');
    expect(text).not.toContain('7');
    expect(text).toMatch(/2 deactivated/i);
  });

  it('sums both figures across facilities', async () => {
    // The catchment split is real: 0022 counts personnel per referring
    // facility, so a program-wide tile is a sum over rows, not one row's value.
    mock.db.rows = [
      facility({ midwives: 1, midwives_inactive: 1, bhws: 2, bhws_inactive: 3 }),
      facility({ midwives: 0, midwives_inactive: 2, bhws: 3, bhws_inactive: 1 }),
    ];
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getAllByText('BHWs').length).toBeGreaterThan(0));

    expect(tileText('BHWs')).toContain('5');
    expect(tileText('BHWs')).toMatch(/4 deactivated/i);
    expect(tileText('Midwives')).toContain('1');
    expect(tileText('Midwives')).toMatch(/3 deactivated/i);
  });

  it('notes deactivated accounts even when none are active', async () => {
    // A barangay whose whole team is deactivated reads "0", and the reason for
    // the zero has to stay visible rather than the tile looking unstaffed.
    mock.db.rows = [facility({ bhws: 0, bhws_inactive: 4 })];
    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getAllByText('BHWs').length).toBeGreaterThan(0));

    expect(tileText('BHWs')).toMatch(/4 deactivated/i);
  });
});
