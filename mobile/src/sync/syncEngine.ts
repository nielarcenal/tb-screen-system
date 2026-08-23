/**
 * Offline-tolerant sync engine (§7).
 *
 * Strategy: push local pending rows, then pull server changes since our last
 * pull, resolving conflicts by per-record updated_at last-write-wins. Simple and
 * explainable on purpose — NO CRDTs.
 *
 * FAILURE ISOLATION (D-10). Every push and pull is attempted independently. A
 * row the server permanently rejects is recorded in `failures`, left `pending`
 * so the next sync retries it, and the engine carries on with the next row and
 * the next table. Only a transient failure (offline, timeout, 5xx, expired
 * token) stops the pass, because nothing after it could succeed either — see
 * syncErrors.ts for that decision.
 *
 * This matters more than it looks: syncAll() runs tables in FK order with
 * appointments LAST, so before D-10 a single unpushable patient meant a BHW's
 * attendance records never reached the server again on any later sync.
 *
 * Nothing is ever abandoned. A permanently failing row keeps its `pending`
 * status and is retried every pass; it is reported, not dropped.
 *
 * Known noise: a row whose PARENT failed will fail its own FK check and be
 * reported too. That is correct but chatty — one bad patient can report a
 * screening and a referral alongside it. Skipping children would mean teaching
 * the engine the FK graph, which is not worth it while nothing is blocked.
 *
 * Connectivity: this runs on demand (sync button, reconnect, app-foreground).
 * If the device is offline the Supabase calls reject; we surface that and leave
 * pending rows queued for next time.
 */
import { supabase } from '../lib/supabase';
import { getDb } from '../db/database';
import {
  getPendingPatients,
  markPatientSynced,
  upsertPulledPatient,
} from '../db/patientsRepo';
import {
  LocalScreeningRow,
  getPendingScreenings,
  markScreeningSynced,
  upsertPulledScreening,
} from '../db/screeningsRepo';
import {
  LocalReferralRow,
  getPendingReferrals,
  markReferralSynced,
  upsertPulledReferral,
} from '../db/referralsRepo';
import {
  LocalAppointmentRow,
  getPendingAppointments,
  markAppointmentSynced,
  upsertPulledAppointment,
} from '../db/appointmentsRepo';
import { upsertPulledFacility } from '../db/facilitiesRepo';
import {
  AppointmentRow,
  FacilityRow,
  LocalPatientRow,
  PatientRow,
  ReferralRow,
  ScreeningRow,
  SyncStatus,
} from '../db/types';
import {
  SyncErrorLike,
  SyncFailure,
  TransientSyncError,
  isTransientError,
  runStep,
} from './syncErrors';

export interface SyncResult {
  pushed: number;
  pulled: number;
  /** Rows (or whole tables) the server refused. Empty on a clean pass. */
  failures: SyncFailure[];
}

/** Drop the local-only sync_status before sending a row to the server. */
function toServerPayload<T extends { sync_status: SyncStatus }>(local: T): Omit<T, 'sync_status'> {
  const { sync_status, ...serverRow } = local;
  return serverRow;
}

async function getCursor(table: string): Promise<string> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ last_pull_at: string }>(
    'SELECT last_pull_at FROM sync_meta WHERE table_name = ?',
    [table],
  );
  return row?.last_pull_at ?? '1970-01-01T00:00:00.000Z';
}

async function setCursor(table: string, iso: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE sync_meta SET last_pull_at = ? WHERE table_name = ?', [
    iso,
    table,
  ]);
}

// ---------------------------------------------------------------------------
// Generic push / pull. Every syncable table has the same shape, so it is
// described once here rather than copied per table — the four push loops and
// five pull loops this replaces were identical apart from their error strings.
// ---------------------------------------------------------------------------

