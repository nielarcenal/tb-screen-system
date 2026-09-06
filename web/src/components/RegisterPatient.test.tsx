/**
 * RegisterPatient — the walk-in pathway (migration 0025).
 *
 * This screen writes THREE rows across three PostgREST calls with no
 * transaction, and one of them is a clinical record. So these tests pin the
 * payloads themselves rather than the rendering:
 *
 *  - the chain is patient → screening → referral, in FK order;
 *  - the referral is addressed to the staff member's OWN facility and starts at
 *    'received', because the patient is already standing there;
 *  - lab_sample_id is never written at registration — sputum has not been
 *    collected yet, and inventing an id here is the exact mistake the
 *    referral-model correction retired;
 *  - `referred` comes from the DOH-NTP checklist ALONE (§5). The test that
 *    matters most below sets a severe PGI-S and vitals a scoring system would
 *    react to, against a checklist that does not flag, and asserts the record
 *    still says false — and that the patient is registered anyway.
 *  - the SMS privacy invariant (§4) holds on the client too, not only in the
 *    patients_sms_consent_gate CHECK.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from '../i18n/locales/en';
import type { PortalUser } from '../lib/types';
import RegisterPatient from './RegisterPatient';

const mock = vi.hoisted(() => {
  const db = {
    /** Every insert, as [table, payload], in call order. */
    inserts: [] as [string, Record<string, unknown>][],
    rpcCalls: [] as string[],
    nextCode: 'PAT-DOTS-0007',
    insertError: null as { message: string } | null,
  };

  const supabase = {
    rpc(fn: string) {
      db.rpcCalls.push(fn);
      return Promise.resolve({ data: db.nextCode, error: null });
    },
    from(table: string) {
      return {
        insert: (payload: Record<string, unknown>) => {
          db.inserts.push([table, payload]);
          return Promise.resolve({ error: db.insertError });
        },
      };
    },
  };

  return { db, supabase };
});

vi.mock('../lib/supabase', () => ({ supabase: mock.supabase }));

/**
 * The address cascade is four chained ref_* queries of its own and is tested by
 * being used everywhere else in the portal. Stubbed to a single button so these
 * tests can pick a barangay without modelling PSGC.
 */
vi.mock('./AddressCascadeWeb', () => ({
  default: ({ onChange }: { onChange: (code: string | null) => void }) => (
    <button type="button" onClick={() => onChange('101312012')}>
      pick-barangay
    </button>
  ),
}));

const me: PortalUser = {
  user_id: 'usr-staff',
  role: 'tb_dots',
  full_name: 'Nurse Ana Lim',
  facility_id: 'fac-valencia',
  active: true,
  must_change_password: false,
};

const renderForm = () => render(<RegisterPatient me={me} onOpenReferral={() => {}} />);

const type = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });
};

const saveBtn = () => screen.getByRole('button', { name: en.register.saveCta }) as HTMLButtonElement;

/** Answer every checklist item 'no' unless `overrides` says otherwise, then
 *  pick a PGI-S. Leaves the form one click from saveable. */
function answerChecklist(overrides: Record<string, string> = {}, pgis = en.pgis.mild) {
  for (const [key, question] of Object.entries(en.symptoms)) {
    const row = screen.getByText(question).closest('.sym-ask') as HTMLElement;
    const answer = overrides[key] ?? en.common.no;
    fireEvent.click(within(row).getByText(answer));
  }
  fireEvent.click(screen.getByRole('button', { name: pgis }));
}

/** Minimal scoped query — the checklist repeats Yes/No/Unsure nine times. */
function within(el: HTMLElement) {
  return {
    getByText: (text: string) => {
      const found = Array.from(el.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === text,
      );
      if (!found) throw new Error(`no button "${text}" in row`);
      return found;
    },
  };
}

/** Fill everything the form requires, leaving the checklist to the caller. */
function fillIdentity() {
  type(en.register.firstName, 'Juan');
  type(en.register.lastName, 'Dela Cruz');
  type(en.register.birthdate, '1990-01-01');
  fireEvent.click(screen.getByRole('button', { name: en.sex.male }));
  fireEvent.click(screen.getByRole('button', { name: 'pick-barangay' }));
  fireEvent.click(screen.getByLabelText(en.register.consentConfirm));
}

