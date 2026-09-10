/**
 * ReferralDetail — the laboratory outcome editor.
 *
 * These tests pin the READ-BACK half of that editor: whatever TB-DOTS staff
 * saved into `referrals.result` / `result_outcome` must come back into the form
 * the next time the referral is opened, an edit must be sent exactly as typed,
 * and an empty notes box must be stored as NULL rather than ''.
 *
 * Why it is worth pinning: `resultText` is declared as `useState('')`, which
 * reads like write-only state until you find the `setResultText(r?.result ?? '')`
 * inside `load()` a few lines down. This suite is what keeps that line honest —
 * delete it and three of these tests fail.
 *
 * §1 note: the outcome is data a human recorded at the facility. Nothing here
 * computes, scores or infers it; the component only stores and redisplays it.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from '../i18n/locales/en';
import type { AppointmentRow, ReferralJoined, TbCaseRow } from '../lib/types';
import { emptyVitals } from '../lib/vitals';
import ReferralDetail from './ReferralDetail';

/**
 * Fake PostgREST. Hoisted because vi.mock's factory runs before the module
 * body, so a plain `const` above it would still be in its temporal dead zone.
 *
 * Only the three chains ReferralDetail actually builds are modelled:
 *   referrals    .select().eq().maybeSingle()
 *   appointments .select().eq().order()
 *   <table>      .update().eq()          (awaited directly)
 */
const mock = vi.hoisted(() => {
  const db = {
    referral: null as Record<string, unknown> | null,
    appointments: [] as unknown[],
    cases: [] as unknown[],
    caseLoadError: null as { message: string } | null,
    /** Every payload passed to .update(), in order. */
    updates: [] as Record<string, unknown>[],
    /** Every table/column/value equality used while loading. */
    selectFilters: [] as Array<[string, string, unknown]>,
    /** Every appointment payload passed to .insert(). */
    inserts: [] as Record<string, unknown>[],
    rpcCalls: [] as Array<[string, Record<string, unknown>]>,
    rpcError: null as { message: string } | null,
    /** When set, what the server ends up holding in `result` regardless of
     *  what was sent — lets a test tell a repaint-from-reload apart from the
     *  local edit that merely happens to match. */
    serverResult: undefined as string | undefined,
  };

  const supabase = {
    from(table: string) {
      return {
        select: () =>
          table === 'referrals'
            ? {
                eq: (column: string, value: unknown) => {
                  db.selectFilters.push([table, column, value]);
                  return {
                    maybeSingle: () => Promise.resolve({ data: db.referral, error: null }),
                  };
                },
              }
            : {
                eq: (column: string, value: unknown) => {
                  db.selectFilters.push([table, column, value]);
                  return {
                    order: () => Promise.resolve({
                      data: table === 'tb_cases' ? db.cases : db.appointments,
                      error: table === 'tb_cases' ? db.caseLoadError : null,
                    }),
                  };
                },
              },
        update: (fields: Record<string, unknown>) => ({
          eq: () => {
            db.updates.push(fields);
            // Mirror the server: ReferralDetail reloads after every write, and
            // the reload must observe what was just written.
            if (table === 'referrals' && db.referral) {
              db.referral = { ...db.referral, ...fields };
              if (db.serverResult !== undefined) db.referral.result = db.serverResult;
            }
            return Promise.resolve({ error: null });
          },
        }),
        insert: (fields: Record<string, unknown>) => {
          db.inserts.push(fields);
          return Promise.resolve({ error: null });
        },
      };
    },
    rpc(name: string, fields: Record<string, unknown>) {
      db.rpcCalls.push([name, fields]);
      return Promise.resolve({
        data: db.cases[0] ?? null,
        error: db.rpcError,
      });
    },
  };

  return { db, supabase };
});

// vi.mock is hoisted above the imports, so ReferralDetail — which pulls in
// ../lib/supabase, a module that throws on a missing VITE_SUPABASE_URL — sees
// the fake and never touches a real project.
vi.mock('../lib/supabase', () => ({ supabase: mock.supabase }));

