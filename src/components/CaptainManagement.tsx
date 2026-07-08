/**
 * Admin (developer) view: provision Barangay-Captain accounts. Each captain is
 * assigned ONE barangay — the manage-bhw function then confines that captain
 * to adding/managing BHWs of that barangay only (0008).
 *
 * List reads users rows directly (users_admin_read policy); all writes go
 * through the manage-bhw Edge Function (auth admin needs the service role).
 * Admins, like captains, can read no patient data of any kind.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import AddressCascadeWeb from './AddressCascadeWeb';

interface CaptainRow {
  user_id: string;
  full_name: string;
  facility_id: string;
  assigned_barangay_code: string | null;
  active: boolean;
  ref_barangays: { name: string } | null;
}

interface FacilityOption {
  facility_id: string;
  name: string;
}

type View =
  | { kind: 'list' }
  | { kind: 'form'; editing: CaptainRow | null }
  | { kind: 'created'; email: string; tempPassword: string; name: string; reset?: boolean }
  | { kind: 'confirmDeactivate'; target: CaptainRow };

export default function CaptainManagement() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<CaptainRow[]>([]);
  const [facilities, setFacilities] = useState<FacilityOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [formFirst, setFormFirst] = useState('');
  const [formLast, setFormLast] = useState('');
  const [formBrgy, setFormBrgy] = useState<string | null>(null);
  const [formFacility, setFormFacility] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [{ data, error: err }, { data: fac, error: fErr }] = await Promise.all([
      supabase
        .from('users')
        .select('user_id, full_name, facility_id, assigned_barangay_code, active, ref_barangays(name)')
        .eq('role', 'captain')
        .order('full_name'),
      supabase.from('facilities').select('facility_id, name').order('name'),
    ]);
    if (err) setError(err.message);
    else setRows((data ?? []) as unknown as CaptainRow[]);
    if (fErr) setError(fErr.message);
    else setFacilities((fac ?? []) as FacilityOption[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const invoke = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const { data, error: err } = await supabase.functions.invoke('manage-bhw', { body });
    if (err) throw new Error(err.message);
    const parsed = (data ?? {}) as Record<string, unknown>;
    if (parsed.error) throw new Error(String(parsed.error));
    return parsed;
  };

  const openAdd = () => {
    setFormFirst('');
    setFormLast('');
    setFormBrgy(null);
    setFormFacility(facilities[0]?.facility_id ?? '');
    setView({ kind: 'form', editing: null });
  };

  const openEdit = (row: CaptainRow) => {
    const [first, ...rest] = row.full_name.trim().split(/\s+/);
    setFormFirst(first ?? '');
    setFormLast(rest.join(' '));
    setFormBrgy(row.assigned_barangay_code);
    setFormFacility(row.facility_id);
    setView({ kind: 'form', editing: row });
  };

  const submitForm = async (editing: CaptainRow | null) => {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await invoke({
          action: 'update',
          user_id: editing.user_id,
          first_name: formFirst,
          last_name: formLast,
          barangay_code: formBrgy,
        });
        setView({ kind: 'list' });
      } else {
        const res = await invoke({
          action: 'create',
          first_name: formFirst,
          last_name: formLast,
          barangay_code: formBrgy,
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

  const resetPassword = async (row: CaptainRow) => {
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

  const setActive = async (row: CaptainRow, active: boolean) => {
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
      <div className="card" style={{ maxWidth: 480 }}>
        <h2>{view.reset ? t('bhw.resetDoneTitle') : t('captains.createdTitle')}</h2>
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
      <div className="card" style={{ maxWidth: 480 }}>
        <h2>{editing ? t('captains.editTitle') : t('captains.addTitle')}</h2>
        {error ? <p className="error">{t('bhw.actionError', { message: error })}</p> : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' }}>
          <div>
            <label htmlFor="cap-first">{t('bhw.firstNameLabel')}</label>
            <input
              id="cap-first"
              value={formFirst}
              onChange={(e) => setFormFirst(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label htmlFor="cap-last">{t('bhw.lastNameLabel')}</label>
            <input
              id="cap-last"
              value={formLast}
              onChange={(e) => setFormLast(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        </div>
        {!editing ? (
          <>
            <label htmlFor="cap-fac">{t('captains.facilityLabel')}</label>
            <select
              id="cap-fac"
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
          </>
        ) : null}
        <AddressCascadeWeb value={formBrgy} onChange={setFormBrgy} />
        {!editing ? (
          <p className="mutedline" style={{ marginTop: 10 }}>
            {t('captains.scopeNote')}
          </p>
        ) : null}
        <p>
          <button
            disabled={
              busy ||
              !formFirst.trim() ||
              !formLast.trim() ||
              !formBrgy ||
              (!editing && !formFacility)
            }
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
      <div className="card" style={{ maxWidth: 420 }}>
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

  return (
    <div className="card">
      <div className="toolbar">
        <div>
          <h2 style={{ marginBottom: 2 }}>{t('captains.title')}</h2>
          <span className="mutedline">{t('captains.subtitle', { count: rows.length })}</span>
        </div>
        <span style={{ flex: 1 }} />
        <button onClick={openAdd}>{t('captains.addCta')}</button>
      </div>

      <p className="mutedline">{t('captains.privacyNote')}</p>
      {error ? <p className="error">{t('bhw.loadError', { message: error })}</p> : null}

      {loading ? (
        <p>{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="mutedline">{t('captains.empty')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('bhw.colName')}</th>
              <th>{t('bhw.colBarangay')}</th>
              <th>{t('bhw.colStatus')}</th>
              <th>{t('bhw.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id} style={{ opacity: r.active ? 1 : 0.6 }}>
                <td>
                  <b>{r.full_name}</b>
                </td>
                <td>{r.ref_barangays?.name ?? r.assigned_barangay_code ?? '—'}</td>
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
