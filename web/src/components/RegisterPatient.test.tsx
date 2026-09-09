/** RegisterPatient — migration 0032 atomic walk-in client contract. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from '../i18n/locales/en';
import type { PortalUser } from '../lib/types';
import RegisterPatient from './RegisterPatient';

const mock = vi.hoisted(() => {
  const db = {
    rpcCalls: [] as [string, Record<string, unknown>][],
    rpcError: null as { message: string } | null,
  };
  return {
    db,
    supabase: {
      rpc(fn: string, args: Record<string, unknown>) {
        db.rpcCalls.push([fn, args]);
        const flags = args.p_symptom_flags as Record<string, string>;
        const cardinal = ['cough_2wks', 'weight_loss', 'night_sweats', 'fever', 'hemoptysis'];
        const referred =
          cardinal.some((key) => flags[key] === 'yes') ||
          (flags.tb_contact === 'yes' &&
            Object.entries(flags).some(([key, value]) => key !== 'tb_contact' && value === 'yes'));
        return Promise.resolve({
          data: db.rpcError
            ? null
            : {
                patient_id: args.p_patient_id,
                screening_id: args.p_screening_id,
                referral_id: args.p_referral_id,
                display_code: 'PAT-DOTS-0007',
                full_name: 'Juan Dela Cruz',
                referred,
              },
          error: db.rpcError,
        });
      },
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mock.supabase }));
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
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });
const saveBtn = () => screen.getByRole('button', { name: en.register.saveCta }) as HTMLButtonElement;

function within(el: HTMLElement) {
  return {
    getByText: (text: string) => {
      const found = Array.from(el.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === text,
      );
      if (!found) throw new Error(`no button "${text}" in row`);
      return found;
    },
  };
}

function answerChecklist(overrides: Record<string, string> = {}, pgis = en.pgis.mild) {
  for (const [key, question] of Object.entries(en.symptoms)) {
    const row = screen.getByText(question).closest('.sym-ask') as HTMLElement;
    fireEvent.click(within(row).getByText(overrides[key] ?? en.common.no));
  }
  fireEvent.click(screen.getByRole('button', { name: pgis }));
}

function fillIdentity() {
  type(en.register.firstName, 'Juan');
  type(en.register.lastName, 'Dela Cruz');
  type(en.register.birthdate, '1990-01-01');
  fireEvent.click(screen.getByRole('button', { name: en.sex.male }));
  fireEvent.click(screen.getByRole('button', { name: 'pick-barangay' }));
  fireEvent.click(screen.getByLabelText(en.register.consentConfirm));
}

const payload = () => mock.db.rpcCalls.at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  mock.db.rpcCalls = [];
  mock.db.rpcError = null;
});

describe('RegisterPatient — atomic contract', () => {
  it('submits the whole registration as one RPC', async () => {
    renderForm();
    fillIdentity();
    answerChecklist({ cough_2wks: en.common.yes });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.rpcCalls).toHaveLength(1));
    expect(mock.db.rpcCalls[0][0]).toBe('register_walkin');
    expect(screen.getByText('PAT-DOTS-0007')).toBeTruthy();
  });

  it('sends four stable, distinct operation and row ids', async () => {
    renderForm();
    fillIdentity();
    answerChecklist();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.rpcCalls).toHaveLength(1));
    const values = ['p_request_id', 'p_patient_id', 'p_screening_id', 'p_referral_id'].map(
      (key) => payload()[key],
    );
    expect(values.every((value) => typeof value === 'string')).toBe(true);
    expect(new Set(values).size).toBe(4);
  });

  it('leaves server-owned values to the server', async () => {
    renderForm();
    fillIdentity();
    answerChecklist();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.rpcCalls).toHaveLength(1));
    expect(payload()).toMatchObject({ p_barangay_code: '101312012', p_sex: 'male' });
    for (const key of [
      'p_enrolled_by', 'p_facility_id', 'p_display_code', 'p_age', 'p_full_name',
      'p_status', 'p_lab_sample_id', 'p_consent_date',
    ]) expect(key in payload()).toBe(false);
  });

  it('sends facts but no browser-asserted referral decision or score', async () => {
    renderForm();
    fillIdentity();
    answerChecklist({}, en.pgis.severe);
    type(`${en.vitals.temperature} (${en.vitals.unitC})`, '39.5');
    type(`${en.vitals.spo2} (${en.vitals.unitPercent})`, '88');
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.rpcCalls).toHaveLength(1));
    expect('p_referred' in payload()).toBe(false);
    expect(payload().p_pgis_severity).toBe('severe');
    expect(payload().p_temperature_c).toBe(39.5);
    expect(Object.keys(payload()).filter((key) => /score|risk|probab|confidence/i.test(key))).toEqual([]);
  });

  it('shows that severe context alone does not flag the checklist', () => {
    renderForm();
    fillIdentity();
    answerChecklist({}, en.pgis.severe);
    type(`${en.vitals.temperature} (${en.vitals.unitC})`, '39.5');
    expect(screen.getByText(en.register.willNotFlag)).toBeTruthy();
  });

  it('shows that contact plus any symptom does flag the checklist', () => {
    renderForm();
    fillIdentity();
    answerChecklist({ tb_contact: en.common.yes, fatigue: en.common.yes });
    expect(screen.getByText(en.register.willFlag)).toBeTruthy();
  });

  it('keeps all vitals optional', async () => {
    renderForm();
    fillIdentity();
    answerChecklist();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.rpcCalls).toHaveLength(1));
    for (const key of [
      'p_height_cm', 'p_weight_kg', 'p_temperature_c', 'p_systolic_bp',
      'p_diastolic_bp', 'p_pulse_rate', 'p_spo2_percent',
    ]) expect(payload()[key], key).toBeNull();
  });

  it('blocks a vital outside the database range', () => {
    renderForm();
    fillIdentity();
    answerChecklist();
    type(`${en.vitals.temperature} (${en.vitals.unitC})`, '3.68');
    expect(saveBtn().disabled).toBe(true);
    expect(screen.getByText(en.vitals.outOfRange)).toBeTruthy();
  });
});

describe('RegisterPatient — consent and privacy', () => {
  it('cannot save without registration consent', () => {
    renderForm();
    type(en.register.firstName, 'Juan');
    type(en.register.lastName, 'Dela Cruz');
    type(en.register.birthdate, '1990-01-01');
    fireEvent.click(screen.getByRole('button', { name: en.sex.male }));
    fireEvent.click(screen.getByRole('button', { name: 'pick-barangay' }));
    answerChecklist();
    expect(saveBtn().disabled).toBe(true);
  });

  it('sends no contact details when SMS is declined', async () => {
    renderForm();
    fillIdentity();
    answerChecklist();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.rpcCalls).toHaveLength(1));
    expect(payload().p_sms_consent).toBe(false);
    expect(payload().p_contact_number).toBeNull();
    expect(payload().p_preferred_language).toBeNull();
  });

  it('sends number and language only with SMS opt-in', async () => {
    renderForm();
    fillIdentity();
    answerChecklist();
    fireEvent.click(screen.getByLabelText(en.register.smsOptIn));
    type(en.register.contactNumber, '09171234567');
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.rpcCalls).toHaveLength(1));
    expect(payload().p_sms_consent).toBe(true);
    expect(payload().p_contact_number).toBe('09171234567');
    expect(payload().p_preferred_language).toBe('en');
  });

  it('clears the number when SMS opt-in is withdrawn', async () => {
    renderForm();
    fillIdentity();
    answerChecklist();
    fireEvent.click(screen.getByLabelText(en.register.smsOptIn));
    type(en.register.contactNumber, '09171234567');
    fireEvent.click(screen.getByLabelText(en.register.smsOptIn));
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.rpcCalls).toHaveLength(1));
    expect(payload().p_contact_number).toBeNull();
  });

  it('refuses a malformed mobile number', () => {
    renderForm();
    fillIdentity();
    answerChecklist();
    fireEvent.click(screen.getByLabelText(en.register.smsOptIn));
    type(en.register.contactNumber, '12345');
    expect(saveBtn().disabled).toBe(true);
    expect(screen.getByText(en.register.contactInvalid)).toBeTruthy();
  });
});

describe('RegisterPatient — failure and replay', () => {
  it('surfaces a rejected RPC without claiming success', async () => {
    mock.db.rpcError = { message: 'not authorized' };
    renderForm();
    fillIdentity();
    answerChecklist();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(screen.getByText(/not authorized/)).toBeTruthy());
    expect(mock.db.rpcCalls).toHaveLength(1);
    expect(screen.queryByText(en.register.openInInbox)).toBeNull();
  });

  it('reuses every id after a failed or lost response', async () => {
    mock.db.rpcError = { message: 'network request failed' };
    renderForm();
    fillIdentity();
    answerChecklist();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.rpcCalls).toHaveLength(1));
    const first = mock.db.rpcCalls[0][1];
    mock.db.rpcError = null;
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mock.db.rpcCalls).toHaveLength(2));
    const second = mock.db.rpcCalls[1][1];
    for (const key of ['p_request_id', 'p_patient_id', 'p_screening_id', 'p_referral_id']) {
      expect(second[key]).toBe(first[key]);
    }
  });
});
