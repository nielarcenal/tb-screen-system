import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from '../i18n/locales/en';
import type { CaseLabResultRow } from '../lib/types';
import CaseLabResults from './CaseLabResults';

const mock = vi.hoisted(() => {
  const state = {
    rows: [] as unknown[],
    inserts: [] as Array<[string, Record<string, unknown>]>,
    insertError: null as { message: string; code?: string } | null,
    rpcCalls: [] as Array<[string, Record<string, unknown>]>,
    rpcError: null as { message: string } | null,
  };
  const supabase = {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => Promise.resolve({ data: state.rows, error: null }),
        insert(fields: Record<string, unknown>) {
          state.inserts.push([table, fields]);
          return Promise.resolve({ data: null, error: state.insertError });
        },
      };
      return builder;
    },
    rpc(name: string, fields: Record<string, unknown>) {
      state.rpcCalls.push([name, fields]);
      return Promise.resolve({ data: null, error: state.rpcError });
    },
  };
  return { state, supabase };
});

vi.mock('../lib/supabase', () => ({ supabase: mock.supabase }));

const row = (over: Partial<CaseLabResultRow> = {}): CaseLabResultRow => ({
  lab_result_id: 'lab-1', case_id: 'case-1', test_type: 'smear', purpose: 'month_2',
  result_date: '2026-09-10', result_outcome: 'negative', lab_sample_id: 'LAB-9',
  notes: null, recorded_by: 'staff-1', created_at: '2026-09-10T00:00:00Z',
  voided_at: null, voided_by: null, void_reason: null, ...over,
});

beforeEach(() => {
  mock.state.rows = [];
  mock.state.inserts = [];
  mock.state.insertError = null;
  mock.state.rpcCalls = [];
  mock.state.rpcError = null;
});

describe('CaseLabResults', () => {
  it('lists recorded results with their treatment point and value', async () => {
    mock.state.rows = [row()];
    render(<CaseLabResults caseId="case-1" caseStatus="on_treatment" />);
    expect(await screen.findByText(new RegExp(en.cases.lab.purpose.month_2))).toBeTruthy();
    expect(screen.getByText(en.cases.lab.test.smear)).toBeTruthy();
    expect(screen.getByText(en.cases.lab.outcome.negative)).toBeTruthy();
    expect(screen.getByText('LAB-9')).toBeTruthy();
  });

  it('requires a result before saving, then inserts only client-writable columns', async () => {
    render(<CaseLabResults caseId="case-1" caseStatus="on_treatment" />);
    await screen.findByText(en.cases.lab.empty);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.cases.lab.add) }));

    const save = screen.getByRole('button', { name: en.cases.lab.save }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(en.cases.lab.purposeLabel), { target: { value: 'month_5' } });
    fireEvent.change(screen.getByLabelText(en.cases.lab.sampleId), { target: { value: ' LAB-22 ' } });
    fireEvent.click(screen.getByRole('button', { name: en.cases.lab.outcome.negative }));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(mock.state.inserts).toHaveLength(1));
    const [table, fields] = mock.state.inserts[0];
    expect(table).toBe('case_lab_results');
    expect(fields).toMatchObject({
      case_id: 'case-1', test_type: 'smear', purpose: 'month_5',
      result_outcome: 'negative', lab_sample_id: 'LAB-22', notes: null,
    });
    // The author and the void fields come from the server, never the client.
    expect(fields).not.toHaveProperty('recorded_by');
    expect(fields).not.toHaveProperty('voided_at');
  });

  it('treats a replayed insert of its own id as saved', async () => {
    mock.state.insertError = { message: 'duplicate key', code: '23505' };
    render(<CaseLabResults caseId="case-1" caseStatus="on_treatment" />);
    await screen.findByText(en.cases.lab.empty);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.cases.lab.add) }));
    fireEvent.click(screen.getByRole('button', { name: en.cases.lab.outcome.positive }));
    fireEvent.click(screen.getByRole('button', { name: en.cases.lab.save }));
    await waitFor(() => expect(screen.queryByRole('button', { name: en.cases.lab.save })).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a real insert error and keeps the form open', async () => {
    mock.state.insertError = { message: 'result date is in the future' };
    render(<CaseLabResults caseId="case-1" caseStatus="on_treatment" />);
    await screen.findByText(en.cases.lab.empty);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.cases.lab.add) }));
    fireEvent.click(screen.getByRole('button', { name: en.cases.lab.outcome.invalid }));
    fireEvent.click(screen.getByRole('button', { name: en.cases.lab.save }));
    expect((await screen.findByRole('alert')).textContent).toContain('result date is in the future');
    expect(screen.getByRole('button', { name: en.cases.lab.save })).toBeTruthy();
  });

  it('voids through the audited RPC and only with a reason', async () => {
    mock.state.rows = [row()];
    render(<CaseLabResults caseId="case-1" caseStatus="closed" />);
    fireEvent.click(await screen.findByRole('button', { name: en.cases.visit.voidRecord }));
    const confirm = screen.getByRole('button', { name: en.cases.visit.confirmVoid }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(en.cases.visit.voidReason), { target: { value: ' Wrong patient ' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mock.state.rpcCalls).toEqual([
      ['void_case_lab_result', { p_lab_result_id: 'lab-1', p_reason: 'Wrong patient' }],
    ]));
  });

  it('offers no new entry on a cancelled case', async () => {
    render(<CaseLabResults caseId="case-1" caseStatus="cancelled" />);
    await screen.findByText(en.cases.lab.empty);
    expect(screen.queryByRole('button', { name: new RegExp(en.cases.lab.add) })).toBeNull();
  });
});