const inserted = (table: string) =>
  mock.db.inserts.find(([t]) => t === table)?.[1] as Record<string, unknown>;

beforeEach(() => {
  mock.db.inserts = [];
  mock.db.rpcCalls = [];
  mock.db.insertError = null;
});

describe('RegisterPatient — what it writes', () => {
  it('writes patient, screening and referral in FK order', async () => {
    renderForm();
    fillIdentity();
    answerChecklist({ cough_2wks: en.common.yes });

    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.inserts).toHaveLength(3));

    expect(mock.db.inserts.map(([t]) => t)).toEqual(['patients', 'screenings', 'referrals']);
    expect(mock.db.rpcCalls).toEqual(['next_facility_patient_code']);
  });

  it('attributes the patient to the signed-in staff member and the server-issued code', async () => {
    renderForm();
    fillIdentity();
    answerChecklist();

    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.inserts).toHaveLength(3));

    expect(inserted('patients')).toMatchObject({
      enrolled_by: 'usr-staff',
      display_code: 'PAT-DOTS-0007',
      full_name: 'Juan Dela Cruz',
      barangay_code: '101312012',
      sex: 'male',
    });
  });

  it("files the referral to the staff member's own facility, already received", async () => {
    renderForm();
    fillIdentity();
    answerChecklist({ fever: en.common.yes });

    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.inserts).toHaveLength(3));

    const referral = inserted('referrals');
    expect(referral.facility_id).toBe('fac-valencia');
    // Not 'submitted': there is no waiting-to-arrive phase for a walk-in.
    expect(referral.status).toBe('received');
    // Sputum has not been collected. Naming a sample that does not exist is
    // exactly what the referral-model correction retired.
    expect('lab_sample_id' in referral).toBe(false);
  });

  it('links the three rows to each other', async () => {
    renderForm();
    fillIdentity();
    answerChecklist();

    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.inserts).toHaveLength(3));

    const p = inserted('patients');
    const s = inserted('screenings');
    const r = inserted('referrals');
    expect(s.patient_id).toBe(p.patient_id);
    expect(r.patient_id).toBe(p.patient_id);
    expect(r.screening_id).toBe(s.screening_id);
  });
});

describe('RegisterPatient — positioning (§1, §5)', () => {
  it('takes `referred` from the checklist alone, whatever the context says', async () => {
    renderForm();
    fillIdentity();
    // Nothing on the checklist flags. Then pile on everything that is NOT part
    // of the rule: the most severe PGI-S, and readings any scoring system would
    // react to. The record must still say the checklist did not flag.
    answerChecklist({}, en.pgis.severe);
    type(`${en.vitals.temperature} (${en.vitals.unitC})`, '39.5');
    type(`${en.vitals.spo2} (${en.vitals.unitPercent})`, '88');
    type(`${en.vitals.systolic} (${en.vitals.unitMmHg})`, '180');

    expect(screen.getByText(en.register.willNotFlag)).toBeTruthy();

    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.inserts).toHaveLength(3));

    const s = inserted('screenings');
    expect(s.referred).toBe(false);
    expect(s.pgis_severity).toBe('severe');
    expect(s.temperature_c).toBe(39.5);
    // ...and the patient is registered regardless. "Does not meet presumptive
    // criteria" is an answer, not a reason to drop the visit.
    expect(mock.db.inserts.map(([t]) => t)).toEqual(['patients', 'screenings', 'referrals']);
  });

  it('flags on a cardinal symptom, using the same rule as the app', async () => {
    renderForm();
    fillIdentity();
    answerChecklist({ hemoptysis: en.common.yes });

    expect(screen.getByText(en.register.willFlag)).toBeTruthy();

    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.inserts).toHaveLength(3));
    expect(inserted('screenings').referred).toBe(true);
  });

  it('stores no score of any kind on the screening', async () => {
    renderForm();
    fillIdentity();
    answerChecklist({ cough_2wks: en.common.yes });

    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.inserts).toHaveLength(3));

    const keys = Object.keys(inserted('screenings'));
    expect(keys.filter((k) => /score|risk|probab|confidence/i.test(k))).toEqual([]);
  });
});