/** A received referral with no outcome yet; override what a test cares about. */
function makeReferral(over: Partial<ReferralJoined> = {}): ReferralJoined {
  return {
    referral_id: 'ref-1',
    patient_id: 'pat-1',
    screening_id: 'scr-1',
    facility_id: 'fac-1',
    lab_sample_id: null,
    status: 'received',
    result: null,
    result_outcome: null,
    result_date: null,
    presented: true,
    created_at: '2026-08-01T02:00:00.000Z',
    updated_at: '2026-08-01T02:00:00.000Z',
    patients: {
      patient_id: 'pat-1',
      display_code: 'BUK-0001',
      enrolled_by: 'usr-bhw',
      full_name: 'Juan Dela Cruz',
      first_name: 'Juan',
      middle_name: null,
      last_name: 'Dela Cruz',
      birthdate: '1990-01-01',
      age: 36,
      sex: 'male',
      barangay_code: '101301001',
      sitio: null,
      contact_number: null,
      sms_consent: false,
      consent_date: null,
      preferred_language: null,
      created_at: '2026-07-30T02:00:00.000Z',
      updated_at: '2026-07-30T02:00:00.000Z',
      ref_barangays: { name: 'Poblacion' },
      users: { full_name: 'Maria Santos', role: 'bhw' },
    },
    screenings: {
      screening_id: 'scr-1',
      patient_id: 'pat-1',
      symptom_flags: { cough_2wks: 'yes', weight_loss: 'no', fever: 'unsure' },
      pgis_severity: 'mild',
      referred: true,
      // Vitals default to unmeasured — the ordinary case, and the one the
      // "nothing recorded" copy has to handle. Tests that care override them.
      ...emptyVitals,
      created_at: '2026-07-31T02:00:00.000Z',
      updated_at: '2026-07-31T02:00:00.000Z',
    },
    ...over,
  };
}

/** Render the detail pane for `referral` and wait for the load to settle. */
async function renderDetail(referral: ReferralJoined, onOpenCase?: (caseId: string) => void) {
  mock.db.referral = referral as unknown as Record<string, unknown>;
  const { rerender } = render(
    <ReferralDetail referralId={referral.referral_id} onBack={() => {}} onOpenCase={onOpenCase} />,
  );
  const box = (await screen.findByPlaceholderText(
    en.detail.resultPlaceholder,
  )) as HTMLTextAreaElement;
  return { box, rerender };
}

/** The notes box as it stands right now — re-queried, because every write
 *  triggers a reload that unmounts and remounts the form. */
const notesBox = () =>
  screen.getByPlaceholderText(en.detail.resultPlaceholder) as HTMLTextAreaElement;

const saveButton = () => screen.getByRole('button', { name: en.detail.saveResult });
const lastUpdate = () => mock.db.updates[mock.db.updates.length - 1];

function makeAppointment(over: Partial<AppointmentRow> = {}): AppointmentRow {
  return {
    appointment_id: 'appt-1',
    patient_id: 'pat-1',
    facility_id: 'fac-1',
    referral_id: 'ref-1',
    tb_case_id: null,
    scheduled_date: '2099-09-20',
    attended_date: null,
    status: 'scheduled',
    created_at: '2026-09-10T00:00:00.000Z',
    updated_at: '2026-09-10T00:00:00.000Z',
    ...over,
  };
}

function makeCase(over: Partial<TbCaseRow> = {}): TbCaseRow {
  return {
    case_id: 'case-1',
    patient_id: 'pat-1',
    referral_id: 'ref-1',
    facility_id: 'fac-1',
    case_number: 'TBC-MLB-2026-00001',
    registration_date: '2026-09-10',
    case_status: 'registered',
    treatment_start_date: null,
    outcome: null,
    outcome_date: null,
    created_by: 'staff-1',
    created_at: '2026-09-10T00:00:00.000Z',
    updated_at: '2026-09-10T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  mock.db.referral = null;
  mock.db.appointments = [];
  mock.db.cases = [];
  mock.db.caseLoadError = null;
  mock.db.updates = [];
  mock.db.selectFilters = [];
  mock.db.inserts = [];
  mock.db.rpcCalls = [];
  mock.db.rpcError = null;
  mock.db.serverResult = undefined;
});

