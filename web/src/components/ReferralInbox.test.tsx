/**
 * ReferralInbox — the repeat-referral marker.
 *
 * The inbox is a referral QUEUE: one row per referral, not per patient. A
 * patient screened a second time therefore appears twice, and that is correct —
 * the facility needs the new referral as its own work item while the old one
 * keeps the outcome it recorded. It has already been read once as a duplicated
 * patient, so these tests pin the marker that tells the two apart.
 *
 * What is worth pinning: the numbering is derived from `rows` (everything
 * loaded) and not from `visible` (what survives the filter), and it sorts on
 * created_at rather than trusting the query's order. Both are invisible from
 * the rendered output in the happy path and both are easy to "simplify" away.
 *
 * §1/§5 note: the marker is a fact about the queue — how many times this
 * facility has been referred this patient. It computes nothing clinical, does
 * not colour a row, and never feeds the referral decision.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from '../i18n/locales/en';
import type { ReferralJoined, ReferralStatus } from '../lib/types';
import ReferralInbox from './ReferralInbox';

/**
 * Fake PostgREST. Hoisted because vi.mock's factory runs before the module
 * body. Only the one chain ReferralInbox builds is modelled:
 *   referrals .select().order()
 */
const mock = vi.hoisted(() => {
  const db = { rows: [] as unknown[] };
  const supabase = {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: db.rows, error: null }),
      }),
    }),
  };
  return { db, supabase };
});

// ../lib/supabase throws at import time without VITE_SUPABASE_URL, so the mock
// is what lets this component be rendered at all.
vi.mock('../lib/supabase', () => ({ supabase: mock.supabase }));

interface RowSpec {
  id: string;
  patient: string;
  at: string;
  status?: ReferralStatus;
}

/** A joined referral row as the inbox query returns it. */
function makeRow({ id, patient, at, status = 'submitted' }: RowSpec): ReferralJoined {
  return {
    referral_id: id,
    patient_id: patient,
    screening_id: `scr-${id}`,
    facility_id: 'fac-1',
    lab_sample_id: null,
    status,
    result: null,
    result_outcome: null,
    result_date: null,
    presented: true,
    created_at: at,
    updated_at: at,
    patients: {
      patient_id: patient,
      display_code: `BUK-${patient}`,
      enrolled_by: 'usr-bhw',
      full_name: `Patient ${patient}`,
      first_name: 'Patient',
      middle_name: null,
      last_name: patient,
      birthdate: '1990-01-01',
      age: 36,
      sex: 'male',
      barangay_code: '101301001',
      sitio: null,
      contact_number: null,
      sms_consent: false,
      consent_date: null,
      preferred_language: null,
      created_at: '2026-07-01T02:00:00.000Z',
      updated_at: '2026-07-01T02:00:00.000Z',
      ref_barangays: { name: 'Poblacion' },
      users: { full_name: 'Maria Santos' },
    },
    screenings: {
      screening_id: `scr-${id}`,
      patient_id: patient,
      symptom_flags: { cough_2wks: 'yes' },
      pgis_severity: 'mild',
      referred: true,
      created_at: at,
      updated_at: at,
    },
  } as unknown as ReferralJoined;
}

/**
 * Render the inbox over `specs` and wait for the load to settle. Rows are
 * handed over newest-first, the way `.order('created_at', ascending: false)`
 * returns them, unless a test deliberately says otherwise.
 */
async function renderInbox(specs: RowSpec[]) {
  mock.db.rows = specs.map(makeRow);
  const { container } = render(<ReferralInbox onOpen={() => {}} selectedId={null} />);
  await waitFor(() =>
    expect(container.querySelectorAll('.inbox-row:not(.skel)')).toHaveLength(specs.length),
  );
  return {
    /** Rendered rows in display order. */
    rows: () => Array.from(container.querySelectorAll<HTMLElement>('.inbox-row:not(.skel)')),
  };
}

const markerOf = (row: HTMLElement) => row.querySelector<HTMLElement>('.repeat-pill');

