import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from '../i18n/locales/en';
import type { TimelineEventRow } from '../lib/types';
import PatientTimeline from './PatientTimeline';

const mock = vi.hoisted(() => {
  const state = {
    events: [] as TimelineEventRow[],
    error: null as { message: string } | null,
    calls: [] as Array<[string, Record<string, unknown>]>,
  };
  return {
    state,
    supabase: {
      rpc(name: string, fields: Record<string, unknown>) {
        state.calls.push([name, fields]);
        return Promise.resolve({ data: state.events, error: state.error });
      },
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mock.supabase }));

function event(over: Partial<TimelineEventRow> = {}): TimelineEventRow {
  return {
    event_id: 'case_registered:1',
    event_type: 'case_registered',
    occurred_on: '2026-09-01',
    occurred_at: '2026-09-01T01:00:00Z',
    is_undated: false,
    occurred_on_is_derived: false,
    rank: 70,
    actor_user_id: 'staff-1',
    actor_role: 'tb_dots',
    facility_id: 'fac-1',
    facility_name: 'Malaybalay CHO',
    case_id: 'case-1',
    detail: { case_number: 'TBC-MLB-2026-00001' },
    ...over,
  };
}

beforeEach(() => {
  mock.state.events = [];
  mock.state.error = null;
  mock.state.calls = [];
});

describe('PatientTimeline', () => {
  it('renders factual dated events and a separate honest undated group', async () => {
    mock.state.events = [
      event(),
      event({
        event_id: 'appointment_overdue:1', event_type: 'appointment_overdue',
        occurred_on: '2026-09-08', occurred_at: null, rank: 114,
        occurred_on_is_derived: true, actor_user_id: null, actor_role: null, detail: {},
      }),
      event({
        event_id: 'referral_received:old', event_type: 'referral_received',
        occurred_on: null, occurred_at: null, rank: 40, is_undated: true,
        actor_user_id: null, actor_role: null, case_id: null, detail: {},
      }),
    ];
    render(<PatientTimeline patientId="patient-1" />);

    expect(await screen.findByText(en.cases.timeline.event.case_registered)).toBeTruthy();
    expect(screen.getByText('TBC-MLB-2026-00001')).toBeTruthy();
    expect(screen.getByText(en.cases.timeline.event.appointment_overdue)).toBeTruthy();
    expect(screen.getByText(en.cases.timeline.derived)).toBeTruthy();
    expect(screen.getByText(en.cases.timeline.undatedTitle)).toBeTruthy();
    expect(screen.getByText(en.cases.timeline.dateUnknown)).toBeTruthy();
    expect(mock.state.calls[0]).toEqual(['patient_timeline', {
      p_patient_id: 'patient-1', p_limit: 500,
    }]);
  });

  it('formats only whitelisted structured details', async () => {
    mock.state.events = [
      event({ event_id: 'screening:1', event_type: 'screening_recorded', rank: 20, detail: { referred: true } }),
      event({ event_id: 'appointment:1', event_type: 'appointment_scheduled', rank: 90, detail: { scheduled_date: '2026-09-15' } }),
      event({ event_id: 'sms:1', event_type: 'sms_sent', rank: 100, actor_role: 'system', detail: { message_kind: 'reminder', delivery_status: 'sent' } }),
    ];
    render(<PatientTimeline patientId="patient-1" />);

    expect(await screen.findByText(en.cases.timeline.referralRecommended)).toBeTruthy();
    expect(screen.getByText(en.cases.timeline.scheduledFor.replace('{{date}}', new Date('2026-09-15T00:00:00').toLocaleDateString()))).toBeTruthy();
    expect(screen.getByText(`${en.cases.timeline.messageKind.reminder} — ${en.cases.timeline.delivery.sent}`)).toBeTruthy();
    expect(screen.getByText(en.cases.timeline.system)).toBeTruthy();
  });

  it('shows an indistinguishable empty state when the RPC returns no visible rows', async () => {
    render(<PatientTimeline patientId="patient-1" />);
    expect(await screen.findByText(en.cases.timeline.empty)).toBeTruthy();
  });

  it('surfaces failures and retries the same patient-scoped read', async () => {
    mock.state.error = { message: 'network unavailable' };
    render(<PatientTimeline patientId="patient-1" />);
    expect((await screen.findByRole('alert')).textContent).toContain(en.cases.timeline.loadError);
    mock.state.error = null;
    mock.state.events = [event()];
    fireEvent.click(screen.getByRole('button', { name: en.inbox.retry }));
    await screen.findByText(en.cases.timeline.event.case_registered);
    expect(mock.state.calls).toHaveLength(2);
  });

  it('warns when the bounded server result reaches its limit', async () => {
    mock.state.events = Array.from({ length: 500 }, (_, index) => event({
      event_id: `event:${index}`,
      event_type: 'other',
      detail: {},
    }));
    render(<PatientTimeline patientId="patient-1" />);
    await waitFor(() => expect(screen.getAllByText(en.cases.timeline.event.other)).toHaveLength(500));
    expect(screen.getByText(en.cases.timeline.limit)).toBeTruthy();
  });
});
