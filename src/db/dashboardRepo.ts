/**
 * Read-only joined queries for the BHW dashboard (Feature 8, brief §8.8):
 * upcoming / missed check-ups and no-show / result referrals, all from the
 * LOCAL cache (fully offline; the sync engine keeps it fresh).
 *
 * Categories are deliberately literal (§7 "simple and explainable"):
 *  - upcoming = appointment status 'scheduled' with scheduled_date >= today
 *  - missed   = appointment status 'missed'   (set by TB-DOTS staff)
 *  - no-show  = referral presented = false    (set by TB-DOTS staff)
 *  - results  = referral with a recorded result (free text from the lab)
 */
import { getDb } from './database';
import { toDateOnly } from '../lib/dates';

export interface DashboardAppointment {
  appointment_id: string;
  patient_id: string;
  display_code: string;
  scheduled_date: string;
  attended_date: string | null;
  status: string;
}

export interface DashboardReferral {
  referral_id: string;
  patient_id: string;
  display_code: string;
  specimen_id: string | null;
  status: string;
  result: string | null;
  result_date: string | null;
  presented: number | null;
}

export async function listUpcomingAppointments(): Promise<DashboardAppointment[]> {
  const db = await getDb();
  return db.getAllAsync<DashboardAppointment>(
    `SELECT a.appointment_id, a.patient_id, p.display_code,
            a.scheduled_date, a.attended_date, a.status
     FROM appointments a JOIN patients p ON p.patient_id = a.patient_id
     WHERE a.status = 'scheduled' AND a.scheduled_date >= ?
     ORDER BY a.scheduled_date ASC`,
    [toDateOnly(new Date())],
  );
}

export async function listMissedAppointments(): Promise<DashboardAppointment[]> {
  const db = await getDb();
  return db.getAllAsync<DashboardAppointment>(
    `SELECT a.appointment_id, a.patient_id, p.display_code,
            a.scheduled_date, a.attended_date, a.status
     FROM appointments a JOIN patients p ON p.patient_id = a.patient_id
     WHERE a.status = 'missed'
     ORDER BY a.scheduled_date DESC`,
  );
}

export async function listNoShowReferrals(): Promise<DashboardReferral[]> {
  const db = await getDb();
  return db.getAllAsync<DashboardReferral>(
    `SELECT r.referral_id, r.patient_id, p.display_code, r.specimen_id,
            r.status, r.result, r.result_date, r.presented
     FROM referrals r JOIN patients p ON p.patient_id = r.patient_id
     WHERE r.presented = 0
     ORDER BY r.updated_at DESC`,
  );
}

export async function listResultReferrals(): Promise<DashboardReferral[]> {
  const db = await getDb();
  return db.getAllAsync<DashboardReferral>(
    `SELECT r.referral_id, r.patient_id, p.display_code, r.specimen_id,
            r.status, r.result, r.result_date, r.presented
     FROM referrals r JOIN patients p ON p.patient_id = r.patient_id
     WHERE r.result IS NOT NULL
     ORDER BY r.result_date DESC`,
  );
}
