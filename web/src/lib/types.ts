/**
 * Server table row types used by the portal — mirrors mobile/src/db/types.ts
 * (and supabase/migrations/0001_init_schema.sql). Kept as a separate copy: the
 * two packages have no shared workspace, and the portal only needs a subset.
 */
export type Sex = 'male' | 'female';
export type PgisSeverity = 'none' | 'mild' | 'moderate' | 'severe';
export type ReferralStatus = 'submitted' | 'received' | 'tested' | 'closed';
export type AppointmentStatus = 'scheduled' | 'attended' | 'missed' | 'cancelled';
export type TbCaseStatus = 'registered' | 'on_treatment' | 'interrupted' | 'closed' | 'cancelled';
export type TreatmentOutcome =
  | 'cured'
  | 'treatment_completed'
  | 'treatment_failed'
  | 'died'
  | 'lost_to_follow_up'
  | 'not_evaluated';
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

export type UserRole = 'bhw' | 'tb_dots' | 'midwife' | 'admin';
export type ResultOutcome = 'positive' | 'negative';

/** Only facility clinicians receive the portal audit viewer. */
export function auditTabVisible(role: UserRole): boolean {
  return role === 'tb_dots';
}

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

/** Minimal exact-match result from the province-wide patient identity registry.
 * Clinical records are deliberately absent; care data remains facility-scoped. */
export interface PatientRegistryMatch {
  patient_id: string;
  display_code: string;
  full_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  birthdate: string | null;
  barangay_code: string;
  phone_last4: string | null;
  can_reuse: boolean;
}

/**
 * Optional vital signs recorded alongside a screening (migration 0024).
 *
 * SUPPLEMENTARY CONTEXT ONLY, exactly like pgis_severity: displayed for the
 * facility's information, never an input to the referral decision. BMI is
 * computed from height + weight at display time (lib/vitals.ts) and is
 * deliberately not a column.
 */
export interface Vitals {
  height_cm: number | null;
  weight_kg: number | null;
  temperature_c: number | null;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  pulse_rate: number | null;
  spo2_percent: number | null;
}

/** Every vitals field, in the order the portal shows them. */
export const VITALS_KEYS = [
  'height_cm',
  'weight_kg',
  'temperature_c',
  'systolic_bp',
  'diastolic_bp',
  'pulse_rate',
  'spo2_percent',
] as const;

