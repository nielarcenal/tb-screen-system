/**
 * On-device SQLite cache (expo-sqlite, async API — verified against Expo v57).
 *
 * This is the offline source of truth for the app (§7). It mirrors the server
 * schema, but every syncable row additionally carries a local `sync_status`
 * (pending|synced) that never leaves the device.
 *
 * SCOPE (Feature 2): only the `patients` table is wired through sync, per §7
 * ("prove the sync skeleton on the patients table alone"). A tiny migration
 * runner (via PRAGMA user_version) lets each later feature add its own table
 * without dead, unused tables sitting here now.
 */
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'tbscreen.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Ordered migrations. Index + 1 === the schema version each one brings us to.
 * Never edit a shipped migration; append a new one.
 */
const MIGRATIONS: string[] = [
  // v1 — patients cache + sync cursor (Feature 2)
  `
  CREATE TABLE IF NOT EXISTS patients (
    patient_id     TEXT PRIMARY KEY NOT NULL,
    display_code   TEXT NOT NULL UNIQUE,
    enrolled_by    TEXT NOT NULL,
    age            INTEGER NOT NULL,
    sex            TEXT NOT NULL,
    barangay_code  TEXT NOT NULL,
    sitio          TEXT,
    contact_number TEXT,
    sms_consent    INTEGER NOT NULL DEFAULT 0,  -- 0/1 boolean
    consent_date   TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    -- local-only; drives the write queue. Never synced to the server.
    sync_status    TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE INDEX IF NOT EXISTS patients_sync_status_idx ON patients(sync_status);

  -- One row per synced table: the high-water mark for incremental pulls (§7).
  CREATE TABLE IF NOT EXISTS sync_meta (
    table_name   TEXT PRIMARY KEY NOT NULL,
    last_pull_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'
  );
  INSERT OR IGNORE INTO sync_meta (table_name) VALUES ('patients');
  `,

  // v2 — offline PSGC reference tables (Feature 4, brief §6). Read-only; seeded
  // once from the bundled Bukidnon dataset (see seedPsgcIfEmpty below), never
  // synced. Mirrors the server ref_* tables.
  `
  CREATE TABLE IF NOT EXISTS ref_regions (
    region_code TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ref_provinces (
    province_code TEXT PRIMARY KEY NOT NULL,
    region_code   TEXT NOT NULL,
    name          TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ref_cities (
    city_code     TEXT PRIMARY KEY NOT NULL,
    province_code TEXT NOT NULL,
    name          TEXT NOT NULL,
    type          TEXT NOT NULL DEFAULT 'municipality'
  );
  CREATE TABLE IF NOT EXISTS ref_barangays (
    barangay_code TEXT PRIMARY KEY NOT NULL,
    city_code     TEXT NOT NULL,
    name          TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ref_cities_province_idx  ON ref_cities(province_code);
  CREATE INDEX IF NOT EXISTS ref_barangays_city_idx   ON ref_barangays(city_code);
  `,

  // v3 — screenings cache (Feature 5). Mirrors server screenings; symptom_flags
  // stored as a JSON string. NO score column by design (§5).
  `
  CREATE TABLE IF NOT EXISTS screenings (
    screening_id  TEXT PRIMARY KEY NOT NULL,
    patient_id    TEXT NOT NULL,
    symptom_flags TEXT NOT NULL DEFAULT '{}',
    pgis_severity TEXT,
    referred      INTEGER NOT NULL DEFAULT 0,  -- 0/1 boolean
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    sync_status   TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE INDEX IF NOT EXISTS screenings_patient_idx     ON screenings(patient_id);
  CREATE INDEX IF NOT EXISTS screenings_sync_status_idx ON screenings(sync_status);
  INSERT OR IGNORE INTO sync_meta (table_name) VALUES ('screenings');
  `,

  // v4 — Feature 6: referrals + appointments (two-way sync, same pattern) and a
  // PULL-ONLY facilities cache (seeded/administered server-side; the app never
  // writes facilities, so no sync_status column there).
  `
  CREATE TABLE IF NOT EXISTS facilities (
    facility_id TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    address     TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS referrals (
    referral_id  TEXT PRIMARY KEY NOT NULL,
    patient_id   TEXT NOT NULL,
    screening_id TEXT NOT NULL,
    facility_id  TEXT NOT NULL,
    specimen_id  TEXT,
    status       TEXT NOT NULL DEFAULT 'submitted',
    result       TEXT,
    result_date  TEXT,
    presented    INTEGER,             -- 0/1/NULL tri-state (NULL = unknown yet)
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    sync_status  TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE INDEX IF NOT EXISTS referrals_patient_idx     ON referrals(patient_id);
  CREATE INDEX IF NOT EXISTS referrals_screening_idx   ON referrals(screening_id);
  CREATE INDEX IF NOT EXISTS referrals_sync_status_idx ON referrals(sync_status);

  CREATE TABLE IF NOT EXISTS appointments (
    appointment_id TEXT PRIMARY KEY NOT NULL,
    patient_id     TEXT NOT NULL,
    scheduled_date TEXT NOT NULL,     -- date-only, YYYY-MM-DD
    attended_date  TEXT,
    status         TEXT NOT NULL DEFAULT 'scheduled',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    sync_status    TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE INDEX IF NOT EXISTS appointments_patient_idx     ON appointments(patient_id);
  CREATE INDEX IF NOT EXISTS appointments_sync_status_idx ON appointments(sync_status);

  INSERT OR IGNORE INTO sync_meta (table_name)
    VALUES ('facilities'), ('referrals'), ('appointments');
  `,
];

