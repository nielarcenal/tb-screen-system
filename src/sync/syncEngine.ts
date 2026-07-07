/**
 * Offline-tolerant sync engine (§7).
 *
 * Strategy: push local pending rows, then pull server changes since our last
 * pull, resolving conflicts by per-record updated_at last-write-wins. Simple and
 * explainable on purpose — NO CRDTs.
 *
 * Feature 2 scope: wired for `patients` ONLY, to prove the skeleton end-to-end
 * before any other table rides on it. `syncPatients()` is the reference shape
 * every later table's sync will copy.
 *
 * Connectivity: this runs on demand (the sync-test button / later, app events).
 * If the device is offline the Supabase calls reject; we surface that and leave
 * pending rows queued for next time. Automatic on-reconnect triggering (NetInfo)
 * is deliberately deferred to keep Feature 2 minimal.
 */
import { supabase } from '../lib/supabase';
import { getDb } from '../db/database';
import {
  getPendingPatients,
  markPatientSynced,
  upsertPulledPatient,
} from '../db/patientsRepo';
import {
  getPendingScreenings,
  markScreeningSynced,
  upsertPulledScreening,
} from '../db/screeningsRepo';
import {
  getPendingReferrals,
  markReferralSynced,
  upsertPulledReferral,
} from '../db/referralsRepo';
import {
  getPendingAppointments,
  markAppointmentSynced,
  upsertPulledAppointment,
} from '../db/appointmentsRepo';
import { upsertPulledFacility } from '../db/facilitiesRepo';
import {
  AppointmentRow,
  FacilityRow,
  PatientRow,
  ReferralRow,
  ScreeningRow,
  SyncStatus,
} from '../db/types';

