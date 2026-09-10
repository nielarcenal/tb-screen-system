import { describe, expect, it } from 'vitest';

import { buildCaseRegistry, caseMatchesFilter } from './caseRegistry';
import type {
  AppointmentRow,
  PatientRow,
  TbCaseRow,
  TreatmentFollowupRow,
} from './types';

const patient: PatientRow = {
  patient_id: 'patient-1',
  display_code: 'MLB-0001',
  enrolled_by: 'bhw-1',
  full_name: 'Juan Dela Cruz',
  first_name: 'Juan',
  middle_name: null,
  last_name: 'Dela Cruz',
  birthdate: '1990-01-01',
  age: 36,
  sex: 'male',
  barangay_code: '101301001',
  sitio: null,
  contact_number: null,
  sms_consent: false,
  consent_date: null,
  preferred_language: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const tbCase = (over: Partial<TbCaseRow> = {}): TbCaseRow => ({
  case_id: 'case-1',
  patient_id: patient.patient_id,
  referral_id: 'ref-1',
  facility_id: 'fac-1',
  case_number: 'TBC-MLB-2026-00001',
  registration_date: '2026-09-01',
  case_status: 'on_treatment',
  treatment_start_date: '2026-09-02',
  outcome: null,
  outcome_date: null,
  created_by: 'staff-1',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...over,
});

const followup = (id: string, date: string, over: Partial<TreatmentFollowupRow> = {}): TreatmentFollowupRow => ({
  followup_id: id,
  case_id: 'case-1',
  appointment_id: null,
  visit_date: date,
  notes: null,
  recorded_by: 'staff-1',
  voided_at: null,
  voided_by: null,
  void_reason: null,
  created_at: `${date}T00:00:00Z`,
  updated_at: `${date}T00:00:00Z`,
  ...over,
});

const appointment = (id: string, date: string, status: AppointmentRow['status']): AppointmentRow => ({
  appointment_id: id,
  patient_id: patient.patient_id,
  facility_id: 'fac-1',
  referral_id: null,
  tb_case_id: 'case-1',
  scheduled_date: date,
  attended_date: status === 'attended' ? date : null,
  status,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
});

describe('buildCaseRegistry', () => {
  it('keeps voided history but uses only live visits for the latest date', () => {
    const items = buildCaseRegistry(
      [tbCase()],
      [patient],
      [followup('live', '2026-09-08'), followup('void', '2026-09-09', { voided_at: '2026-09-10T00:00:00Z' })],
      [],
      '2026-09-10',
    );
    expect(items[0].followups).toHaveLength(2);
    expect(items[0].latestFollowup?.followup_id).toBe('live');
  });

  it('derives next appointment and factual missed attention without scoring', () => {
    const items = buildCaseRegistry(
      [tbCase()],
      [patient],
      [],
      [appointment('missed', '2026-09-08', 'missed'), appointment('next', '2026-09-12', 'scheduled')],
      '2026-09-10',
    );
    expect(items[0].nextAppointment?.appointment_id).toBe('next');
    expect(items[0].attention).toBe('missed');
    expect(caseMatchesFilter(items[0], 'missed', '2026-09-10')).toBe(true);
  });

  it('treats a scheduled visit on or before today as due', () => {
    const [item] = buildCaseRegistry(
      [tbCase()],
      [patient],
      [],
      [appointment('due', '2026-09-10', 'scheduled')],
      '2026-09-10',
    );
    expect(item.attention).toBe('due');
    expect(caseMatchesFilter(item, 'followup_due', '2026-09-10')).toBe(true);
  });

  it('keeps active and closed filters tied to lifecycle state', () => {
    const [active, closed] = buildCaseRegistry(
      [tbCase(), tbCase({ case_id: 'case-2', case_status: 'closed', outcome: 'cured', outcome_date: '2026-09-09' })],
      [patient],
      [],
      [],
      '2026-09-10',
    );
    expect(caseMatchesFilter(active, 'active', '2026-09-10')).toBe(true);
    expect(caseMatchesFilter(closed, 'active', '2026-09-10')).toBe(false);
    expect(caseMatchesFilter(closed, 'closed', '2026-09-10')).toBe(true);
  });
});
