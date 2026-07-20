/**
 * Local (offline) CRUD for patients. All app reads/writes go through here; the
 * sync engine (sync/syncEngine.ts) is the ONLY thing that talks to the server.
 *
 * Writing locally always sets sync_status = 'pending' and bumps updated_at, so
 * the row is queued for the next push (§7).
 */
import { getDb } from './database';
import { LocalPatientRow, PatientRow, SyncStatus } from './types';
import { nowIso } from '../lib/uuid';

/** Raw sqlite shape (booleans stored as 0/1 integers). */
interface PatientSqlRow {
  patient_id: string;
  display_code: string;
  enrolled_by: string;
  full_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  birthdate: string | null;
  age: number;
  sex: string;
  barangay_code: string;
  sitio: string | null;
  contact_number: string | null;
  sms_consent: number;
  consent_date: string | null;
  created_at: string;
  updated_at: string;
  sync_status: string;
}

function fromSql(r: PatientSqlRow): LocalPatientRow {
  return {
    patient_id: r.patient_id,
    display_code: r.display_code,
    enrolled_by: r.enrolled_by,
    full_name: r.full_name,
    first_name: r.first_name,
    middle_name: r.middle_name,
    last_name: r.last_name,
    birthdate: r.birthdate,
    age: r.age,
    sex: r.sex as LocalPatientRow['sex'],
    barangay_code: r.barangay_code,
    sitio: r.sitio,
    contact_number: r.contact_number,
    sms_consent: r.sms_consent === 1,
    consent_date: r.consent_date,
    created_at: r.created_at,
    updated_at: r.updated_at,
    sync_status: r.sync_status as SyncStatus,
  };
}

/**
 * Insert a locally-created patient. Marks it pending for push.
 * Caller supplies patient_id/display_code (generated on-device) and enrolled_by
 * (must equal the signed-in user's id to satisfy the server RLS insert policy).
 */
export async function insertLocalPatient(
  p: Omit<PatientRow, 'created_at' | 'updated_at'>,
): Promise<void> {
  const db = await getDb();
  const ts = nowIso();
  await db.runAsync(
    `INSERT INTO patients
       (patient_id, display_code, enrolled_by, full_name, first_name, middle_name,
        last_name, birthdate, age, sex,
        barangay_code, sitio, contact_number, sms_consent, consent_date,
        created_at, updated_at, sync_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending')`,
    [
      p.patient_id,
      p.display_code,
      p.enrolled_by,
      p.full_name,
      p.first_name,
      p.middle_name,
      p.last_name,
      p.birthdate,
      p.age,
      p.sex,
      p.barangay_code,
      p.sitio,
      p.contact_number,
      p.sms_consent ? 1 : 0,
      p.consent_date,
      ts,
      ts,
    ],
  );
}

/**
 * Update the editable fields (design screen 9 "Edit details" + SMS opt-in).
 * Marks the row pending and bumps updated_at so the change pushes on the next
 * sync (server RLS: patients_bhw_update).
 *
 * PRIVACY (§4, patients_sms_consent_gate CHECK): contact_number and
 * consent_date exist ONLY while sms_consent is true — callers pass them
 * already normalized (null/null when opting out).
 */
export async function updateLocalPatientDetails(
  patientId: string,
  fields: {
    full_name: string;
    first_name: string;
    middle_name: string | null;
    last_name: string;
    birthdate: string | null;
    age: number;
    sex: string;
    sms_consent: boolean;
    contact_number: string | null;
    consent_date: string | null;
  },
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE patients
     SET full_name = ?, first_name = ?, middle_name = ?, last_name = ?,
         birthdate = ?, age = ?, sex = ?,
         sms_consent = ?, contact_number = ?, consent_date = ?,
         updated_at = ?, sync_status = 'pending'
     WHERE patient_id = ?`,
    [
      fields.full_name,
      fields.first_name,
      fields.middle_name,
      fields.last_name,
      fields.birthdate,
      fields.age,
      fields.sex,
      fields.sms_consent ? 1 : 0,
      fields.contact_number,
      fields.consent_date,
      nowIso(),
      patientId,
    ],
  );
}

/** One locally-cached patient, or null if the id is unknown on this device. */
export async function getLocalPatient(patientId: string): Promise<LocalPatientRow | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<PatientSqlRow>(
    'SELECT * FROM patients WHERE patient_id = ?',
    [patientId],
  );
  return row ? fromSql(row) : null;
}

/** All locally-cached patients, newest first (for the sync-test list). */
export async function listLocalPatients(): Promise<LocalPatientRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PatientSqlRow>(
    'SELECT * FROM patients ORDER BY created_at DESC',
  );
  return rows.map(fromSql);
}

/** Rows waiting to be pushed. */
export async function getPendingPatients(): Promise<LocalPatientRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PatientSqlRow>(
    "SELECT * FROM patients WHERE sync_status = 'pending'",
  );
  return rows.map(fromSql);
}

export async function markPatientSynced(patientId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE patients SET sync_status = 'synced' WHERE patient_id = ?", [
    patientId,
  ]);
}

/**
 * Upsert a server row into the local cache during pull, applying last-write-wins:
 * if we hold an unpushed (pending) local edit that is newer than the incoming
 * server row, we keep the local edit; otherwise the server row wins and is
 * marked synced. (Simple, explainable LWW — no CRDTs, per §7.)
 */
export async function upsertPulledPatient(server: PatientRow): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<PatientSqlRow>(
    'SELECT * FROM patients WHERE patient_id = ?',
    [server.patient_id],
  );

  if (
    existing &&
    existing.sync_status === 'pending' &&
    new Date(existing.updated_at).getTime() >= new Date(server.updated_at).getTime()
  ) {
    return; // local unpushed edit is newer — keep it
  }

  await db.runAsync(
    `INSERT INTO patients
       (patient_id, display_code, enrolled_by, full_name, first_name, middle_name,
        last_name, birthdate, age, sex,
        barangay_code, sitio, contact_number, sms_consent, consent_date,
        created_at, updated_at, sync_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'synced')
     ON CONFLICT(patient_id) DO UPDATE SET
       display_code   = excluded.display_code,
       enrolled_by    = excluded.enrolled_by,
       full_name      = excluded.full_name,
       first_name     = excluded.first_name,
       middle_name    = excluded.middle_name,
       last_name      = excluded.last_name,
       birthdate      = excluded.birthdate,
       age            = excluded.age,
       sex            = excluded.sex,
       barangay_code  = excluded.barangay_code,
       sitio          = excluded.sitio,
       contact_number = excluded.contact_number,
       sms_consent    = excluded.sms_consent,
       consent_date   = excluded.consent_date,
       created_at     = excluded.created_at,
       updated_at     = excluded.updated_at,
       sync_status    = 'synced'`,
    [
      server.patient_id,
      server.display_code,
      server.enrolled_by,
      server.full_name ?? null,
      server.first_name ?? null,
      server.middle_name ?? null,
      server.last_name ?? null,
      server.birthdate ?? null,
      server.age,
      server.sex,
      server.barangay_code,
      server.sitio,
      server.contact_number,
      server.sms_consent ? 1 : 0,
      server.consent_date,
      server.created_at,
      server.updated_at,
    ],
  );
}
