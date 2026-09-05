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
  /** True while the account still holds the password manage-bhw generated for
   *  it (0014). Both portal shells gate on this before rendering anything —
   *  see ChangePasswordGate and migration 0019 (D-06). */
  must_change_password: boolean;
}

export interface PatientRow {
  patient_id: string;
  display_code: string;
  enrolled_by: string;
  /**
   * Composed display string "First Middle Last", written by the mobile app from
   * the parts below (0010). The portal displays this. Nullable: pre-0006 rows
   * have no name at all.
   */
  full_name: string | null;
  /** Name parts (0010). Null on rows enrolled before the split. */
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  birthdate: string | null;
  age: number;
  sex: Sex;
  barangay_code: string;
  sitio: string | null;
  contact_number: string | null;
  sms_consent: boolean;
  consent_date: string | null;
  /** Language for this patient's SMS reminders (en/tl/ceb); null when SMS declined. */
  preferred_language: 'en' | 'tl' | 'ceb' | null;
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

/** One row of the bhw_activity() RPC (0006, extended 0014) — accounts + counts,
 *  no patients. Name parts / purok / email are the BHW's own account fields. */
export interface BhwActivityRow {
  user_id: string;
  full_name: string;
  /** Name parts (0014). Null on rows created before the split. */
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  /** BHW coverage area within the barangay (0014). */
  purok: string | null;
  /** The BHW's own account email (auth.users), surfaced for the edit drawer. */
  email: string | null;
  barangay_code: string | null;
  barangay_name: string | null;
  /** Account creation date (users.created_at) — shown as "Joined". */
  joined_at: string | null;
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

/** Asia/Manila is UTC+8 and has had no DST since 1978, so offset arithmetic is
 *  exact and needs no Intl timeZone support. Mirrors mobile/src/lib/dates.ts and
 *  manila_today() in migration 0018 — portal, app and database must agree on
 *  which day "today" is regardless of where the machine reading them is set. */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Today's calendar date (YYYY-MM-DD) on the Asia/Manila business calendar.
 *  Use this for anything meaning "today"; use toDateOnly only to format a date
 *  the user picked. */
export function manilaToday(): string {
  return new Date(Date.now() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** The calendar date (YYYY-MM-DD) n days before today, on the Manila calendar.
 *  No DST means whole-day arithmetic on the shifted instant is exact. */
export function manilaDaysAgo(n: number): string {
  return new Date(Date.now() + MANILA_OFFSET_MS - n * 86_400_000).toISOString().slice(0, 10);
}

/** A picked Date as YYYY-MM-DD in the machine's own local time — never via
 *  toISOString, which converts to UTC and can shift the calendar day. */
export function toDateOnly(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
