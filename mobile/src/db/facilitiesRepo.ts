/**
 * Local PULL-ONLY cache of facilities. Facilities are seeded/administered on
 * the server (no client writes, per the RLS), so rows here carry no
 * sync_status — the sync engine only ever pulls them down.
 *
 * Used by Feature 6: the BHW picks the receiving TB-DOTS facility for a
 * referral, offline, from this cache.
 */
import { getDb } from './database';
import { FacilityRow } from './types';

export async function listTbDotsFacilities(): Promise<FacilityRow[]> {
  const db = await getDb();
  return db.getAllAsync<FacilityRow>(
    "SELECT * FROM facilities WHERE type = 'tb_dots' ORDER BY name",
  );
}

export async function getFacility(facilityId: string): Promise<FacilityRow | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<FacilityRow>(
    'SELECT * FROM facilities WHERE facility_id = ?',
    [facilityId],
  );
  return row ?? null;
}

/** Pull-side upsert. Server always wins — there are no local edits to protect. */
export async function upsertPulledFacility(server: FacilityRow): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO facilities (facility_id, name, type, address, created_at, updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(facility_id) DO UPDATE SET
       name       = excluded.name,
       type       = excluded.type,
       address    = excluded.address,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at`,
    [
      server.facility_id,
      server.name,
      server.type,
      server.address,
      server.created_at,
      server.updated_at,
    ],
  );
}
