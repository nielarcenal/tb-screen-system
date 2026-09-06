/**
 * Local (offline) CRUD for referrals — same §7 pattern as patients/screenings:
 * local writes queue as sync_status='pending'; the sync engine pushes them and
 * pulls server changes (status/outcome/no-show updates recorded by TB-DOTS staff)
 * with last-write-wins.
 */
import { getDb } from './database';
import { ReferralRow, ReferralStatus, ResultOutcome, SyncStatus } from './types';
import { nowIso } from '../lib/uuid';

export type LocalReferralRow = ReferralRow & { sync_status: SyncStatus };

/** Raw sqlite shape (`presented` is 0/1/NULL). */
interface ReferralSqlRow {
  referral_id: string;
  patient_id: string;
  screening_id: string;
  facility_id: string;
  lab_sample_id: string | null;
  status: string;
  result_outcome: string | null;
  result_date: string | null;
  presented: number | null;
  created_at: string;
  updated_at: string;
  sync_status: string;
}

function fromSql(r: ReferralSqlRow): LocalReferralRow {
  return {
    referral_id: r.referral_id,
    patient_id: r.patient_id,
    screening_id: r.screening_id,
    facility_id: r.facility_id,
    lab_sample_id: r.lab_sample_id,
    status: r.status as ReferralStatus,
    result_outcome: r.result_outcome as ResultOutcome | null,
    result_date: r.result_date,
    presented: r.presented === null ? null : r.presented === 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
    sync_status: r.sync_status as SyncStatus,
  };
}

/**
 * Insert a locally-created referral.
 *
 * `lab_sample_id` is NOT a parameter, and is written as NULL. Sputum is
 * collected only at the TB-DOTS facility (0024), so there is no sample for a
 * BHW to name at referral time — the facility enters the id when it collects
 * the sample on-site. This app only ever reads that column, on a pull.
 */
export async function insertLocalReferral(
  r: Omit<ReferralRow, 'created_at' | 'updated_at' | 'lab_sample_id'>,
): Promise<void> {
  const db = await getDb();
  const ts = nowIso();
  await db.runAsync(
    `INSERT INTO referrals
       (referral_id, patient_id, screening_id, facility_id, lab_sample_id,
        status, result_outcome, result_date, presented, created_at, updated_at, sync_status)
     VALUES (?,?,?,?,NULL,?,?,?,?,?,?, 'pending')`,
    [
      r.referral_id,
      r.patient_id,
      r.screening_id,
      r.facility_id,
      r.status,
      r.result_outcome,
      r.result_date,
      r.presented === null ? null : r.presented ? 1 : 0,
      ts,
      ts,
    ],
  );
}

export async function getReferral(referralId: string): Promise<LocalReferralRow | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ReferralSqlRow>(
    'SELECT * FROM referrals WHERE referral_id = ?',
    [referralId],
  );
  return row ? fromSql(row) : null;
}

/** The referral created from a given screening, if any (one per screening). */
export async function getReferralForScreening(
  screeningId: string,
): Promise<LocalReferralRow | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ReferralSqlRow>(
    'SELECT * FROM referrals WHERE screening_id = ? ORDER BY created_at DESC',
    [screeningId],
  );
  return row ? fromSql(row) : null;
}

export async function getPendingReferrals(): Promise<LocalReferralRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ReferralSqlRow>(
    "SELECT * FROM referrals WHERE sync_status = 'pending'",
  );
  return rows.map(fromSql);
}

export async function markReferralSynced(referralId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE referrals SET sync_status = 'synced' WHERE referral_id = ?",
    [referralId],
  );
}

/** Pull-side upsert with last-write-wins (same policy as patientsRepo). */
export async function upsertPulledReferral(server: ReferralRow): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<ReferralSqlRow>(
    'SELECT * FROM referrals WHERE referral_id = ?',
    [server.referral_id],
  );

  if (
    existing &&
    existing.sync_status === 'pending' &&
    new Date(existing.updated_at).getTime() >= new Date(server.updated_at).getTime()
  ) {
    return; // local unpushed edit is newer — keep it
  }

  await db.runAsync(
    `INSERT INTO referrals
       (referral_id, patient_id, screening_id, facility_id, lab_sample_id,
        status, result_outcome, result_date, presented, created_at, updated_at, sync_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'synced')
     ON CONFLICT(referral_id) DO UPDATE SET
       patient_id    = excluded.patient_id,
       screening_id  = excluded.screening_id,
       facility_id   = excluded.facility_id,
       lab_sample_id = excluded.lab_sample_id,
       status         = excluded.status,
       result_outcome = excluded.result_outcome,
       result_date    = excluded.result_date,
       presented      = excluded.presented,
       created_at     = excluded.created_at,
       updated_at     = excluded.updated_at,
       sync_status    = 'synced'`,
    [
      server.referral_id,
      server.patient_id,
      server.screening_id,
      server.facility_id,
      server.lab_sample_id,
      server.status,
      server.result_outcome,
      server.result_date,
      server.presented === null ? null : server.presented ? 1 : 0,
      server.created_at,
      server.updated_at,
    ],
  );
}
