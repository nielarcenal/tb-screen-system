import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from '../i18n/locales/en';
import type { AuditEventRow } from '../lib/types';
import AuditLog from './AuditLog';

const PAGE_SIZE = 25;

const mock = vi.hoisted(() => {
  const state = {
    pages: [] as AuditEventRow[][],
    error: null as { message: string } | null,
    calls: [] as Array<Record<string, unknown>>,
  };
  return {
    state,
    supabase: {
      rpc(_name: string, fields: Record<string, unknown>) {
        state.calls.push(fields);
        if (state.error) return Promise.resolve({ data: null, error: state.error });
        const page = state.pages.shift() ?? [];
        return Promise.resolve({ data: page, error: null });
      },
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mock.supabase }));

function row(over: Partial<AuditEventRow> = {}): AuditEventRow {
  return {
    audit_id: 'audit-1',
    entity_table: 'appointments',
    entity_id: 'appt-1',
    action: 'updated',
    actor_user_id: 'staff-1',
    actor_role: 'tb_dots',
    actor_name: 'Ana Reyes',
    patient_id: 'patient-1',
    facility_id: 'fac-1',
    changes: { status: { from: 'scheduled', to: 'missed' } },
    occurred_at: '2026-09-10T02:00:00Z',
    ...over,
  };
}

/** A full page, so the component believes more may follow. */
function fullPage(prefix: string): AuditEventRow[] {
  return Array.from({ length: PAGE_SIZE }, (_, i) =>
    row({ audit_id: `${prefix}-${i}`, entity_id: `${prefix}-entity-${i}` }),
  );
}

beforeEach(() => {
  mock.state.pages = [];
  mock.state.error = null;
  mock.state.calls = [];
});

describe('AuditLog', () => {
  it('renders a change as a readable transition, never as raw JSON', async () => {
    mock.state.pages = [[row()]];
    render(<AuditLog />);

    expect(await screen.findByText(en.audit.action.updated)).toBeTruthy();

    // Scoped to the list: the entity label is also a filter chip, so a bare
    // getByText would resolve to two nodes and the assertion would say nothing
    // about what was rendered for the row.
    const list = document.querySelector('.audit-list') as HTMLElement;
    expect(within(list).getByText(en.audit.entity.appointments)).toBeTruthy();
    expect(within(list).getByText(en.audit.field.status)).toBeTruthy();
    expect(within(list).getByText(/scheduled/)).toBeTruthy();
    expect(within(list).getByText(/missed/)).toBeTruthy();

    // The raw payload must not reach the page.
    expect(document.body.textContent).not.toContain('{"from"');
    expect(document.body.textContent).not.toContain('[object Object]');
  });

  it('shortens uuids and names a null side rather than printing "null"', async () => {
    mock.state.pages = [[
      row({
        changes: {
          facility_id: { from: null, to: '3f2b9c11-1111-2222-3333-444455556666' },
        },
      }),
    ]];
    render(<AuditLog />);

    expect(await screen.findByText(en.audit.field.facility_id)).toBeTruthy();
    const text = document.body.textContent ?? '';
    expect(text).toContain(en.audit.notSet);
    expect(text).toContain('3f2b9c11…');
    expect(text).not.toContain('3f2b9c11-1111-2222-3333-444455556666');
    expect(text).not.toContain('null');
  });

  it('falls back to the role, then to a system label, when no actor name resolves', async () => {
    mock.state.pages = [[
      row({ audit_id: 'a', actor_name: null, actor_role: 'tb_dots' }),
      row({ audit_id: 'b', actor_name: null, actor_role: null, actor_user_id: null }),
    ]];
    render(<AuditLog />);

    await screen.findByText(en.audit.byRole.replace('{{role}}', 'tb_dots'));
    expect(screen.getByText(en.audit.bySystem)).toBeTruthy();
  });

  it('pages with a keyset cursor taken from the last row, not an offset', async () => {
    const first = fullPage('p1');
    mock.state.pages = [first, [row({ audit_id: 'p2-0' })]];
    render(<AuditLog />);

    await screen.findByText(en.audit.loadMore);
    expect(mock.state.calls[0].p_before_at).toBeNull();
    expect(mock.state.calls[0].p_before_id).toBeNull();

    fireEvent.click(screen.getByText(en.audit.loadMore));

    await waitFor(() => expect(mock.state.calls.length).toBe(2));
    const last = first[first.length - 1];
    expect(mock.state.calls[1].p_before_at).toBe(last.occurred_at);
    expect(mock.state.calls[1].p_before_id).toBe(last.audit_id);
    // Rows accumulate rather than replacing the page.
    await waitFor(() => expect(screen.queryByText(en.audit.loadMore)).toBeNull());
    expect(screen.getByText(en.audit.end)).toBeTruthy();
  });

  it('stops offering more once a short page comes back', async () => {
    mock.state.pages = [[row()]];
    render(<AuditLog />);

    expect(await screen.findByText(en.audit.end)).toBeTruthy();
    expect(screen.queryByText(en.audit.loadMore)).toBeNull();
  });

  it('sends the entity filter and resets the cursor when it changes', async () => {
    mock.state.pages = [[row()], [row({ audit_id: 'ref-1', entity_table: 'referrals' })]];
    render(<AuditLog />);

    await screen.findByText(en.audit.action.updated);
    expect(mock.state.calls[0].p_entity_table).toBeNull();

    fireEvent.click(screen.getByText(en.audit.entity.referrals));

    await waitFor(() => expect(mock.state.calls.length).toBe(2));
    expect(mock.state.calls[1].p_entity_table).toBe('referrals');
    // A filter change starts a new scan; carrying the old cursor would skip rows.
    expect(mock.state.calls[1].p_before_at).toBeNull();
    expect(mock.state.calls[1].p_before_id).toBeNull();
  });

  it('shows an empty state rather than an error when the facility has no events', async () => {
    mock.state.pages = [[]];
    render(<AuditLog />);

    expect(await screen.findByText(en.audit.empty)).toBeTruthy();
  });

  it('surfaces a load failure with a retry that calls again', async () => {
    mock.state.error = { message: 'permission denied' };
    render(<AuditLog />);

    expect(await screen.findByText(en.audit.loadError)).toBeTruthy();
    expect(screen.getByText('permission denied')).toBeTruthy();

    mock.state.error = null;
    mock.state.pages = [[row()]];
    fireEvent.click(screen.getByText(en.inbox.retry));

    expect(await screen.findByText(en.audit.action.updated)).toBeTruthy();
  });

  it('renders an event with no field changes without crashing', async () => {
    mock.state.pages = [[row({ changes: {} })]];
    render(<AuditLog />);

    expect(await screen.findByText(en.audit.noFields)).toBeTruthy();
  });
});
