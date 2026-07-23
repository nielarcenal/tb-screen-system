/**
 * Admin view: provision TB-DOTS STAFF accounts. Each staff account belongs to
 * one facility — that facility_id is what scopes their whole portal (inbox,
 * dashboard, results). Same machinery as captain management: list reads users
 * rows (users_admin_read), writes go through the manage-bhw Edge Function
 * (target_role 'tb_dots'), temp password shown once.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';

interface StaffRow {
  user_id: string;
  full_name: string;
  facility_id: string;
  active: boolean;
  facilities: { name: string } | null;
}

interface FacilityOption {
  facility_id: string;
  name: string;
}

type View =
  | { kind: 'list' }
  | { kind: 'form'; editing: StaffRow | null }
  | { kind: 'created'; email: string; tempPassword: string; name: string; reset?: boolean }
  | { kind: 'confirmDeactivate'; target: StaffRow };

export default function StaffManagement() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [facilities, setFacilities] = useState<FacilityOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [formFirst, setFormFirst] = useState('');
  const [formLast, setFormLast] = useState('');
  const [formFacility, setFormFacility] = useState('');
  // List navigation: show one facility's accounts (facilities can have many
  // staff) or all of them.
  const [facilityFilter, setFacilityFilter] = useState<'all' | string>('all');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [{ data, error: err }, { data: fac, error: fErr }] = await Promise.all([
      supabase
        .from('users')
        .select('user_id, full_name, facility_id, active, facilities(name)')
        .eq('role', 'tb_dots')
        .order('full_name'),
      supabase
        .from('facilities')
        .select('facility_id, name')
        .eq('type', 'tb_dots')
        .order('name'),
    ]);
    if (err) setError(err.message);
    else setRows((data ?? []) as unknown as StaffRow[]);
    if (fErr) setError(fErr.message);
    else setFacilities((fac ?? []) as FacilityOption[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const invoke = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const { data, error: err } = await supabase.functions.invoke('manage-bhw', {
      body: { ...body, target_role: 'tb_dots' },
    });
    if (err) throw new Error(err.message);
    const parsed = (data ?? {}) as Record<string, unknown>;
    if (parsed.error) throw new Error(String(parsed.error));
    return parsed;
  };

  const openAdd = () => {
    setFormFirst('');
    setFormLast('');
    // When the list is filtered to one facility, new accounts default to it.
    setFormFacility(
      facilityFilter !== 'all' ? facilityFilter : (facilities[0]?.facility_id ?? ''),
    );
    setView({ kind: 'form', editing: null });
  };

  const openEdit = (row: StaffRow) => {
    const [first, ...rest] = row.full_name.trim().split(/\s+/);
    setFormFirst(first ?? '');
    setFormLast(rest.join(' '));
    setFormFacility(row.facility_id);
    setView({ kind: 'form', editing: row });
  };

  const submitForm = async (editing: StaffRow | null) => {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await invoke({
          action: 'update',
          user_id: editing.user_id,
          first_name: formFirst,
          last_name: formLast,
          facility_id: formFacility,
        });
        setView({ kind: 'list' });
      } else {
        const res = await invoke({
          action: 'create',
          first_name: formFirst,
          last_name: formLast,
          facility_id: formFacility,
        });
        setView({
          kind: 'created',
          email: String(res.email ?? ''),
          tempPassword: String(res.temp_password ?? ''),
          name: `${formFirst.trim()} ${formLast.trim()}`,
        });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (row: StaffRow) => {
    setBusy(true);
    setError(null);
    try {
      const res = await invoke({ action: 'reset_password', user_id: row.user_id });
      setView({
        kind: 'created',
        reset: true,
        email: String(res.email ?? ''),
        tempPassword: String(res.temp_password ?? ''),
        name: row.full_name,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (row: StaffRow, active: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await invoke({ action: active ? 'reactivate' : 'deactivate', user_id: row.user_id });
      setView({ kind: 'list' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (view.kind === 'created') {
    return (
      <div className="card centered" style={{ maxWidth: 480 }}>
        <h2>{view.reset ? t('bhw.resetDoneTitle') : t('staff.createdTitle')}</h2>
        <p>{view.name}</p>
        <table className="kv">
          <tbody>
            <tr>
              <td>{t('bhw.emailLabel')}</td>
              <td>
                <b>{view.email}</b>
              </td>
            </tr>
            <tr>
              <td>{t('bhw.tempPwLabel')}</td>
              <td>
                <b>{view.tempPassword}</b>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="mutedline">{t('bhw.createdNote')}</p>
        <button onClick={() => setView({ kind: 'list' })}>{t('bhw.done')}</button>
      </div>
    );
  }

  if (view.kind === 'form') {
    const editing = view.editing;
    return (
      <div className="card centered" style={{ maxWidth: 480 }}>
        <h2>{editing ? t('staff.editTitle') : t('staff.addTitle')}</h2>
        {error ? <p className="error">{t('bhw.actionError', { message: error })}</p> : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' }}>
          <div>
            <label htmlFor="st-first">{t('bhw.firstNameLabel')}</label>
            <input
              id="st-first"
              value={formFirst}
              onChange={(e) => setFormFirst(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label htmlFor="st-last">{t('bhw.lastNameLabel')}</label>
            <input
              id="st-last"
              value={formLast}
              onChange={(e) => setFormLast(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        </div>
        <label htmlFor="st-fac">{t('staff.facilityLabel')}</label>
        <select
          id="st-fac"
          value={formFacility}
          onChange={(e) => setFormFacility(e.target.value)}
          style={{ width: '100%' }}
        >
          {facilities.map((f) => (
            <option key={f.facility_id} value={f.facility_id}>
              {f.name}
            </option>
          ))}
        </select>
        <p className="mutedline" style={{ marginTop: 10 }}>
          {t('staff.scopeNote')}
        </p>
        <p>
          <button
            disabled={busy || !formFirst.trim() || !formLast.trim() || !formFacility}
            onClick={() => void submitForm(editing)}
          >
            {editing ? t('bhw.save') : t('bhw.create')}
          </button>
          <button className="secondary" disabled={busy} onClick={() => setView({ kind: 'list' })}>
            {t('bhw.cancel')}
          </button>
        </p>
      </div>
    );
  }

  if (view.kind === 'confirmDeactivate') {
    return (
      <div className="card centered" style={{ maxWidth: 420 }}>
        <p>{t('bhw.confirmDeactivate', { name: view.target.full_name })}</p>
        <p>
          <button disabled={busy} onClick={() => void setActive(view.target, false)}>
            {t('bhw.deactivate')}
          </button>
          <button className="secondary" disabled={busy} onClick={() => setView({ kind: 'list' })}>
            {t('bhw.cancel')}
          </button>
        </p>
        {error ? <p className="error">{t('bhw.actionError', { message: error })}</p> : null}
      </div>
    );
  }

  const visible =
    facilityFilter === 'all' ? rows : rows.filter((r) => r.facility_id === facilityFilter);

  return (
    <div className="card">
      <div className="toolbar">
        <div>
          <h2 style={{ marginBottom: 2 }}>{t('staff.title')}</h2>
          <span className="mutedline">{t('staff.subtitle', { count: visible.length })}</span>
        </div>
        <span style={{ flex: 1 }} />
        <label htmlFor="st-filter" style={{ margin: 0 }}>
          {t('staff.filterLabel')}
        </label>
        <select
          id="st-filter"
          value={facilityFilter}
          onChange={(e) => setFacilityFilter(e.target.value)}
        >
          <option value="all">{t('common.all')}</option>
          {facilities.map((f) => (
            <option key={f.facility_id} value={f.facility_id}>
              {f.name} ({rows.filter((r) => r.facility_id === f.facility_id).length})
            </option>
          ))}
        </select>
        <button onClick={openAdd}>{t('staff.addCta')}</button>
      </div>

      {error ? <p className="error">{t('bhw.loadError', { message: error })}</p> : null}

      {loading ? (
        <p>{t('common.loading')}</p>
      ) : visible.length === 0 ? (
        <p className="mutedline">{t('staff.empty')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('bhw.colName')}</th>
              <th>{t('staff.colFacility')}</th>
              <th>{t('bhw.colStatus')}</th>
              <th>{t('bhw.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.user_id} style={{ opacity: r.active ? 1 : 0.6 }}>
                <td>
                  <b>{r.full_name}</b>
                </td>
                <td>{r.facilities?.name ?? r.facility_id}</td>
                <td>
                  <span className={`chip ${r.active ? 'tested' : ''}`}>
                    {r.active ? t('bhw.active') : t('bhw.deactivated')}
                  </span>
                </td>
                <td>
                  <button className="secondary" disabled={busy} onClick={() => openEdit(r)}>
                    {t('bhw.edit')}
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void resetPassword(r)}
                  >
                    {t('bhw.resetPw')}
                  </button>
                  {r.active ? (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => setView({ kind: 'confirmDeactivate', target: r })}
                    >
                      {t('bhw.deactivate')}
                    </button>
                  ) : (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void setActive(r, true)}
                    >
                      {t('bhw.reactivate')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
