/**
 * Server table row types used by the portal — mirrors mobile/src/db/types.ts
 * (and supabase/migrations/0001_init_schema.sql). Kept as a separate copy: the
 * two packages have no shared workspace, and the portal only needs a subset.
 */
export type Sex = 'male' | 'female';
export type PgisSeverity = 'none' | 'mild' | 'moderate' | 'severe';
export type ReferralStatus = 'submitted' | 'received' | 'tested' | 'closed';
export type AppointmentStatus = 'scheduled' | 'attended' | 'missed';
export type TriState = 'yes' | 'no' | 'unsure';

/** DOH-NTP checklist answers (jsonb). The SOLE basis for referral (§5). */
export interface SymptomFlags {
  cough_2wks?: TriState;
  weight_loss?: TriState;
  night_sweats?: TriState;
  fever?: TriState;
  hemoptysis?: TriState;
  chest_pain?: TriState;
  fatigue?: TriState;
  loss_of_appetite?: TriState;
  tb_contact?: TriState;
}

/** Checklist display order — matches mobile/src/domain/screeningRules.ts. */
export const SYMPTOM_KEYS = [
  'cough_2wks',
  'weight_loss',
  'night_sweats',
  'fever',
  'hemoptysis',
  'chest_pain',
  'fatigue',
  'loss_of_appetite',
  'tb_contact',
] as const;

export type UserRole = 'bhw' | 'tb_dots' | 'captain' | 'admin';
export type ResultOutcome = 'positive' | 'negative';

/** The signed-in account's own users row (role drives which portal shows). */
export interface PortalUser {
  user_id: string;
  role: UserRole;
  full_name: string;
  facility_id: string;
  active: boolean;
}

export interface PatientRow {
  patient_id: string;
  display_code: string;
  enrolled_by: string;
  /** Nullable: pre-0006 rows have no name (0006 design-parity migration). */
  full_name: string | null;
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
  /** Structured lab outcome recorded by staff (0006). Never computed (§1). */
  result_outcome: ResultOutcome | null;
  result_date: string | null;
  presented: boolean | null;
  created_at: string;
  updated_at: string;
}

/** One row of the dashboard_counts() RPC (0006). */
export interface DashboardCounts {
  screened_today: number;
  referred_today: number;
  positive_today: number;
  negative_today: number;
  attended_today: number;
  missed_today: number;
  scheduled_today: number;
}

/** One row of the bhw_activity() RPC (0006) — accounts + counts, no patients. */
export interface BhwActivityRow {
  user_id: string;
  full_name: string;
  barangay_code: string | null;
  barangay_name: string | null;
  active: boolean;
  screenings_n: number;
  referrals_n: number;
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

/**
 * A referral with its embedded patient (+ barangay name) and screening, as
 * returned by the nested select in ReferralInbox/ReferralDetail. RLS already
 * guarantees these are only rows referred to the signed-in staff's facility.
 */
export interface ReferralJoined extends ReferralRow {
  patients: PatientRow & {
    ref_barangays: { name: string } | null;
    /** Enrolling BHW (embedded via patients_enrolled_by_fkey; 0007 grants
     *  tb_dots read on BHW users rows). Null if the row predates that. */
    users: { full_name: string } | null;
  };
  screenings: ScreeningRow;
}

/** Local-time date-only string (YYYY-MM-DD) — never via toISOString (UTC+8 shift). */
export function toDateOnly(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
