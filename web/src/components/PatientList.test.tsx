import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PatientList from './PatientList';
import { en } from '../i18n/locales/en';

const mock = vi.hoisted(() => {
  const patient = { patient_id: 'p1', display_code: 'PAT-001', full_name: 'Maria Santos', first_name: 'Maria', middle_name: null, last_name: 'Santos', birthdate: '1990-05-04', age: 36, sex: 'female', barangay_code: '101', sitio: 'Hill', sms_consent: true, contact_number: '09171234567', preferred_language: 'en', updated_at: '2026-09-01T00:00:00Z' };
  const state = { error: null as { code: string } | null, loadError: false, args: [] as unknown[], ranges: [] as unknown[], search: '', count: 26 };
  return { patient, state, supabase: {
    from(table: string) {
      const result = () => ({ data: table === 'patients' ? [patient] : table === 'referrals' ? [{ referral_id: 'r1', created_at: '2026-09-01', status: 'submitted' }] : table === 'tb_cases' ? [{ case_id: 'c1', case_number: 'CASE-001' }] : { name: 'Poblacion', ref_cities: { name: 'Valencia' } }, error: state.loadError ? { message: 'failed' } : null, count: state.count });
      const q = { select: () => q, order: () => q, eq: () => q, limit: () => q, range: (a: number, b: number) => { state.ranges.push([a,b]); return q; }, or: (v: string) => { state.search = v; return q; }, maybeSingle: () => Promise.resolve(result()), then: (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
      return q;
    },
    rpc(name: string, args: Record<string, unknown>) { state.args.push([name, args]); return Promise.resolve({ error: state.error, data: { ...patient, first_name: args.p_first_name, full_name: `${args.p_first_name} Santos`, updated_at: '2026-09-17T00:00:00Z' } }); },
  } };
});
vi.mock('../lib/supabase', () => ({ supabase: mock.supabase }));
vi.mock('./PatientTimeline', () => ({ default: () => <div>Timeline</div> }));
const props = { onRegister: vi.fn(), onOpenReferral: vi.fn(), onOpenCase: vi.fn() };
beforeEach(() => { mock.state.args = []; mock.state.ranges = []; mock.state.error = null; mock.state.loadError = false; mock.state.search = ''; mock.state.count = 26; vi.clearAllMocks(); });
async function open() { render(<PatientList {...props} />); fireEvent.click(await screen.findByRole('button', { name: 'View patient Maria Santos' })); }
describe('PatientList', () => {
  it('paginates on the server and searches safely', async () => {
    render(<PatientList {...props} />);
    await screen.findByText('Maria Santos');
    fireEvent.click(screen.getByText(en.patients.next));
    await waitFor(() => expect(mock.state.ranges).toContainEqual([25,49]));
    fireEvent.change(screen.getByLabelText(en.patients.search), { target: { value: 'Maria' } });
    fireEvent.click(screen.getByRole('button', { name: en.patients.searchButton }));
    await waitFor(() => expect(mock.state.search).toBe('full_name.ilike.%Maria%,display_code.ilike.%Maria%'));
  });
  it('opens existing clinical workflows', async () => {
    await open();
    fireEvent.click(await screen.findByRole('button', { name: /Open referral/ }));
    expect(props.onOpenReferral).toHaveBeenCalledWith('r1');
    fireEvent.click(screen.getByText('CASE-001')); expect(props.onOpenCase).toHaveBeenCalledWith('c1');
  });
  it('requires confirmation and clears SMS data when consent is withdrawn', async () => {
    await open(); fireEvent.click(screen.getByText(en.patients.edit));
    expect((screen.getByText(en.patients.save) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(en.register.smsOptIn));
    fireEvent.click(screen.getByLabelText(en.patients.confirm));
    fireEvent.click(screen.getByText(en.patients.save));
    await screen.findByText(en.patients.saved);
    expect(mock.state.args).toContainEqual(['update_facility_patient', expect.objectContaining({ p_expected_updated_at: mock.patient.updated_at, p_sms_consent: false, p_contact_number: null, p_preferred_language: null })]);
  });
  it.each([['40001', en.patients.stale], ['23505', en.patients.duplicate], ['PGRST202', en.patients.migration]])('retains edits on %s errors', async (code, message) => {
    mock.state.error = { code };
    await open(); fireEvent.click(screen.getByText(en.patients.edit));
    fireEvent.change(screen.getByLabelText(en.register.firstName), { target: { value: 'Marie' } });
    fireEvent.click(screen.getByLabelText(en.patients.confirm)); fireEvent.click(screen.getByText(en.patients.save));
    await screen.findByText(message); expect((screen.getByLabelText(en.register.firstName) as HTMLInputElement).value).toBe('Marie');
  });
  it('shows load errors instead of an empty success', async () => {
    mock.state.loadError = true; render(<PatientList {...props} />);
    await screen.findByRole('alert'); expect(screen.queryByText(en.patients.empty)).toBeNull();
  });
});
