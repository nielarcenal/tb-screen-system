/**
 * Local (offline) CRUD for appointments — same §7 pattern as the other synced
 * tables. scheduled_date / attended_date are date-only strings (YYYY-MM-DD).
 */
import { getDb } from './database';
import { AppointmentRow, AppointmentStatus, SyncStatus } from './types';
import { nowIso } from '../lib/uuid';

export type LocalAppointmentRow = AppointmentRow & { sync_status: SyncStatus };

interface AppointmentSqlRow {
  appointment_id: string;
  patient_id: string;
  facility_id: string | null;
  referral_id: string | null;
  scheduled_date: string;
  attended_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  sync_status: string;
}

function fromSql(r: AppointmentSqlRow): LocalAppointmentRow {
  return {
    appointment_id: r.appointment_id,
    patient_id: r.patient_id,
    facility_id: r.facility_id,
    referral_id: r.referral_id,
    scheduled_date: r.scheduled_date,
    attended_date: r.attended_date,
    status: r.status as AppointmentStatus,
    created_at: r.created_at,
    updated_at: r.updated_at,
    sync_status: r.sync_status as SyncStatus,
  };
}

export async function insertLocalAppointment(
  a: Omit<AppointmentRow, 'created_at' | 'updated_at'>,
): Promise<void> {
  const db = await getDb();
  const ts = nowIso();
  await db.runAsync(
    `INSERT INTO appointments
       (appointment_id, patient_id, facility_id, referral_id,
        scheduled_date, attended_date, status, created_at, updated_at, sync_status)
     VALUES (?,?,?,?,?,?,?,?,?, 'pending')`,
    [a.appointment_id, a.patient_id, a.facility_id, a.referral_id,
     a.scheduled_date, a.attended_date, a.status, ts, ts],
  );
}

export async function listAppointmentsForPatient(
  patientId: string,
): Promise<LocalAppointmentRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<AppointmentSqlRow>(
    'SELECT * FROM appointments WHERE patient_id = ? ORDER BY scheduled_date DESC',
    [patientId],
  );
  return rows.map(fromSql);
}

export async function getPendingAppointments(): Promise<LocalAppointmentRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<AppointmentSqlRow>(
    "SELECT * FROM appointments WHERE sync_status = 'pending'",
  );
  return rows.map(fromSql);
}

export async function markAppointmentSynced(appointmentId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE appointments SET sync_status = 'synced' WHERE appointment_id = ?",
    [appointmentId],
  );
}

/** Pull-side upsert with last-write-wins (same policy as patientsRepo). */
export async function upsertPulledAppointment(server: AppointmentRow): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<AppointmentSqlRow>(
    'SELECT * FROM appointments WHERE appointment_id = ?',
    [server.appointment_id],
  );

  if (
    existing &&
    existing.sync_status === 'pending' &&
    new Date(existing.updated_at).getTime() >= new Date(server.updated_at).getTime()
  ) {
    return; // local unpushed edit is newer — keep it
  }

  await db.runAsync(
    `INSERT INTO appointments
       (appointment_id, patient_id, facility_id, referral_id,
        scheduled_date, attended_date, status, created_at, updated_at, sync_status)
     VALUES (?,?,?,?,?,?,?,?,?, 'synced')
     ON CONFLICT(appointment_id) DO UPDATE SET
       patient_id     = excluded.patient_id,
       facility_id    = excluded.facility_id,
       referral_id    = excluded.referral_id,
       scheduled_date = excluded.scheduled_date,
       attended_date  = excluded.attended_date,
       status         = excluded.status,
       created_at     = excluded.created_at,
       updated_at     = excluded.updated_at,
       sync_status    = 'synced'`,
    [
      server.appointment_id,
      server.patient_id,
      server.facility_id,
      server.referral_id,
      server.scheduled_date,
      server.attended_date,
      server.status,
      server.created_at,
      server.updated_at,
    ],
  );
}
