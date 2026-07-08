/**
 * Barangay-Captain view (design 1b): BHW ACCOUNTS ONLY — list with 30-day
 * activity counts (bhw_activity() RPC, captain role required server-side),
 * add/edit form, deactivate/reactivate with confirmation.
 *
 * PRIVACY: captains can read no patient data of any kind — the RLS policies on
 * patients/screenings/referrals all gate on role in ('bhw','tb_dots'). All
 * account WRITES go through the manage-bhw Edge Function (auth admin needs the
 * service role, which never reaches the browser).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import { BhwActivityRow } from '../lib/types';
import AddressCascadeWeb from './AddressCascadeWeb';

type View =
  | { kind: 'list' }
  | { kind: 'form'; editing: BhwActivityRow | null }
  | { kind: 'created'; email: string; tempPassword: string; name: string; reset?: boolean }
  | { kind: 'confirmDeactivate'; target: BhwActivityRow };

export default function BhwManagement() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<BhwActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [formFirst, setFormFirst] = useState('');
  const [formLast, setFormLast] = useState('');
  const [formBrgy, setFormBrgy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('bhw_activity', { days_back: 30 });
    if (err) setError(err.message);
    else setRows((data ?? []) as BhwActivityRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Call the manage-bhw Edge Function; returns the parsed body or throws. */
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
    setView({ kind: 'form', editing: null });
  };

  const openEdit = (row: BhwActivityRow) => {
    // full_name was stored as "First Last…" — first word is the first name.
    const [first, ...rest] = row.full_name.trim().split(/\s+/);
    setFormFirst(first ?? '');
    setFormLast(rest.join(' '));
    setFormBrgy(row.barangay_code);
    setView({ kind: 'form', editing: row });
  };

  const submitForm = async (editing: BhwActivityRow | null) => {
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

  /** Passwords are hashed — never viewable, only replaceable. */
  const resetPassword = async (row: BhwActivityRow) => {
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

  const setActive = async (row: BhwActivityRow, active: boolean) => {
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
        <h2>{view.reset ? t('bhw.resetDoneTitle') : t('bhw.createdTitle')}</h2>
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
        <h2>{editing ? t('bhw.editTitle') : t('bhw.addTitle')}</h2>
        {error ? <p className="error">{t('bhw.actionError', { message: error })}</p> : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' }}>
          <div>
            <label htmlFor="bhw-first">{t('bhw.firstNameLabel')}</label>
            <input
              id="bhw-first"
              value={formFirst}
              onChange={(e) => setFormFirst(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label htmlFor="bhw-last">{t('bhw.lastNameLabel')}</label>
            <input
              id="bhw-last"
              value={formLast}
              onChange={(e) => setFormLast(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        </div>
        <AddressCascadeWeb value={formBrgy} onChange={setFormBrgy} />
        {!editing ? (
          <p className="mutedline" style={{ marginTop: 10 }}>
            {t('bhw.emailNote')}
          </p>
        ) : null}
        <p>
          <button
            disabled={busy || !formFirst.trim() || !formLast.trim() || !formBrgy}
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
          <h2 style={{ marginBottom: 2 }}>{t('bhw.title')}</h2>
          <span className="mutedline">{t('bhw.subtitle', { count: rows.length })}</span>
        </div>
        <span style={{ flex: 1 }} />
        <button onClick={openAdd}>{t('bhw.addCta')}</button>
      </div>

      <p className="mutedline">{t('bhw.privacyNote')}</p>
      {error ? <p className="error">{t('bhw.loadError', { message: error })}</p> : null}

      {loading ? (
        <p>{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="mutedline">{t('bhw.empty')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('bhw.colName')}</th>
              <th>{t('bhw.colBarangay')}</th>
              <th>{t('bhw.colActivity')}</th>
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
                <td>{r.barangay_name ?? r.barangay_code ?? '—'}</td>
                <td>
                  {t('bhw.activityLine', {
                    screenings: r.screenings_n,
                    referrals: r.referrals_n,
                  })}
                </td>
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