interface PushSpec<T extends { sync_status: SyncStatus }> {
  /** Table name, for reporting only. */
  table: string;
  getPending: () => Promise<T[]>;
  /**
   * Upsert one row. Each spec makes its own call so the table name stays a
   * literal: supabase.from(someString) erases the generated row types and the
   * payload stops being checked at all, which is worse than the duplication.
   */
  send: (row: Omit<T, 'sync_status'>) => Promise<{ error: SyncErrorLike | null }>;
  markSynced: (id: string) => Promise<void>;
  idOf: (row: T) => string;
  /** What to call the row when reporting a failure — a display code where the
   *  table has one, so the message names something a person can recognise. */
  labelOf?: (row: T) => string;
}

/**
 * Push every pending row of one table. Returns how many landed, and appends any
 * permanently-rejected rows to `failures`. Throws TransientSyncError — pushing
 * nothing further — when retrying now cannot help.
 */
async function pushTable<T extends { sync_status: SyncStatus }>(
  spec: PushSpec<T>,
  failures: SyncFailure[],
): Promise<number> {
  const pending = await spec.getPending();
  let pushed = 0;
  for (const local of pending) {
    const { error } = await spec.send(toServerPayload(local));

    if (error) {
      const label = spec.labelOf?.(local) ?? spec.idOf(local);
      if (isTransientError(error)) {
        throw new TransientSyncError(`Push failed for ${label}: ${error.message}`);
      }
      // Permanent: this row will not be accepted as it stands. Record it, leave
      // it pending for the next pass, and keep going — the rows behind it, and
      // every later table, are almost certainly fine.
      failures.push({ table: spec.table, row: label, message: error.message });
      continue;
    }

    await spec.markSynced(spec.idOf(local));
    pushed++;
  }
  return pushed;
}

/**
 * Pull one table's changes since our cursor. A pull is a single request, so it
 * succeeds or fails as a whole; the caller records a permanent failure against
 * the table and moves on to the next one.
 */
async function pullTable<T extends { updated_at: string }>(
  table: string,
  upsertLocal: (row: T) => Promise<void>,
  /** Columns to request. Defaults to everything; pass an explicit list to keep
   *  a column off the device entirely — see REFERRAL_COLUMNS (D-05). */
  columns = '*',
): Promise<number> {
  const since = await getCursor(table);
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .gt('updated_at', since)
    .order('updated_at', { ascending: true });

  if (error) {
    const message = `Pull failed (${table}): ${error.message}`;
    throw isTransientError(error) ? new TransientSyncError(message) : new Error(message);
  }

  // `columns` is a runtime string, so supabase-js cannot infer the row shape and
  // falls back to GenericStringError[]. The caller names the real type.
  const rows = (data ?? []) as unknown as T[];
  let maxSeen = since;
  for (const server of rows) {
    await upsertLocal(server);
    if (new Date(server.updated_at).getTime() > new Date(maxSeen).getTime()) {
      maxSeen = server.updated_at;
    }
  }
  // Advance the cursor to the newest row we actually received (robust to clock
  // skew — we never trust local "now" as the high-water mark).
  if (maxSeen !== since) await setCursor(table, maxSeen);
  return rows.length;
}

// ---------------------------------------------------------------------------
// Table specs.
// ---------------------------------------------------------------------------

const PATIENTS_PUSH: PushSpec<LocalPatientRow> = {
  table: 'patients',
  getPending: getPendingPatients,
  send: async (row) => await supabase.from('patients').upsert(row, { onConflict: 'patient_id' }),
  markSynced: markPatientSynced,
  idOf: (r) => r.patient_id,
  labelOf: (r) => r.display_code,
};

const SCREENINGS_PUSH: PushSpec<LocalScreeningRow> = {
  table: 'screenings',
  getPending: getPendingScreenings,
  send: async (row) =>
    await supabase.from('screenings').upsert(row, { onConflict: 'screening_id' }),
  markSynced: markScreeningSynced,
  idOf: (r) => r.screening_id,
};

