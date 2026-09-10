import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from '../i18n/locales/en';
import type { AppointmentRow, PatientRow, TbCaseRow, TreatmentFollowupRow } from '../lib/types';
import CaseRegistry from './CaseRegistry';

const mock = vi.hoisted(() => {
  const db = {
    cases: [] as Record<string, unknown>[],
    patients: [] as Record<string, unknown>[],
    followups: [] as Record<string, unknown>[],
    appointments: [] as Record<string, unknown>[],
    loadError: null as { message: string } | null,
    rpcError: null as { message: string } | null,
    rpcCalls: [] as Array<[string, Record<string, unknown>]>,
  };

  const result = (table: string) => ({
    data: table === 'tb_cases' ? db.cases
      : table === 'patients' ? db.patients
        : table === 'treatment_followups' ? db.followups
          : db.appointments,
    error: table === 'tb_cases' ? db.loadError : null,
  });

  const supabase = {
    from(table: string) {
      const builder = {
        select: () => builder,
        in: () => table === 'patients' ? Promise.resolve(result(table)) : builder,
        order: () => Promise.resolve(result(table)),
      };
      return builder;
    },
    rpc(name: string, fields: Record<string, unknown>) {
      if (name === 'patient_timeline') return Promise.resolve({ data: [], error: null });
      db.rpcCalls.push([name, fields]);
      if (!db.rpcError && name === 'set_tb_case_status') {
        db.cases = db.cases.map((row) => row.case_id === fields.p_case_id
          ? {
              ...row,
              case_status: fields.p_new_status,
              treatment_start_date: fields.p_new_status === 'on_treatment'
                ? fields.p_treatment_start_date ?? row.treatment_start_date
                : row.treatment_start_date,
              outcome: fields.p_new_status === 'closed' ? fields.p_outcome : null,
              outcome_date: fields.p_new_status === 'closed' ? fields.p_outcome_date : null,
            }
          : row);
      }
      return Promise.resolve({ data: db.cases[0] ?? null, error: db.rpcError });
    },
  };
  return { db, supabase };
});

vi.mock('../lib/supabase', () => ({ supabase: mock.supabase }));

const patient: PatientRow = {
  patient_id: 'patient-1', display_code: 'MLB-0001', enrolled_by: 'bhw-1',
  full_name: 'Juan Dela Cruz', first_name: 'Juan', middle_name: null, last_name: 'Dela Cruz',
  birthdate: '1990-01-01', age: 36, sex: 'male', barangay_code: '101301001', sitio: null,
  contact_number: null, sms_consent: false, consent_date: null, preferred_language: null,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
};

const tbCase = (over: Partial<TbCaseRow> = {}): TbCaseRow => ({
  case_id: 'case-1', patient_id: 'patient-1', referral_id: 'ref-1', facility_id: 'fac-1',
  case_number: 'TBC-MLB-2026-00001', registration_date: '2026-09-01', case_status: 'registered',
  treatment_start_date: null, outcome: null, outcome_date: null, created_by: 'staff-1',
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...over,
});

const followup: TreatmentFollowupRow = {
  followup_id: 'follow-1', case_id: 'case-1', appointment_id: null, visit_date: '2026-09-08',
  notes: 'Patient attended.', recorded_by: 'staff-1', voided_at: null, voided_by: null,
  void_reason: null, created_at: '2026-09-08T00:00:00Z', updated_at: '2026-09-08T00:00:00Z',
};

const appointment: AppointmentRow = {
  appointment_id: 'appt-1', patient_id: 'patient-1', facility_id: 'fac-1', referral_id: null,
  tb_case_id: 'case-1', scheduled_date: '2099-09-20', attended_date: null, status: 'scheduled',
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
};

beforeEach(() => {
  mock.db.cases = [tbCase() as unknown as Record<string, unknown>];
  mock.db.patients = [patient as unknown as Record<string, unknown>];
  mock.db.followups = [followup as unknown as Record<string, unknown>];
  mock.db.appointments = [appointment as unknown as Record<string, unknown>];
  mock.db.loadError = null;
  mock.db.rpcError = null;
  mock.db.rpcCalls = [];
});

describe('CaseRegistry', () => {
  it('shows facility-visible cases with visit and appointment context', async () => {
    render(<CaseRegistry />);
    expect(await screen.findAllByText('TBC-MLB-2026-00001')).toHaveLength(2);
    expect(screen.getAllByText('Juan Dela Cruz')).toHaveLength(2);
    expect(screen.getAllByText('Patient attended.')).toHaveLength(2);
    expect(screen.getAllByText(new Date('2099-09-20T00:00:00').toLocaleDateString())).toHaveLength(2);
  });

  it('starts treatment through the audited lifecycle RPC', async () => {
    render(<CaseRegistry />);
    await screen.findByText(en.cases.startTreatment);
    fireEvent.change(screen.getByLabelText(en.cases.startDate), { target: { value: '2026-09-05' } });
    fireEvent.click(screen.getByRole('button', { name: en.cases.startTreatment }));

    await waitFor(() => expect(mock.db.rpcCalls).toHaveLength(1));
    expect(mock.db.rpcCalls[0]).toEqual(['set_tb_case_status', expect.objectContaining({
      p_case_id: 'case-1', p_new_status: 'on_treatment', p_treatment_start_date: '2026-09-05',
    })]);
  });

  it('closes treatment only with the chosen national outcome and date', async () => {
    mock.db.cases = [tbCase({ case_status: 'on_treatment', treatment_start_date: '2026-09-02' }) as unknown as Record<string, unknown>];
    render(<CaseRegistry />);
    await screen.findByRole('button', { name: en.cases.closeCase });
    fireEvent.change(screen.getByLabelText(en.cases.outcomeLabel), { target: { value: 'treatment_completed' } });
    fireEvent.change(screen.getByLabelText(en.cases.outcomeDate), { target: { value: '2026-09-10' } });
    fireEvent.click(screen.getByRole('button', { name: en.cases.closeCase }));

    await waitFor(() => expect(mock.db.rpcCalls).toHaveLength(1));
    expect(mock.db.rpcCalls[0][1]).toMatchObject({
      p_new_status: 'closed', p_outcome: 'treatment_completed', p_outcome_date: '2026-09-10',
    });
  });

  it('surfaces registry load failures with a retry action', async () => {
    mock.db.loadError = { message: 'network unavailable' };
    render(<CaseRegistry />);
    expect((await screen.findByRole('alert')).textContent).toContain(en.cases.loadError);
    expect(screen.getByRole('button', { name: en.inbox.retry })).toBeTruthy();
  });

  it('keeps the detail pane within the selected lifecycle filter', async () => {
    mock.db.cases = [
      tbCase() as unknown as Record<string, unknown>,
      tbCase({
        case_id: 'case-2',
        case_number: 'TBC-MLB-2026-00002',
        case_status: 'closed',
        outcome: 'cured',
        outcome_date: '2026-09-09',
      }) as unknown as Record<string, unknown>,
    ];
    render(<CaseRegistry />);
    await screen.findAllByText('TBC-MLB-2026-00001');
    fireEvent.change(screen.getByLabelText(en.cases.filter), { target: { value: 'closed' } });

    expect(screen.queryByText('TBC-MLB-2026-00001')).toBeNull();
    expect(screen.getAllByText('TBC-MLB-2026-00002')).toHaveLength(2);
  });
});
