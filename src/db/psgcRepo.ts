/**
 * Read-only queries over the offline PSGC reference tables (brief §6).
 * Feeds the cascading address dropdowns: Region → Province → City/Municipality
 * → Barangay, each filtered by its parent. Sitio is NOT here — it is free text
 * with no reference data and is never used for matching.
 */
import { getDb } from './database';

export interface PsgcOption {
  code: string;
  name: string;
}

export async function listRegions(): Promise<PsgcOption[]> {
  const db = await getDb();
  return db.getAllAsync<PsgcOption>(
    'SELECT region_code AS code, name FROM ref_regions ORDER BY name',
  );
}

export async function listProvinces(regionCode: string): Promise<PsgcOption[]> {
  const db = await getDb();
  return db.getAllAsync<PsgcOption>(
    'SELECT province_code AS code, name FROM ref_provinces WHERE region_code = ? ORDER BY name',
    [regionCode],
  );
}

export async function listCities(provinceCode: string): Promise<PsgcOption[]> {
  const db = await getDb();
  return db.getAllAsync<PsgcOption>(
    'SELECT city_code AS code, name FROM ref_cities WHERE province_code = ? ORDER BY name',
    [provinceCode],
  );
}

export async function listBarangays(cityCode: string): Promise<PsgcOption[]> {
  const db = await getDb();
  return db.getAllAsync<PsgcOption>(
    'SELECT barangay_code AS code, name FROM ref_barangays WHERE city_code = ? ORDER BY name',
    [cityCode],
  );
}

/**
 * The default (nearest) TB-DOTS facility for a barangay: its municipality's
 * assigned center (server migration 0009, pulled at sync). Null when the
 * mapping hasn't been pulled yet — the referral form then just shows no
 * pre-selection. A DEFAULT only; the BHW can always pick a different facility.
 */
export async function defaultFacilityForBarangay(barangayCode: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ fid: string | null }>(
    `SELECT c.default_facility_id AS fid
     FROM ref_barangays b JOIN ref_cities c ON c.city_code = b.city_code
     WHERE b.barangay_code = ?`,
    [barangayCode],
  );
  return row?.fid ?? null;
}

/** Human-readable "Barangay, City" label for a stored barangay_code. */
export async function barangayLabel(barangayCode: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ label: string }>(
    `SELECT b.name || ', ' || c.name AS label
     FROM ref_barangays b JOIN ref_cities c ON c.city_code = b.city_code
     WHERE b.barangay_code = ?`,
    [barangayCode],
  );
  return row?.label ?? null;
}

/** Resolve the full cascade selection for a barangay_code (for pre-filling). */
export async function cascadeForBarangay(
  barangayCode: string,
): Promise<{ regionCode: string; provinceCode: string; cityCode: string; barangayCode: string } | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    regionCode: string;
    provinceCode: string;
    cityCode: string;
  }>(
    `SELECT p.region_code AS regionCode, c.province_code AS provinceCode, b.city_code AS cityCode
     FROM ref_barangays b
     JOIN ref_cities c ON c.city_code = b.city_code
     JOIN ref_provinces p ON p.province_code = c.province_code
     WHERE b.barangay_code = ?`,
    [barangayCode],
  );
  return row ? { ...row, barangayCode } : null;
}