/**
 * Referrals are pulled by explicit column list, not `*`, so the server's
 * free-text `result` notes never reach the device at all (D-05). RLS cannot
 * restrict columns and a column GRANT cannot separate BHWs from TB-DOTS staff —
 * both authenticate as `authenticated` — so this is a client-side boundary, not
 * an enforced one. Do not "tidy" it back to `*`.
 */
const REFERRAL_COLUMNS =
  'referral_id, patient_id, screening_id, facility_id, specimen_id, status, ' +
  'result_outcome, result_date, presented, created_at, updated_at';

const REFERRALS_PUSH: PushSpec<LocalReferralRow> = {
  table: 'referrals',
  getPending: getPendingReferrals,
  send: async (row) => await supabase.from('referrals').upsert(row, { onConflict: 'referral_id' }),
  markSynced: markReferralSynced,
  idOf: (r) => r.referral_id,
};

const APPOINTMENTS_PUSH: PushSpec<LocalAppointmentRow> = {
  table: 'appointments',
  getPending: getPendingAppointments,
  send: async (row) =>
    await supabase.from('appointments').upsert(row, { onConflict: 'appointment_id' }),
  markSynced: markAppointmentSynced,
  idOf: (r) => r.appointment_id,
};

/**
 * Nearest-DOTS defaults (0009): ref_cities.default_facility_id lives on the
 * server (the bundled PSGC JSON predates it). Tiny table (22 LGUs) — pulled in
 * full every sync, no cursor.
 */
async function pullCityFacilityDefaults(): Promise<number> {
  const { data, error } = await supabase
    .from('ref_cities')
    .select('city_code, default_facility_id')
    .not('default_facility_id', 'is', null);

  if (error) {
    const message = `Pull failed (city defaults): ${error.message}`;
    throw isTransientError(error) ? new TransientSyncError(message) : new Error(message);
  }

  const rows = (data ?? []) as { city_code: string; default_facility_id: string }[];
  const db = await getDb();
  for (const row of rows) {
    await db.runAsync('UPDATE ref_cities SET default_facility_id = ? WHERE city_code = ?', [
      row.default_facility_id,
      row.city_code,
    ]);
  }
  return rows.length;
}

/**
 * Sync everything, parents before children (a row must exist on the server
 * before rows referencing it arrive — FK order): facilities are pulled first
 * (referrals reference them), then patients → screenings → referrals →
 * appointments.
 *
 * The order still matters for FK reasons, but a failure at any step no longer
 * cancels the steps after it (D-10).
 */
export async function syncAll(): Promise<SyncResult> {
  const failures: SyncFailure[] = [];
  let pushed = 0;
  let pulled = 0;

  pulled += await runStep('facilities', failures, () =>
    pullTable<FacilityRow>('facilities', upsertPulledFacility),
  );
  // Tiny; not counted in pushed/pulled.
  await runStep('ref_cities', failures, pullCityFacilityDefaults);

  pushed += await runStep('patients', failures, () => pushTable(PATIENTS_PUSH, failures));
  pulled += await runStep('patients', failures, () =>
    pullTable<PatientRow>('patients', upsertPulledPatient),
  );

  pushed += await runStep('screenings', failures, () => pushTable(SCREENINGS_PUSH, failures));
  pulled += await runStep('screenings', failures, () =>
    pullTable<ScreeningRow>('screenings', upsertPulledScreening),
  );

  pushed += await runStep('referrals', failures, () => pushTable(REFERRALS_PUSH, failures));
  pulled += await runStep('referrals', failures, () =>
    pullTable<ReferralRow>('referrals', upsertPulledReferral, REFERRAL_COLUMNS),
  );

  pushed += await runStep('appointments', failures, () => pushTable(APPOINTMENTS_PUSH, failures));
  pulled += await runStep('appointments', failures, () =>
    pullTable<AppointmentRow>('appointments', upsertPulledAppointment),
  );

  return { pushed, pulled, failures };
}