describe('RegisterPatient — vitals are optional', () => {
  it('registers with every vital left blank', async () => {
    renderForm();
    fillIdentity();
    answerChecklist();

    expect(saveBtn().disabled).toBe(false);
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.inserts).toHaveLength(3));

    const s = inserted('screenings');
    for (const k of ['height_cm', 'weight_kg', 'temperature_c', 'spo2_percent']) {
      expect(s[k], k).toBeNull();
    }
  });

  it('blocks the save on a reading the database would reject', async () => {
    renderForm();
    fillIdentity();
    answerChecklist();

    // A slipped decimal point: 3.68 °C instead of 36.8.
    type(`${en.vitals.temperature} (${en.vitals.unitC})`, '3.68');
    expect(saveBtn().disabled).toBe(true);
    expect(screen.getByText(en.vitals.outOfRange)).toBeTruthy();

    type(`${en.vitals.temperature} (${en.vitals.unitC})`, '36.8');
    expect(saveBtn().disabled).toBe(false);
  });
});

describe('RegisterPatient — consent and privacy (§4)', () => {
  it('cannot save without the patient consenting', async () => {
    renderForm();
    type(en.register.firstName, 'Juan');
    type(en.register.lastName, 'Dela Cruz');
    type(en.register.birthdate, '1990-01-01');
    fireEvent.click(screen.getByRole('button', { name: en.sex.male }));
    fireEvent.click(screen.getByRole('button', { name: 'pick-barangay' }));
    answerChecklist();

    // Everything else is answered; only the consent box is unticked.
    expect(saveBtn().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(en.register.consentConfirm));
    expect(saveBtn().disabled).toBe(false);
  });

  it('stores no number and no consent date when SMS is declined', async () => {
    renderForm();
    fillIdentity();
    answerChecklist();

    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.inserts).toHaveLength(3));

    const p = inserted('patients');
    expect(p.sms_consent).toBe(false);
    expect(p.contact_number).toBeNull();
    expect(p.consent_date).toBeNull();
    expect(p.preferred_language).toBeNull();
  });

  it('stores the number only alongside an SMS opt-in and a consent date', async () => {
    renderForm();
    fillIdentity();
    answerChecklist();
    fireEvent.click(screen.getByLabelText(en.register.smsOptIn));
    type(en.register.contactNumber, '09171234567');

    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.inserts).toHaveLength(3));

    const p = inserted('patients');
    expect(p.sms_consent).toBe(true);
    expect(p.contact_number).toBe('09171234567');
    expect(typeof p.consent_date).toBe('string');
  });

  it('drops a number already typed when the opt-in is withdrawn', async () => {
    // The §4 invariant the UI is responsible for. Without the clear-on-untick,
    // a number typed and then declined would still be sent — and the database
    // CHECK would reject the whole registration at the last moment, losing the
    // rest of the form with it.
    renderForm();
    fillIdentity();
    answerChecklist();
    fireEvent.click(screen.getByLabelText(en.register.smsOptIn));
    type(en.register.contactNumber, '09171234567');
    fireEvent.click(screen.getByLabelText(en.register.smsOptIn)); // withdrawn

    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.inserts).toHaveLength(3));

    const p = inserted('patients');
    expect(p.sms_consent).toBe(false);
    expect(p.contact_number).toBeNull();
    expect(p.consent_date).toBeNull();
  });

  it('refuses to save a malformed mobile number', async () => {
    renderForm();
    fillIdentity();
    answerChecklist();
    fireEvent.click(screen.getByLabelText(en.register.smsOptIn));
    type(en.register.contactNumber, '12345');

    expect(saveBtn().disabled).toBe(true);
    expect(screen.getByText(en.register.contactInvalid)).toBeTruthy();
  });
});

describe('RegisterPatient — failures', () => {
  it('surfaces a rejected write instead of claiming success', async () => {
    mock.db.insertError = { message: 'new row violates row-level security policy' };
    renderForm();
    fillIdentity();
    answerChecklist();

    fireEvent.click(saveBtn());

    await waitFor(() =>
      expect(
        screen.getByText(/new row violates row-level security policy/),
      ).toBeTruthy(),
    );
    // Stopped at the first failure rather than pressing on with the children.
    expect(mock.db.inserts).toHaveLength(1);
    expect(screen.queryByText(en.register.openInInbox)).toBeNull();
  });
});
