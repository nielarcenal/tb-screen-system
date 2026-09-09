import { afterEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  runAsync: vi.fn(),
  getFirstAsync: vi.fn(),
  getAllAsync: vi.fn(),
}));

vi.mock('./database', () => ({ getDb: () => Promise.resolve(mock) }));
vi.mock('../lib/uuid', () => ({ nowIso: () => '2026-09-10T00:00:00.000Z' }));

import {
  insertLocalAppointment,
  listAppointmentsForPatient,
  upsertPulledAppointment,
} from './appointmentsRepo';
import type { AppointmentRow } from './types';

afterEach(() => vi.clearAllMocks());

const serverRow: AppointmentRow = {
  appointment_id: 'appt-1',
  patient_id: 'patient-1',
  facility_id: 'facility-1',
  referral_id: 'referral-1',
  scheduled_date: '2026-09-20',
  attended_date: null,
  status: 'scheduled',
  created_at: '2026-09-10T00:00:00.000Z',
  updated_at: '2026-09-10T00:00:00.000Z',
};

describe('appointment ownership persistence', () => {
  it('writes facility and referral on a new offline appointment', async () => {
    await insertLocalAppointment({
      appointment_id: serverRow.appointment_id,
      patient_id: serverRow.patient_id,
      facility_id: serverRow.facility_id,
      referral_id: serverRow.referral_id,
      scheduled_date: serverRow.scheduled_date,
      attended_date: null,
      status: 'scheduled',
    });
    const [sql, args] = mock.runAsync.mock.calls[0];
    expect(sql).toContain('facility_id, referral_id');
    expect(args.slice(0, 4)).toEqual(['appt-1', 'patient-1', 'facility-1', 'referral-1']);
  });

  it('maps pulled ownership and the cancelled status out of SQLite', async () => {
    mock.getAllAsync.mockResolvedValue([{ ...serverRow, status: 'cancelled', sync_status: 'synced' }]);
    const rows = await listAppointmentsForPatient('patient-1');
    expect(rows[0]).toMatchObject({
      facility_id: 'facility-1',
      referral_id: 'referral-1',
      status: 'cancelled',
    });
  });

  it('updates both ownership columns during a newer server pull', async () => {
    mock.getFirstAsync.mockResolvedValue(null);
    await upsertPulledAppointment(serverRow);
    const [sql, args] = mock.runAsync.mock.calls[0];
    expect(sql).toContain('facility_id    = excluded.facility_id');
    expect(sql).toContain('referral_id    = excluded.referral_id');
    expect(args.slice(0, 4)).toEqual(['appt-1', 'patient-1', 'facility-1', 'referral-1']);
  });
});