/** The hint the marker carries for an nth referral, read from the locale. */
const hintFor = (ordinal: number) =>
  en.inbox.repeatReferralHint.replace('{{ordinal}}', String(ordinal));

beforeEach(() => {
  mock.db.rows = [];
});

describe('ReferralInbox repeat-referral marker', () => {
  it('marks the second referral and leaves the first unmarked', async () => {
    const { rows } = await renderInbox([
      { id: 'r2', patient: 'pat-1', at: '2026-08-24T09:13:00.000Z' },
      { id: 'r1', patient: 'pat-1', at: '2026-07-29T01:00:00.000Z' },
    ]);

    const [newer, older] = rows();
    expect(markerOf(newer)).not.toBeNull();
    expect(markerOf(newer)?.textContent).toBe(en.inbox.repeatReferral);
    expect(markerOf(older)).toBeNull();
  });

  it('leaves patients with a single referral each unmarked', async () => {
    const { rows } = await renderInbox([
      { id: 'r2', patient: 'pat-2', at: '2026-08-24T09:18:00.000Z' },
      { id: 'r1', patient: 'pat-1', at: '2026-07-29T01:00:00.000Z' },
    ]);

    expect(rows().map(markerOf)).toEqual([null, null]);
  });

  it('counts how many referrals deep this one is', async () => {
    const { rows } = await renderInbox([
      { id: 'r3', patient: 'pat-1', at: '2026-08-24T09:13:00.000Z' },
      { id: 'r2', patient: 'pat-1', at: '2026-08-01T01:00:00.000Z' },
      { id: 'r1', patient: 'pat-1', at: '2026-07-29T01:00:00.000Z' },
    ]);

    const [third, second, first] = rows();
    expect(markerOf(third)?.title).toBe(hintFor(3));
    expect(markerOf(second)?.title).toBe(hintFor(2));
    expect(markerOf(first)).toBeNull();
  });

  it('numbers by referral date, not by the order the rows arrive', async () => {
    // Deliberately handed over oldest-first. Numbering that trusted the array
    // order would mark the oldest referral as the repeat — exactly backwards.
    const { rows } = await renderInbox([
      { id: 'r1', patient: 'pat-1', at: '2026-07-29T01:00:00.000Z' },
      { id: 'r2', patient: 'pat-1', at: '2026-08-24T09:13:00.000Z' },
    ]);

    const [oldestFirst, newestSecond] = rows();
    expect(markerOf(oldestFirst)).toBeNull();
    expect(markerOf(newestSecond)?.title).toBe(hintFor(2));
  });

  it('keeps the numbering when a status filter hides the earlier referral', async () => {
    const { rows } = await renderInbox([
      { id: 'r2', patient: 'pat-1', at: '2026-08-24T09:13:00.000Z', status: 'submitted' },
      { id: 'r1', patient: 'pat-1', at: '2026-07-29T01:00:00.000Z', status: 'tested' },
    ]);

    fireEvent.change(screen.getByLabelText(en.inbox.statusFilter), {
      target: { value: 'submitted' },
    });

    // Only the newer referral is left on screen. It is still that patient's
    // second — a filter changes what is shown, never what happened.
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(markerOf(rows()[0])?.title).toBe(hintFor(2));
  });

  it('opens directly on the dashboard awaiting-action queue', async () => {
    mock.db.rows = [
      makeRow({ id: 'submitted', patient: 'pat-1', at: '2026-09-10T01:00:00Z' }),
      makeRow({ id: 'received', patient: 'pat-2', at: '2026-09-09T01:00:00Z', status: 'received' }),
      makeRow({ id: 'tested', patient: 'pat-3', at: '2026-09-08T01:00:00Z', status: 'tested' }),
    ];
    const { container } = render(
      <ReferralInbox onOpen={() => {}} selectedId={null} initialFilter="awaiting" />,
    );
    await waitFor(() => expect(container.querySelectorAll('.inbox-row:not(.skel)')).toHaveLength(2));
    expect((screen.getByLabelText(en.inbox.statusFilter) as HTMLSelectElement).value).toBe('awaiting');
    expect(screen.queryByText('Patient pat-3')).toBeNull();
  });
});
