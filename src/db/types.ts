/**
 * Explicit TypeScript types for every server table row (brief §9).
 *
 * These mirror supabase/migrations/0001_init_schema.sql. Kept hand-written for
 * now; can be regenerated with `supabase gen types typescript` later.
 *
 * Timestamps are ISO-8601 UTC strings on the wire and in the local sqlite cache.
 */

// --- small fixed value sets (mirror the SQL CHECK constraints) ---
export type FacilityType = 'barangay_health_station' | 'tb_dots';
export type UserRole = 'bhw' | 'tb_dots';
export type Sex = 'male' | 'female';
export type PgisSeverity = 'none' | 'mild' | 'moderate' | 'severe';
export type ReferralStatus = 'submitted' | 'received' | 'tested' | 'closed';
export type AppointmentStatus = 'scheduled' | 'attended' | 'missed';
export type SmsDeliveryStatus = 'queued' | 'sent' | 'failed' | 'stubbed';

/** Tri-state answer for DOH-NTP symptom items where "unsure" is meaningful (§5). */
export type TriState = 'yes' | 'no' | 'unsure';

/**
 * DOH-NTP symptom checklist answers, stored as jsonb (§5). This is the SOLE
 * basis for a referral recommendation — there is NO score anywhere.
 * Shape is intentionally open (jsonb); this documents the expected keys.
 */
export interface SymptomFlags {
  cough_2wks?: TriState;
  weight_loss?: TriState;
  night_sweats?: TriState;
  fever?: TriState;
  hemoptysis?: TriState; // coughing up blood
  chest_pain?: TriState;
  fatigue?: TriState;
  loss_of_appetite?: TriState;
  tb_contact?: TriState; // close contact with a known TB case
}

// --- table rows ---
export interface FacilityRow {
  facility_id: string;
  name: string;
  type: FacilityType;
  address: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  user_id: string;
  role: UserRole;
  full_name: string;
  facility_id: string;
  assigned_barangay_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface PatientRow {
  patient_id: string;
  display_code: string;
  enrolled_by: string;
  /**
   * Composed display string "First Middle Last", written by the app from the
   * parts below. Kept because every reader (lists, referral slip, web portal)
   * consumes it. Nullable: pre-0006 rows have no name.
   */
  full_name: string | null;
  /** Given name. Required for new enrollments; null on pre-0010 rows. */
  first_name: string | null;
  /** Optional — not every patient has one. */
  middle_name: string | null;
  /** Family name. Required for new enrollments; null on pre-0010 rows. */
  last_name: string | null;
  /** Date-only YYYY-MM-DD; nullable for pre-0006 rows. Age is derived from it. */
  birthdate: string | null;
  age: number;
  sex: Sex;
  barangay_code: string;
  sitio: string | null;
  contact_number: string | null;
  sms_consent: boolean;
  consent_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScreeningRow {
  screening_id: string;
  patient_id: string;
  symptom_flags: SymptomFlags;
  pgis_severity: PgisSeverity | null;
  referred: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReferralRow {
  referral_id: string;
  patient_id: string;
  screening_id: string;
  facility_id: string;
  specimen_id: string | null;
  status: ReferralStatus;
  result: string | null;
  result_date: string | null;
  presented: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface AppointmentRow {
  appointment_id: string;
  patient_id: string;
  scheduled_date: string;
  attended_date: string | null;
  status: AppointmentStatus;
  created_at: string;
  updated_at: string;
}

export interface SmsLogRow {
  sms_id: string;
  appointment_id: string;
  sent_at: string;
  delivery_status: SmsDeliveryStatus;
}

// --- local-only sync bookkeeping ---
/** Every locally-cached syncable row carries this (§7). Server tables do NOT. */
export type SyncStatus = 'pending' | 'synced';

/** A patient row as stored in the on-device sqlite cache. */
export type LocalPatientRow = PatientRow & { sync_status: SyncStatus };
