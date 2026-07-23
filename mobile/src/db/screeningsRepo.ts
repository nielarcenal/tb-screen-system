/**
 * Local (offline) CRUD for screenings — same shape as patientsRepo (§7 pattern):
 * local writes are queued as sync_status='pending'; the sync engine pushes them
 * and pulls server changes with last-write-wins.
 *
 * symptom_flags is stored as a JSON string locally and as jsonb on the server.
 */
import { getDb } from './database';
import { PgisSeverity, ScreeningRow, SymptomFlags, SyncStatus } from './types';
import { nowIso } from '../lib/uuid';

export type LocalScreeningRow = ScreeningRow & { sync_status: SyncStatus };

interface ScreeningSqlRow {
  screening_id: string;
  patient_id: string;
  symptom_flags: string;
  pgis_severity: string | null;
  referred: number;
  created_at: string;
  updated_at: string;
  sync_status: string;
}

function fromSql(r: ScreeningSqlRow): LocalScreeningRow {
  return {
    screening_id: r.screening_id,
    patient_id: r.patient_id,
    symptom_flags: JSON.parse(r.symptom_flags) as SymptomFlags,
    pgis_severity: r.pgis_severity as PgisSeverity | null,
    referred: r.referred === 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
    sync_status: r.sync_status as SyncStatus,
  };
}

export async function insertLocalScreening(
  s: Omit<ScreeningRow, 'created_at' | 'updated_at'>,
): Promise<void> {
  const db = await getDb();
  const ts = nowIso();
  await db.runAsync(
    `INSERT INTO screenings
       (screening_id, patient_id, symptom_flags, pgis_severity, referred,
        created_at, updated_at, sync_status)
     VALUES (?,?,?,?,?,?,?, 'pending')`,
    [
      s.screening_id,
      s.patient_id,
      JSON.stringify(s.symptom_flags),
      s.pgis_severity,
      s.referred ? 1 : 0,
      ts,
      ts,
    ],
  );
}

export async function getScreening(screeningId: string): Promise<LocalScreeningRow | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ScreeningSqlRow>(
    'SELECT * FROM screenings WHERE screening_id = ?',
    [screeningId],
  );
  return row ? fromSql(row) : null;
}

export async function listScreeningsForPatient(
  patientId: string,
): Promise<LocalScreeningRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ScreeningSqlRow>(
    'SELECT * FROM screenings WHERE patient_id = ? ORDER BY created_at DESC',
    [patientId],
  );
  return rows.map(fromSql);
}

export async function getPendingScreenings(): Promise<LocalScreeningRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ScreeningSqlRow>(
    "SELECT * FROM screenings WHERE sync_status = 'pending'",
  );
  return rows.map(fromSql);
}

export async function markScreeningSynced(screeningId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE screenings SET sync_status = 'synced' WHERE screening_id = ?",
    [screeningId],
  );
}

/** Pull-side upsert with last-write-wins (same policy as patientsRepo). */
export async function upsertPulledScreening(server: ScreeningRow): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<ScreeningSqlRow>(
    'SELECT * FROM screenings WHERE screening_id = ?',
    [server.screening_id],
  );

  if (
    existing &&
    existing.sync_status === 'pending' &&
    new Date(existing.updated_at).getTime() >= new Date(server.updated_at).getTime()
  ) {
    return; // local unpushed edit is newer — keep it
  }

  await db.runAsync(
    `INSERT INTO screenings
       (screening_id, patient_id, symptom_flags, pgis_severity, referred,
        created_at, updated_at, sync_status)
     VALUES (?,?,?,?,?,?,?, 'synced')
     ON CONFLICT(screening_id) DO UPDATE SET
       patient_id    = excluded.patient_id,
       symptom_flags = excluded.symptom_flags,
       pgis_severity = excluded.pgis_severity,
       referred      = excluded.referred,
       created_at    = excluded.created_at,
       updated_at    = excluded.updated_at,
       sync_status   = 'synced'`,
    [
      server.screening_id,
      server.patient_id,
      JSON.stringify(server.symptom_flags),
      server.pgis_severity,
      server.referred ? 1 : 0,
      server.created_at,
      server.updated_at,
    ],
  );
}