// Bundled PSGC dataset — Bukidnon only (documented delimitation, §6). Generated
// from the official PSA PSGC data; see supabase/seed_psgc_bukidnon.sql for the
// matching server seed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const psgc = require('../data/psgc-bukidnon.json') as {
  region: { code: string; name: string };
  province: { code: string; regionCode: string; name: string };
  cities: [string, string, string][]; // [code, name, type]
  barangays: [string, string, string][]; // [code, cityCode, name]
};

/** Seed the PSGC ref tables from the bundled JSON if they are empty (one-time). */
async function seedPsgcIfEmpty(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM ref_barangays');
  if ((row?.n ?? 0) > 0) return;

  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const stmts: string[] = [
    `INSERT OR IGNORE INTO ref_regions (region_code, name) VALUES (${q(psgc.region.code)}, ${q(psgc.region.name)});`,
    `INSERT OR IGNORE INTO ref_provinces (province_code, region_code, name) VALUES (${q(psgc.province.code)}, ${q(psgc.province.regionCode)}, ${q(psgc.province.name)});`,
  ];
  // Batched multi-row inserts (values come from our own bundled file, not users).
  const batch = <T>(arr: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };
  for (const chunk of batch(psgc.cities, 100)) {
    stmts.push(
      `INSERT OR IGNORE INTO ref_cities (city_code, province_code, name, type) VALUES ` +
        chunk.map(([code, name, type]) => `(${q(code)}, ${q(psgc.province.code)}, ${q(name)}, ${q(type)})`).join(',') +
        ';',
    );
  }
  for (const chunk of batch(psgc.barangays, 100)) {
    stmts.push(
      `INSERT OR IGNORE INTO ref_barangays (barangay_code, city_code, name) VALUES ` +
        chunk.map(([code, cityCode, name]) => `(${q(code)}, ${q(cityCode)}, ${q(name)})`).join(',') +
        ';',
    );
  }

  await db.execAsync('BEGIN');
  try {
    for (const s of stmts) await db.execAsync(s);
    await db.execAsync('COMMIT');
  } catch (e) {
    await db.execAsync('ROLLBACK');
    throw e;
  }
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  for (let version = current; version < MIGRATIONS.length; version++) {
    await db.execAsync('BEGIN');
    try {
      await db.execAsync(MIGRATIONS[version]);
      // PRAGMA user_version doesn't accept bound params; version is our own int.
      await db.execAsync(`PRAGMA user_version = ${version + 1}`);
      await db.execAsync('COMMIT');
    } catch (e) {
      await db.execAsync('ROLLBACK');
      throw e;
    }
  }
}

/** Opens (once) and migrates the local database, returning the shared handle. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      await migrate(db);
      await seedPsgcIfEmpty(db);
      return db;
    })();
  }
  return dbPromise;
}
