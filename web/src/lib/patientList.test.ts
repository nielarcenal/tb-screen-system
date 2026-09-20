import { describe, expect, it } from 'vitest';
import { patientSearch, validPatientDraft, type PatientDraft } from './patientList';
const draft: PatientDraft = { first_name: 'Maria', middle_name: null, last_name: 'Santos', birthdate: '1990-05-04', sex: 'female', barangay_code: '101', sitio: null, sms_consent: false, contact_number: null, preferred_language: null };
describe('patient editing', () => {
  it('accepts complete demographics without SMS', () => expect(validPatientDraft(draft)).toBe(true));
  it('rejects missing names, impossible and future dates', () => {
    for (const change of [{ first_name: ' ' }, { last_name: '' }, { birthdate: '2026-02-31' }, { birthdate: '2999-01-01' }, { birthdate: null }]) expect(validPatientDraft({ ...draft, ...change })).toBe(false);
  });
  it('requires valid SMS number and language only when opted in', () => {
    expect(validPatientDraft({ ...draft, sms_consent: true })).toBe(false);
    expect(validPatientDraft({ ...draft, sms_consent: true, contact_number: '09171234567', preferred_language: 'ceb' })).toBe(true);
  });
  it('strips filter syntax while preserving multilingual names', () => {
    expect(patientSearch(' Peña,_(patient_id.neq.null)% ')).toBe('Peñapatientidneqnull');
    expect(patientSearch(" O'Neil-Santos ")).toBe("O'Neil-Santos");
  });
});
