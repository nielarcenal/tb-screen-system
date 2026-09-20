import { ageFromBirthdate, type PatientRow } from './types';

export type PatientDraft = Pick<PatientRow, 'first_name' | 'middle_name' | 'last_name' | 'birthdate' | 'sex' | 'barangay_code' | 'sitio' | 'sms_consent' | 'contact_number' | 'preferred_language'>;
export function patientDraft(p: PatientRow): PatientDraft {
  return Object.fromEntries(['first_name', 'middle_name', 'last_name', 'birthdate', 'sex', 'barangay_code', 'sitio', 'sms_consent', 'contact_number', 'preferred_language'].map(k => [k, p[k as keyof PatientRow]])) as PatientDraft;
}
export function validPatientDraft(d: PatientDraft): boolean {
  const date = d.birthdate ?? '';
  const parsed = new Date(`${date}T00:00:00Z`);
  return !!d.first_name?.trim() && !!d.last_name?.trim() && !!d.barangay_code &&
    ['male', 'female'].includes(d.sex) && ageFromBirthdate(date) !== null &&
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date &&
    (!d.sms_consent || (/^09\d{9}$/.test(d.contact_number?.trim() ?? '') && ['en', 'tl', 'ceb'].includes(d.preferred_language ?? '')));
}
// Allow name/code searches without letting input add PostgREST filter clauses.
export function patientSearch(value: string): string {
  return value.replace(/[^\p{L}\p{N}\s'-]/gu, '').trim().slice(0, 100);
}
