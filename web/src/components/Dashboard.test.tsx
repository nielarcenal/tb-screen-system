import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from '../i18n/locales/en';
import type { FacilityDashboardOverview } from '../lib/types';
import Dashboard, { type DashboardTarget } from './Dashboard';

const mock = vi.hoisted(() => {
  const db = {
    row: null as FacilityDashboardOverview | null,
    error: null as { message: string } | null,
    calls: 0,
  };
  return {
    db,
    supabase: {
      rpc: () => {
        db.calls += 1;
        return Promise.resolve({ data: db.row ? [db.row] : [], error: db.error });
      },
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mock.supabase }));

const row: FacilityDashboardOverview = {
  screened_today: 1, referred_today: 2, positive_today: 3, negative_today: 4,
  attended_today: 5, missed_today: 6, scheduled_today: 7,
  attention_overdue_followups: 8, attention_missed_followups: 9,
  attention_due_soon: 10, attention_referrals_awaiting: 11,
  attention_stale_cases: 12, attention_appointments_today: 13,
  metric_screened: 14, metric_referred: 15, metric_referral_received: 16,
  metric_cases_created: 17, metric_active_treatment_cases: 18,
  metric_followups_due: 19, metric_missed_followups: 20, metric_closed_cases: 21,
};

beforeEach(() => {
  mock.db.row = row;
  mock.db.error = null;
  mock.db.calls = 0;
});

describe('Dashboard', () => {
  it('loads all sections with one count-only RPC', async () => {
    render(<Dashboard />);
    expect(await screen.findByText(en.dashboard.attention.title)).toBeTruthy();
    expect(screen.getByText(en.dashboard.program.title)).toBeTruthy();
    expect(screen.getByText(en.dashboard.cardTitle)).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(en.dashboard.attention.overdue) }).textContent).toContain('8');
    expect(screen.getByText('21')).toBeTruthy();
    expect(mock.db.calls).toBe(1);
  });

  it('sends each attention card to its matching filtered list', async () => {
    const targets: DashboardTarget[] = [];
    render(<Dashboard onNavigate={(target) => targets.push(target)} />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(en.dashboard.attention.overdue) }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.dashboard.attention.awaiting) }));
    expect(targets).toEqual([
      { page: 'cases', filter: 'overdue' },
      { page: 'inbox', filter: 'awaiting' },
    ]);
  });

  it('shows honest zeros when the authorized facility has no data', async () => {
    mock.db.row = null;
    render(<Dashboard />);
    await screen.findByText(en.dashboard.attention.title);
    expect(screen.getAllByText('0')).toHaveLength(20);
  });

  it('surfaces an RPC failure and retries', async () => {
    mock.db.error = { message: 'offline' };
    render(<Dashboard />);
    expect(await screen.findByText(en.dashboard.errorTitle)).toBeTruthy();
    mock.db.error = null;
    fireEvent.click(screen.getByRole('button', { name: en.dashboard.retry }));
    await waitFor(() => expect(mock.db.calls).toBe(2));
    expect(await screen.findByText(en.dashboard.attention.title)).toBeTruthy();
  });
});