describe('ReferralDetail lab result — loading what was saved', () => {
  it('puts the saved notes back in the textarea', async () => {
    const { box } = await renderDetail(
      makeReferral({
        status: 'tested',
        result: 'GeneXpert: MTB not detected',
        result_outcome: 'negative',
        result_date: '2026-08-10T02:00:00.000Z',
      }),
    );

    expect(box.value).toBe('GeneXpert: MTB not detected');
  });

  it('preselects the outcome toggle that was recorded', async () => {
    await renderDetail(
      makeReferral({ status: 'tested', result_outcome: 'negative', result: 'notes' }),
    );

    // The pressed toggle is marked by an `on` class — that state comes from the
    // loaded row, so an unloaded outcome would leave both toggles off.
    const negative = screen.getByRole('button', { name: en.detail.outcomeNegative });
    const positive = screen.getByRole('button', { name: en.detail.outcomePositive });
    expect(negative.className).toContain('on');
    expect(positive.className).not.toContain('on');
  });

  it('shows an empty box for a result saved with blank notes', async () => {
    const { box } = await renderDetail(
      makeReferral({ status: 'tested', result: null, result_outcome: 'positive' }),
    );

    expect(box.value).toBe('');
    // The outcome still loaded — blank notes must not read as "nothing recorded".
    expect(screen.getByRole('button', { name: en.detail.outcomePositive }).className).toContain(
      'on',
    );
  });

  it('replaces the notes when a different referral is opened', async () => {
    const first = makeReferral({ result: 'first referral notes', result_outcome: 'negative' });
    const { box, rerender } = await renderDetail(first);
    expect(box.value).toBe('first referral notes');

    const second = makeReferral({
      referral_id: 'ref-2',
      result: 'second referral notes',
      result_outcome: 'positive',
    });
    mock.db.referral = second as unknown as Record<string, unknown>;
    rerender(<ReferralDetail referralId="ref-2" onBack={() => {}} />);

    await waitFor(() => {
      expect(notesBox().value).toBe('second referral notes');
    });
  });
});