export interface ScreeningRow extends Vitals {
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
  /**
   * The laboratory sample identifier, OWNED BY THIS FACILITY (0024). Sputum is
   * collected only here, never at the barangay, so the BHW app no longer
   * generates it — staff enter it when they take the sample, typically while
   * marking the referral received. Was specimen_id until the referral-model
   * correction, and null on every referral created before staff fill it in.
   */
  lab_sample_id: string | null;
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

/** One count-only row from facility_dashboard_overview() (0037). */
export interface FacilityDashboardOverview extends DashboardCounts {
  attention_overdue_followups: number;
  attention_missed_followups: number;
  attention_due_soon: number;
  attention_referrals_awaiting: number;
  attention_stale_cases: number;
  attention_appointments_today: number;
  metric_screened: number;
  metric_referred: number;
  metric_referral_received: number;
  metric_cases_created: number;
  metric_active_treatment_cases: number;
  metric_followups_due: number;
  metric_missed_followups: number;
  metric_closed_cases: number;
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
  facility_id: string | null;
  referral_id: string | null;
  tb_case_id: string | null;
  scheduled_date: string;
  attended_date: string | null;
  status: AppointmentStatus;
  created_at: string;
  updated_at: string;
}

/** One clinician-enrolled treatment episode (migration 0031). */
export interface TbCaseRow {
  case_id: string;
  patient_id: string;
  referral_id: string | null;
  facility_id: string;
  case_number: string;
  registration_date: string;
  case_status: TbCaseStatus;
  treatment_start_date: string | null;
  outcome: TreatmentOutcome | null;
  outcome_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** A visit recorded inside one case. Scheduling remains in appointments. */
export interface TreatmentFollowupRow {
  followup_id: string;
  case_id: string;
  appointment_id: string | null;
  visit_date: string;
  notes: string | null;
  recorded_by: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One row of `facility_audit_events()` (migration 0038).
 *
 * `changes` is the server-side whitelist and carries no free text, lab-result
 * value or contact data — see the whitelist trigger in 0031/0035.
 * `actor_name` is a LEFT JOIN through the `users` RLS, so it is null both for a
 * write with no signed-in actor and for an actor the reader may not resolve.
 */
export interface AuditEventRow {
  audit_id: string;
  entity_table: string;
  entity_id: string;
  action: string;
  actor_user_id: string | null;
  actor_role: string | null;
  actor_name: string | null;
  patient_id: string | null;
  facility_id: string | null;
  changes: Record<string, unknown>;
  occurred_at: string;
}

/** Whitelisted read projection returned by migration 0036. */
export interface TimelineEventRow {
  event_id: string;
  event_type: string;
  occurred_on: string | null;
  occurred_at: string | null;
  is_undated: boolean;
  occurred_on_is_derived: boolean;
  rank: number;
  actor_user_id: string | null;
  actor_role: string | null;
  facility_id: string | null;
  facility_name: string | null;
  case_id: string | null;
  detail: Record<string, unknown>;
}

/**
 * A referral with its embedded patient (+ barangay name) and screening, as
 * returned by the nested select in ReferralInbox/ReferralDetail. RLS already
 * guarantees these are only rows referred to the signed-in staff's facility.
 */
export interface ReferralJoined extends ReferralRow {
  patients: PatientRow & {
    ref_barangays: { name: string } | null;
    /**
     * The enroller (embedded via patients_enrolled_by_fkey; 0007 grants tb_dots
     * read on BHW users rows, users_read_same_facility covers their own
     * colleagues). Null if the row predates that.
     *
     * `role` is what distinguishes a BHW referral from a walk-in this facility
     * registered itself (0025) — no origin column was added, because the
     * enroller's role already answers the question and the two rows are
     * deliberately identical in every other respect.
     */
    users: { full_name: string; role: UserRole } | null;
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

/**
 * Whole-year age on today's date from a YYYY-MM-DD birthdate, or null when the
 * input is missing/invalid/out of range (0-129, matching the DB CHECK on age).
 * Mirrors ageFromBirthdate in mobile/src/lib/dates.ts: "today" is the Manila
 * business day, so a patient's recorded age does not depend on where the
 * machine reading it happens to be set.
 */
export function ageFromBirthdate(birthdate: string | null | undefined): number | null {
  if (!birthdate) return null;
  const [y, m, d] = birthdate.split('-').map(Number);
  if (!y || !m || !d) return null;
  const [ty, tm, td] = manilaToday().split('-').map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age--;
  return Number.isInteger(age) && age >= 0 && age < 130 ? age : null;
}

/** "First Middle Last", collapsing whitespace and omitting an empty middle.
 *  Mirrors composeFullName in mobile/src/lib/names.ts — patients.full_name is
 *  the one display string every reader consumes, so both writers must compose
 *  it the same way. */
export function composeFullName(
  first: string,
  middle: string | null | undefined,
  last: string,
): string {
  return [first, middle, last]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' ');
}

/** A picked Date as YYYY-MM-DD in the machine's own local time — never via
 *  toISOString, which converts to UTC and can shift the calendar day. */
export function toDateOnly(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Should the Barangay Report tab be shown, given the probe call's error?
 *
 * The portal is deployed by pushing to main; migration 0027 is applied by hand
 * in the SQL editor. Those are different moments, so the UI can be live against
 * a database that has never heard of barangay_report — it was, for a while on
 * 2026-09-08, and the tab failed on every load.
 *
 * PGRST202 is PostgREST for "no such function", and it is the ONLY answer that
 * hides the tab. Anything else — a dropped connection, a permissions error,
 * a timeout — leaves it visible, because those are conditions the report view
 * can explain to the reader with a retry button. Collapsing this to `!error`
 * is the tempting simplification and it is wrong: it makes a feature vanish
 * from the navigation every time the network hiccups, which reads as data loss.
 */
export function reportTabVisible(error: { code?: string } | null | undefined): boolean {
  return error?.code !== 'PGRST202';
}