export interface SyncResult {
  pushed: number;
  pulled: number;
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

async function pushPatients(): Promise<number> {
  const pending = await getPendingPatients();
  let pushed = 0;
  for (const local of pending) {
    const { error } = await supabase
      .from('patients')
      .upsert(toServerPayload(local), { onConflict: 'patient_id' });
    if (error) {
      // Stop on first failure (e.g. offline / RLS) — row stays pending, retried
      // next sync. Throw so the caller can show it.
      throw new Error(`Push failed for ${local.display_code}: ${error.message}`);
    }
    await markPatientSynced(local.patient_id);
    pushed++;
  }
  return pushed;
}

async function pullPatients(): Promise<number> {
  const since = await getCursor('patients');
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .gt('updated_at', since)
    .order('updated_at', { ascending: true });

  if (error) throw new Error(`Pull failed: ${error.message}`);

  const rows = (data ?? []) as PatientRow[];
  let maxSeen = since;
  for (const server of rows) {
    await upsertPulledPatient(server);
    if (new Date(server.updated_at).getTime() > new Date(maxSeen).getTime()) {
      maxSeen = server.updated_at;
    }
  }
  // Advance the cursor to the newest row we actually received (robust to clock
  // skew — we never trust local "now" as the high-water mark).
  if (maxSeen !== since) await setCursor('patients', maxSeen);
  return rows.length;
}

/** Full patients sync: push queued local writes, then pull server changes. */
export async function syncPatients(): Promise<SyncResult> {
  const pushed = await pushPatients();
  const pulled = await pullPatients();
  return { pushed, pulled };
}

// ---------------------------------------------------------------------------
// screenings (Feature 5) — same pattern as patients.
// ---------------------------------------------------------------------------
async function pushScreenings(): Promise<number> {
  const pending = await getPendingScreenings();
  let pushed = 0;
  for (const local of pending) {
    const { error } = await supabase
      .from('screenings')
      .upsert(toServerPayload(local), { onConflict: 'screening_id' });
    if (error) {
      throw new Error(`Push failed for screening ${local.screening_id}: ${error.message}`);
    }
    await markScreeningSynced(local.screening_id);
    pushed++;
  }
  return pushed;
}

async function pullScreenings(): Promise<number> {
  const since = await getCursor('screenings');
  const { data, error } = await supabase
    .from('screenings')
    .select('*')
    .gt('updated_at', since)
    .order('updated_at', { ascending: true });

  if (error) throw new Error(`Pull failed (screenings): ${error.message}`);

  const rows = (data ?? []) as ScreeningRow[];
  let maxSeen = since;
  for (const server of rows) {
    await upsertPulledScreening(server);
    if (new Date(server.updated_at).getTime() > new Date(maxSeen).getTime()) {
      maxSeen = server.updated_at;
    }
  }
  if (maxSeen !== since) await setCursor('screenings', maxSeen);
  return rows.length;
}

// ---------------------------------------------------------------------------
// facilities (Feature 6) — PULL-ONLY. Facilities are seeded/administered on the
// server; the app never pushes them.
// ---------------------------------------------------------------------------
async function pullFacilities(): Promise<number> {
  const since = await getCursor('facilities');
  const { data, error } = await supabase
    .from('facilities')
    .select('*')
    .gt('updated_at', since)
    .order('updated_at', { ascending: true });

  if (error) throw new Error(`Pull failed (facilities): ${error.message}`);

  const rows = (data ?? []) as FacilityRow[];
  let maxSeen = since;
  for (const server of rows) {
    await upsertPulledFacility(server);
    if (new Date(server.updated_at).getTime() > new Date(maxSeen).getTime()) {
      maxSeen = server.updated_at;
    }
  }
  if (maxSeen !== since) await setCursor('facilities', maxSeen);
  return rows.length;
}

// ---------------------------------------------------------------------------
// referrals (Feature 6) — same pattern as patients.
// ---------------------------------------------------------------------------
async function pushReferrals(): Promise<number> {
  const pending = await getPendingReferrals();
  let pushed = 0;
  for (const local of pending) {
    const { error } = await supabase
      .from('referrals')
      .upsert(toServerPayload(local), { onConflict: 'referral_id' });
    if (error) {
      throw new Error(`Push failed for referral ${local.referral_id}: ${error.message}`);
    }
    await markReferralSynced(local.referral_id);
    pushed++;
  }
  return pushed;
}

async function pullReferrals(): Promise<number> {
  const since = await getCursor('referrals');
  const { data, error } = await supabase
    .from('referrals')
    .select('*')
    .gt('updated_at', since)
    .order('updated_at', { ascending: true });

  if (error) throw new Error(`Pull failed (referrals): ${error.message}`);

  const rows = (data ?? []) as ReferralRow[];
  let maxSeen = since;
  for (const server of rows) {
    await upsertPulledReferral(server);
    if (new Date(server.updated_at).getTime() > new Date(maxSeen).getTime()) {
      maxSeen = server.updated_at;
    }
  }
  if (maxSeen !== since) await setCursor('referrals', maxSeen);
  return rows.length;
}

// ---------------------------------------------------------------------------
// appointments (Feature 6) — same pattern as patients.
// ---------------------------------------------------------------------------
async function pushAppointments(): Promise<number> {
  const pending = await getPendingAppointments();
  let pushed = 0;
  for (const local of pending) {
    const { error } = await supabase
      .from('appointments')
      .upsert(toServerPayload(local), { onConflict: 'appointment_id' });
    if (error) {
      throw new Error(`Push failed for appointment ${local.appointment_id}: ${error.message}`);
    }
    await markAppointmentSynced(local.appointment_id);
    pushed++;
  }
  return pushed;
}

async function pullAppointments(): Promise<number> {
  const since = await getCursor('appointments');
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .gt('updated_at', since)
    .order('updated_at', { ascending: true });

  if (error) throw new Error(`Pull failed (appointments): ${error.message}`);

  const rows = (data ?? []) as AppointmentRow[];
  let maxSeen = since;
  for (const server of rows) {
    await upsertPulledAppointment(server);
    if (new Date(server.updated_at).getTime() > new Date(maxSeen).getTime()) {
      maxSeen = server.updated_at;
    }
  }
  if (maxSeen !== since) await setCursor('appointments', maxSeen);
  return rows.length;
}

/**
 * Sync everything, parents before children (a row must exist on the server
 * before rows referencing it arrive — FK order): facilities are pulled first
 * (referrals reference them), then patients → screenings → referrals →
 * appointments.
 */
export async function syncAll(): Promise<SyncResult> {
  const fPulled = await pullFacilities();
  const p = await syncPatients();
  const sPushed = await pushScreenings();
  const sPulled = await pullScreenings();
  const rPushed = await pushReferrals();
  const rPulled = await pullReferrals();
  const aPushed = await pushAppointments();
  const aPulled = await pullAppointments();
  return {
    pushed: p.pushed + sPushed + rPushed + aPushed,
    pulled: fPulled + p.pulled + sPulled + rPulled + aPulled,
  };
}