describe('ReferralDetail lab result — saving', () => {
  it('sends the edited notes and keeps the recorded outcome', async () => {
    const { box } = await renderDetail(
      makeReferral({ status: 'tested', result: 'GeneXpert: pending', result_outcome: 'negative' }),
    );

    fireEvent.change(box, { target: { value: 'GeneXpert: MTB detected, RIF sensitive' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(mock.db.updates).toHaveLength(1));
    expect(lastUpdate()).toMatchObject({
      result: 'GeneXpert: MTB detected, RIF sensitive',
      result_outcome: 'negative',
      status: 'tested',
    });
  });

  it('repaints the box from the reload, not from the local edit', async () => {
    const { box } = await renderDetail(
      makeReferral({ status: 'tested', result: 'old notes', result_outcome: 'negative' }),
    );
    // The server is the last word on what the column holds. Making it differ
    // from what was typed is the only way to prove the box is refilled from
    // the reload — if it merely kept local state, this would still read
    // 'new notes' and the assertion would be meaningless.
    mock.db.serverResult = 'new notes [recorded 10 Aug]';

    fireEvent.change(box, { target: { value: 'new notes' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(mock.db.updates).toHaveLength(1));
    await waitFor(() => {
      expect(notesBox().value).toBe('new notes [recorded 10 Aug]');
    });
  });

  it('stores blank notes as NULL rather than an empty string', async () => {
    await renderDetail(makeReferral({ status: 'tested', result: null, result_outcome: 'positive' }));

    fireEvent.click(saveButton());

    await waitFor(() => expect(mock.db.updates).toHaveLength(1));
    expect(lastUpdate().result).toBeNull();
    expect(lastUpdate().result_outcome).toBe('positive');
  });

  it('treats whitespace-only notes as blank', async () => {
    const { box } = await renderDetail(
      makeReferral({ status: 'tested', result: 'something', result_outcome: 'negative' }),
    );

    fireEvent.change(box, { target: { value: '   \n  ' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(mock.db.updates).toHaveLength(1));
    expect(lastUpdate().result).toBeNull();
  });

  it('cannot save notes with no outcome picked — the outcome is required', async () => {
    const { box } = await renderDetail(makeReferral({ result: null, result_outcome: null }));

    fireEvent.change(box, { target: { value: 'notes without an outcome' } });
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: en.detail.outcomeNegative }));
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(saveButton());
    await waitFor(() => expect(mock.db.updates).toHaveLength(1));
    expect(lastUpdate()).toMatchObject({
      result: 'notes without an outcome',
      result_outcome: 'negative',
    });
  });
});

/**
 * Vital signs (migration 0024) — displayed context, never a verdict.
 *
 * Two things are pinned. First, that the panel renders only what was actually
 * measured and computes BMI from height and weight rather than reading a stored
 * column. Second, and more importantly, that it stays free of interpretation:
 * no "high", no "fever", no colour-by-value. The moment a reading arrives
 * carrying a judgement, this stops being a pre-screening record (§1/§5).
 */
describe('ReferralDetail vital signs', () => {
  it('says so plainly when nothing was measured', async () => {
    await renderDetail(makeReferral());
    expect(screen.getByText(en.vitals.noneRecorded)).toBeTruthy();
  });

  it('shows only the readings that were taken', async () => {
    await renderDetail(
      makeReferral({
        screenings: {
          ...makeReferral().screenings,
          temperature_c: 37.4,
          pulse_rate: 88,
        },
      }),
    );
    expect(screen.getByText('37.4 °C')).toBeTruthy();
    expect(screen.getByText('88 bpm')).toBeTruthy();
    // Height and weight were never taken, so neither they nor a BMI appear.
    expect(screen.queryByText(en.vitals.height)).toBeNull();
    expect(screen.queryByText(en.vitals.bmi)).toBeNull();
  });

  it('derives BMI from height and weight — there is no stored column to read', async () => {
    await renderDetail(
      makeReferral({
        screenings: { ...makeReferral().screenings, height_cm: 170, weight_kg: 65 },
      }),
    );
    expect(screen.getByText('22.5 kg/m²')).toBeTruthy();
  });

  it('needs both halves before it shows a blood pressure', async () => {
    await renderDetail(
      makeReferral({
        screenings: { ...makeReferral().screenings, systolic_bp: 120 },
      }),
    );
    // Half a blood pressure is not a blood pressure, and "120/—" would read as
    // a reading someone took.
    expect(screen.queryByText(en.vitals.bloodPressure)).toBeNull();
  });

  it('states readings without any interpretation (§5)', async () => {
    // Values a scoring system would react to. Everything rendered must be the
    // number and its unit, plus the standing "not used to decide referral" note.
    await renderDetail(
      makeReferral({
        screenings: {
          ...makeReferral().screenings,
          temperature_c: 39.5,
          systolic_bp: 180,
          diastolic_bp: 110,
          spo2_percent: 88,
        },
      }),
    );
    const panel = screen.getByText(en.vitals.heading).closest('.vitals-block') as HTMLElement;
    const VERDICT = /\bhigh\b|\blow\b|normal|abnormal|fever|febrile|hyper|hypo|critical|urgent/i;
    expect(VERDICT.test(panel.textContent ?? '')).toBe(false);
    expect(screen.getByText(en.vitals.contextNote)).toBeTruthy();
  });
});

/**
 * The laboratory sample id (migration 0024) belongs to THIS facility, and the
 * whole point of the referral-model correction is that the BHW app no longer
 * invents one. So the field must not be offered before there is a sample to
 * name — the patient has not arrived yet while the referral is 'submitted'.
 */
describe('ReferralDetail laboratory sample id', () => {
  const sampleField = () =>
    screen.queryByPlaceholderText(en.detail.sampleIdPlaceholder) as HTMLInputElement | null;

  it('is not offered while the referral is still submitted', async () => {
    await renderDetail(makeReferral({ status: 'submitted' }));
    expect(sampleField()).toBeNull();
    expect(screen.getByText(en.detail.sampleIdPending)).toBeTruthy();
  });

  it('saves what staff type once the referral has been received', async () => {
    await renderDetail(makeReferral({ status: 'received' }));
    const field = sampleField() as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'LAB-2026-0091' } });
    fireEvent.click(screen.getByRole('button', { name: en.detail.sampleIdSave }));

    await waitFor(() => expect(mock.db.updates).toHaveLength(1));
    expect(lastUpdate().lab_sample_id).toBe('LAB-2026-0091');
  });

  it('puts an already-saved id back in the field', async () => {
    await renderDetail(makeReferral({ status: 'tested', lab_sample_id: 'LAB-2026-0044' }));
    expect((sampleField() as HTMLInputElement).value).toBe('LAB-2026-0044');
    // Nothing changed, so there is nothing to save.
    expect(
      (screen.getByRole('button', { name: en.detail.sampleIdSave }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('clears the id to NULL rather than an empty string', async () => {
    await renderDetail(makeReferral({ status: 'received', lab_sample_id: 'LAB-2026-0044' }));
    fireEvent.change(sampleField() as HTMLInputElement, { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: en.detail.sampleIdSave }));

    await waitFor(() => expect(mock.db.updates).toHaveLength(1));
    expect(lastUpdate().lab_sample_id).toBeNull();
  });
});

/**
 * A walk-in the facility registered itself (0025) is deliberately an ordinary
 * referral in every respect but one: nobody referred it in. The header line
 * names who registered it instead of claiming a BHW screened them.
 */
describe('ReferralDetail referral origin', () => {
  it('credits the BHW who screened a referred patient', async () => {
    await renderDetail(makeReferral());
    expect(screen.getByText(en.detail.screenedBy.replace('{{name}}', 'Maria Santos'))).toBeTruthy();
  });

  it('says a walk-in was registered here, not screened by a BHW', async () => {
    const base = makeReferral();
    await renderDetail(
      makeReferral({
        status: 'received',
        patients: { ...base.patients, users: { full_name: 'Nurse Ana Lim', role: 'tb_dots' } },
      }),
    );
    expect(
      screen.getByText(en.detail.registeredHere.replace('{{name}}', 'Nurse Ana Lim')),
    ).toBeTruthy();
    expect(screen.queryByText(/Screened by/)).toBeNull();
  });
});

describe('ReferralDetail appointment ownership', () => {
  it('loads only appointments owned by the open referral', async () => {
    await renderDetail(makeReferral({ referral_id: 'ref-owned' }));
    expect(mock.db.selectFilters).toContainEqual(['appointments', 'referral_id', 'ref-owned']);
    expect(mock.db.selectFilters).not.toContainEqual(['appointments', 'patient_id', 'pat-1']);
  });

  it('writes the referral and facility when scheduling', async () => {
    await renderDetail(makeReferral());
    fireEvent.click(screen.getByRole('button', { name: en.detail.scheduleBtn }));
    fireEvent.change(screen.getByLabelText(en.detail.scheduleDateLabel), {
      target: { value: '2099-09-20' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.detail.scheduleConfirm }));

    await waitFor(() => expect(mock.db.inserts).toHaveLength(1));
    expect(mock.db.inserts[0]).toMatchObject({
      patient_id: 'pat-1',
      facility_id: 'fac-1',
      referral_id: 'ref-1',
      scheduled_date: '2099-09-20',
    });
  });

  it('cancels a scheduled appointment without recording attendance', async () => {
    mock.db.appointments = [makeAppointment()];
    await renderDetail(makeReferral());
    fireEvent.click(screen.getByRole('button', { name: en.detail.cancelAppointment }));

    await waitFor(() => expect(mock.db.updates).toHaveLength(1));
    expect(lastUpdate()).toEqual({ attended_date: null, status: 'cancelled' });
  });

  it('renders a cancelled appointment as an inactive state', async () => {
    mock.db.appointments = [makeAppointment({ status: 'cancelled' })];
    await renderDetail(makeReferral());
    expect(screen.getByText(en.detail.apptCancelled)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.detail.markAttended })).toBeNull();
  });
});

describe('ReferralDetail TB case enrolment', () => {
  it('does not offer case creation before the patient is received', async () => {
    await renderDetail(makeReferral({ status: 'submitted' }));
    expect(screen.queryByRole('button', { name: en.detail.createCase })).toBeNull();
    expect(screen.getByText(en.detail.caseArrivalRequired)).toBeTruthy();
  });

  it('does not offer creation when the existing-case lookup failed', async () => {
    mock.db.caseLoadError = { message: 'network unavailable' };
    await renderDetail(makeReferral());
    expect(screen.queryByRole('button', { name: en.detail.createCase })).toBeNull();
    expect(screen.getByText(en.detail.caseLookupError)).toBeTruthy();
  });

  it('creates a clinician-enrolled case through the idempotent RPC', async () => {
    const openCase = vi.fn();
    await renderDetail(makeReferral({ status: 'received' }), openCase);
    mock.db.cases = [makeCase()];
    fireEvent.click(screen.getByRole('button', { name: en.detail.createCase }));

    await waitFor(() => expect(mock.db.rpcCalls).toHaveLength(1));
    const [name, payload] = mock.db.rpcCalls[0];
    expect(name).toBe('create_tb_case');
    expect(payload).toMatchObject({
      p_patient_id: 'pat-1',
      p_referral_id: 'ref-1',
    });
    expect(payload.p_request_id).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(openCase).toHaveBeenCalledWith('case-1'));
  });

  it('keeps the same request id when a failed create is retried', async () => {
    mock.db.rpcError = { message: 'this patient already has an open TB case' };
    await renderDetail(makeReferral({ status: 'tested' }));
    const button = screen.getByRole('button', { name: en.detail.createCase });
    fireEvent.click(button);
    await waitFor(() => expect(mock.db.rpcCalls).toHaveLength(1));
    fireEvent.click(button);
    await waitFor(() => expect(mock.db.rpcCalls).toHaveLength(2));
    expect(mock.db.rpcCalls[1][1].p_request_id).toBe(mock.db.rpcCalls[0][1].p_request_id);
    expect(screen.getByRole('alert').textContent).toContain('already has an open TB case');
  });

  it('opens an existing case instead of offering a duplicate', async () => {
    const openCase = vi.fn();
    mock.db.cases = [makeCase()];
    await renderDetail(makeReferral(), openCase);
    expect(screen.queryByRole('button', { name: en.detail.createCase })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.detail.openCase }));
    expect(openCase).toHaveBeenCalledWith('case-1');
  });
});
