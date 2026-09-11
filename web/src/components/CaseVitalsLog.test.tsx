import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from '../i18n/locales/en';
import type { CaseVitalsRow } from '../lib/types';
import CaseVitalsLog from './CaseVitalsLog';

const mock = vi.hoisted(() => {
  const state = {
    rows: [] as unknown[],
    inserts: [] as Array<[string, Record<string, unknown>]>,
    rpcCalls: [] as Array<[string, Record<string, unknown>]>,
  };
  const supabase = {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => Promise.resolve({ data: state.rows, error: null }),
        insert(fields: Record<string, unknown>) {
          state.inserts.push([table, fields]);
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
    rpc(name: string, fields: Record<string, unknown>) {
      state.rpcCalls.push([name, fields]);
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { state, supabase };
});

vi.mock('../lib/supabase', () => ({ supabase: mock.supabase }));

const row = (over: Partial<CaseVitalsRow> = {}): CaseVitalsRow => ({
  vitals_id: 'vitals-1', case_id: 'case-1', measured_on: '2026-09-10',
  height_cm: 160, weight_kg: 51.5, temperature_c: null, systolic_bp: null,
  diastolic_bp: null, pulse_rate: null, spo2_percent: null, recorded_by: 'staff-1',
  created_at: '2026-09-10T00:00:00Z', voided_at: null, voided_by: null, void_reason: null,
  ...over,
});

const props = { caseId: 'case-1', caseStatus: 'on_treatment' as const, registrationDate: '2026-09-01', outcomeDate: null };
const label = (key: 'weight' | 'height' | 'temperature', unit: 'unitKg' | 'unitCm' | 'unitC') =>
  `${en.vitals[key]} (${en.vitals[unit]})`;

beforeEach(() => {
  mock.state.rows = [];
  mock.state.inserts = [];
  mock.state.rpcCalls = [];
});

describe('CaseVitalsLog', () => {
  it('lists measurements with units and a derived BMI', async () => {
    mock.state.rows = [row()];
    render(<CaseVitalsLog {...props} />);
    expect(await screen.findByText(`51.5 ${en.vitals.unitKg}`)).toBeTruthy();
    expect(screen.getByText(`20.1 ${en.vitals.unitBmi}`)).toBeTruthy();
  });

  it('will not save an empty or out-of-range set', async () => {
    render(<CaseVitalsLog {...props} />);
    await screen.findByText(en.cases.vitalsLog.empty);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.cases.vitalsLog.add) }));
    const save = screen.getByRole('button', { name: en.cases.vitalsLog.save }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(label('weight', 'unitKg')), { target: { value: '900' } });
    expect(save.disabled).toBe(true);
    expect(screen.getByText(en.vitals.outOfRange)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(label('weight', 'unitKg')), { target: { value: '48,6' } });
    expect(save.disabled).toBe(false);
  });

  it('inserts parsed numbers and leaves unmeasured fields null', async () => {
    render(<CaseVitalsLog {...props} />);
    await screen.findByText(en.cases.vitalsLog.empty);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.cases.vitalsLog.add) }));
    fireEvent.change(screen.getByLabelText(en.cases.vitalsLog.measuredOn), { target: { value: '2026-09-05' } });
    fireEvent.change(screen.getByLabelText(label('weight', 'unitKg')), { target: { value: '52.35' } });
    fireEvent.change(screen.getByLabelText(label('temperature', 'unitC')), { target: { value: '37' } });
    fireEvent.click(screen.getByRole('button', { name: en.cases.vitalsLog.save }));

    await waitFor(() => expect(mock.state.inserts).toHaveLength(1));
    const [table, fields] = mock.state.inserts[0];
    expect(table).toBe('case_vitals');
    expect(fields).toMatchObject({
      case_id: 'case-1', measured_on: '2026-09-05', weight_kg: 52.4, temperature_c: 37,
      height_cm: null, systolic_bp: null, diastolic_bp: null, pulse_rate: null, spo2_percent: null,
    });
    expect(fields).not.toHaveProperty('recorded_by');
  });

  it('voids through the RPC with a reason', async () => {
    mock.state.rows = [row()];
    render(<CaseVitalsLog {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: en.cases.visit.voidRecord }));
    fireEvent.change(screen.getByLabelText(en.cases.visit.voidReason), { target: { value: 'Scale error' } });
    fireEvent.click(screen.getByRole('button', { name: en.cases.visit.confirmVoid }));
    await waitFor(() => expect(mock.state.rpcCalls).toEqual([
      ['void_case_vitals', { p_vitals_id: 'vitals-1', p_reason: 'Scale error' }],
    ]));
  });

  it('shows measurements without any interpretation', async () => {
    mock.state.rows = [row({ weight_kg: 38, temperature_c: 39.5 })];
    const { container } = render(<CaseVitalsLog {...props} />);
    await screen.findByText(`38.0 ${en.vitals.unitKg}`);
    expect(container.textContent ?? '').not.toMatch(/\b(underweight|fever|febrile|normal|abnormal|high|low)\b/i);
  });
});
