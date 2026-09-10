import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from '../i18n/locales/en';
import type { CaseRegistryItem } from '../lib/caseRegistry';
import type { AppointmentRow, PatientRow, TbCaseRow, TreatmentFollowupRow } from '../lib/types';
import CaseVisitWorkflow from './CaseVisitWorkflow';

const mock = vi.hoisted(() => {
  const state = {
    rpcCalls: [] as Array<[string, Record<string, unknown>]>,
    updateCalls: [] as Array<[string, Record<string, unknown>, string, unknown]>,
    rpcError: null as { message: string } | null,
    updateError: null as { message: string } | null,
  };
  return {
    state,
    supabase: {
      rpc(name: string, fields: Record<string, unknown>) {
        state.rpcCalls.push([name, fields]);
        return Promise.resolve({ data: {}, error: state.rpcError });
      },
      from(table: string) {
        return {
          update(fields: Record<string, unknown>) {
            return {
              eq(column: string, value: unknown) {
                state.updateCalls.push([table, fields, column, value]);
                return Promise.resolve({ data: null, error: state.updateError });
              },
            };
          },
        };
      },
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mock.supabase }));

const patient: PatientRow = {
  patient_id: 'patient-1', display_code: 'MLB-0001', enrolled_by: 'staff-1',
  full_name: 'Juan Dela Cruz', first_name: 'Juan', middle_name: null, last_name: 'Dela Cruz',
  birthdate: '1990-01-01', age: 36, sex: 'male', barangay_code: '101301001', sitio: null,
  contact_number: null, sms_consent: false, consent_date: null, preferred_language: null,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
};

const tbCase = (over: Partial<TbCaseRow> = {}): TbCaseRow => ({
  case_id: 'case-1', patient_id: 'patient-1', referral_id: 'ref-1', facility_id: 'fac-1',
  case_number: 'TBC-MLB-2026-00001', registration_date: '2026-09-01', case_status: 'on_treatment',
  treatment_start_date: '2026-09-01', outcome: null, outcome_date: null, created_by: 'staff-1',
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...over,
});

const appointment = (over: Partial<AppointmentRow> = {}): AppointmentRow => ({
  appointment_id: 'appt-1', patient_id: 'patient-1', facility_id: 'fac-1', referral_id: null,
  tb_case_id: 'case-1', scheduled_date: '2026-09-09', attended_date: null, status: 'scheduled',
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...over,
});

const followup = (over: Partial<TreatmentFollowupRow> = {}): TreatmentFollowupRow => ({
  followup_id: 'followup-1', case_id: 'case-1', appointment_id: 'appt-1', visit_date: '2026-09-09',
  notes: 'Initial note', recorded_by: 'staff-1', voided_at: null, voided_by: null,
  void_reason: null, created_at: '2026-09-09T00:00:00Z', updated_at: '2026-09-09T00:00:00Z', ...over,
});

function makeItem(over: Partial<CaseRegistryItem> = {}): CaseRegistryItem {
  return {
    tbCase: tbCase(), patient, followups: [], appointments: [appointment()],
    latestFollowup: null, nextAppointment: appointment(), attention: null, ...over,
  };
}

beforeEach(() => {
  mock.state.rpcCalls = [];
  mock.state.updateCalls = [];
  mock.state.rpcError = null;
  mock.state.updateError = null;
});

describe('CaseVisitWorkflow', () => {
  it('records attendance, notes, and the next appointment in one idempotent RPC', async () => {
    const onChanged = vi.fn(async () => {});
    render(<CaseVisitWorkflow item={makeItem()} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText(en.cases.visit.appointment), { target: { value: 'appt-1' } });
    fireEvent.change(screen.getByLabelText(en.cases.visit.date), { target: { value: '2026-09-10' } });
    fireEvent.change(screen.getByLabelText(en.cases.visit.notes), { target: { value: 'Dose observed.' } });
    fireEvent.change(screen.getByLabelText(en.cases.visit.nextDate), { target: { value: '2026-09-17' } });
    fireEvent.click(screen.getByRole('button', { name: en.cases.visit.save }));

    await waitFor(() => expect(mock.state.rpcCalls).toHaveLength(1));
    expect(mock.state.rpcCalls[0]).toEqual(['record_visit', expect.objectContaining({
      p_case_id: 'case-1', p_appointment_id: 'appt-1', p_visit_date: '2026-09-10',
      p_notes: 'Dose observed.', p_next_scheduled_date: '2026-09-17', p_new_case_status: null,
    })]);
    expect(mock.state.rpcCalls[0][1].p_request_id).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  });

  it('keeps the request id stable when a visit call is retried', async () => {
    mock.state.rpcError = { message: 'network unavailable' };
    render(<CaseVisitWorkflow item={makeItem()} onChanged={vi.fn(async () => {})} />);
    const button = screen.getByRole('button', { name: en.cases.visit.save });
    fireEvent.click(button);
    await waitFor(() => expect(mock.state.rpcCalls).toHaveLength(1));
    fireEvent.click(button);
    await waitFor(() => expect(mock.state.rpcCalls).toHaveLength(2));
    expect(mock.state.rpcCalls[1][1].p_request_id).toBe(mock.state.rpcCalls[0][1].p_request_id);
  });

  it('can atomically mark a missed appointment attended and start treatment', async () => {
    const item = makeItem({
      tbCase: tbCase({ case_status: 'registered', treatment_start_date: null }),
      appointments: [appointment({ status: 'missed' })],
    });
    render(<CaseVisitWorkflow item={item} onChanged={vi.fn(async () => {})} />);
    fireEvent.change(screen.getByLabelText(en.cases.visit.appointment), { target: { value: 'appt-1' } });
    fireEvent.change(screen.getByLabelText(en.cases.visit.statusAfter), { target: { value: 'on_treatment' } });
    fireEvent.change(screen.getByLabelText(en.cases.startDate), { target: { value: '2026-09-10' } });
    fireEvent.click(screen.getByRole('button', { name: en.cases.visit.save }));

    await waitFor(() => expect(mock.state.rpcCalls[0][1]).toMatchObject({
      p_appointment_id: 'appt-1', p_new_case_status: 'on_treatment',
      p_treatment_start_date: '2026-09-10',
    }));
  });

  it('closes a case with an outcome and never books a next visit in that call', async () => {
    render(<CaseVisitWorkflow item={makeItem()} onChanged={vi.fn(async () => {})} />);
    fireEvent.change(screen.getByLabelText(en.cases.visit.statusAfter), { target: { value: 'closed' } });
    fireEvent.change(screen.getByLabelText(en.cases.outcomeLabel), { target: { value: 'treatment_completed' } });
    fireEvent.change(screen.getByLabelText(en.cases.outcomeDate), { target: { value: '2026-09-10' } });
    expect(screen.queryByLabelText(en.cases.visit.nextDate)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.cases.visit.save }));

    await waitFor(() => expect(mock.state.rpcCalls).toHaveLength(1));
    expect(mock.state.rpcCalls[0][1]).toMatchObject({
      p_new_case_status: 'closed', p_outcome: 'treatment_completed',
      p_outcome_date: '2026-09-10', p_next_scheduled_date: null,
    });
  });

  it('corrects a visit date through the paired appointment/follow-up RPC', async () => {
    render(<CaseVisitWorkflow item={makeItem({ followups: [followup()] })} onChanged={vi.fn(async () => {})} />);
    fireEvent.click(screen.getByRole('button', { name: en.cases.visit.correctDate }));
    fireEvent.change(screen.getByLabelText(en.cases.visit.correctedDate), { target: { value: '2026-09-10' } });
    fireEvent.click(screen.getByRole('button', { name: en.cases.visit.saveCorrection }));
    await waitFor(() => expect(mock.state.rpcCalls[0]).toEqual(['correct_followup_visit_date', {
      p_followup_id: 'followup-1', p_visit_date: '2026-09-10',
    }]));
  });

  it('updates notes only through the allowed column-scoped write', async () => {
    render(<CaseVisitWorkflow item={makeItem({ followups: [followup()] })} onChanged={vi.fn(async () => {})} />);
    fireEvent.click(screen.getByRole('button', { name: en.cases.visit.correctNotes }));
    fireEvent.change(screen.getByLabelText(en.cases.visit.correctedNotes), { target: { value: 'Corrected note' } });
    fireEvent.click(screen.getByRole('button', { name: en.cases.visit.saveCorrection }));
    await waitFor(() => expect(mock.state.updateCalls).toEqual([
      ['treatment_followups', { notes: 'Corrected note' }, 'followup_id', 'followup-1'],
    ]));
  });

  it('voids without deleting and can separately undo mistaken attendance', async () => {
    const voided = followup({ voided_at: '2026-09-10T01:00:00Z', voided_by: 'staff-1', void_reason: 'Wrong patient' });
    const { rerender } = render(<CaseVisitWorkflow item={makeItem({ followups: [followup()] })} onChanged={vi.fn(async () => {})} />);
    fireEvent.click(screen.getByRole('button', { name: en.cases.visit.voidRecord }));
    fireEvent.change(screen.getByLabelText(en.cases.visit.voidReason), { target: { value: 'Wrong patient' } });
    fireEvent.click(screen.getByRole('button', { name: en.cases.visit.confirmVoid }));
    await waitFor(() => expect(mock.state.rpcCalls[0]).toEqual(['void_tb_followup', {
      p_followup_id: 'followup-1', p_reason: 'Wrong patient',
    }]));

    rerender(<CaseVisitWorkflow item={makeItem({ followups: [voided], appointments: [appointment({ status: 'attended', attended_date: '2026-09-09' })] })} onChanged={vi.fn(async () => {})} />);
    fireEvent.click(screen.getByRole('button', { name: en.cases.visit.undoAttendance }));
    await waitFor(() => expect(mock.state.updateCalls).toContainEqual([
      'appointments', { status: 'scheduled', attended_date: null }, 'appointment_id', 'appt-1',
    ]));
  });

  it('keeps terminal cases read-only while retaining correction tools', () => {
    render(<CaseVisitWorkflow item={makeItem({ tbCase: tbCase({ case_status: 'closed', outcome: 'cured', outcome_date: '2026-09-10' }), followups: [followup()] })} onChanged={vi.fn(async () => {})} />);
    expect(screen.getByText(en.cases.visit.terminal)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.cases.visit.save })).toBeNull();
    expect(screen.getByRole('button', { name: en.cases.visit.correctDate })).toBeTruthy();
  });

  it('does not undo attendance when a voided visit already has a live replacement', () => {
    const voided = followup({
      followup_id: 'followup-old',
      voided_at: '2026-09-10T01:00:00Z',
      voided_by: 'staff-1',
      void_reason: 'Replaced',
    });
    const replacement = followup({ followup_id: 'followup-new', notes: 'Replacement record' });
    render(
      <CaseVisitWorkflow
        item={makeItem({
          followups: [replacement, voided],
          appointments: [appointment({ status: 'attended', attended_date: '2026-09-09' })],
        })}
        onChanged={vi.fn(async () => {})}
      />,
    );
    expect(screen.queryByRole('button', { name: en.cases.visit.undoAttendance })).toBeNull();
  });
});
