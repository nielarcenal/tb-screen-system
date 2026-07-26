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
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

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
    setView({ kind: 'form', editing: null });
  };

  const openEdit = (row: BhwActivityRow) => {
    // full_name was stored as "First Last…" — first word is the first name.
    const [first, ...rest] = row.full_name.trim().split(/\s+/);
    setFormFirst(first ?? '');
    setFormLast(rest.join(' '));
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
        });
        setView({ kind: 'list' });
      } else {
        // The function assigns the captain's own barangay + facility (0008).
        const res = await invoke({
          action: 'create',
          first_name: formFirst,
          last_name: formLast,
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
      <div className="card centered" style={{ maxWidth: 480 }}>
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
      <div className="card centered" style={{ maxWidth: 480 }}>
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
        {!editing ? (
          <>
            <p className="mutedline" style={{ marginTop: 10 }}>
              {t('bhw.ownBarangayNote')}
            </p>
            <p className="mutedline">{t('bhw.emailNote')}</p>
          </>
        ) : null}
        <p>
          <button
            disabled={busy || !formFirst.trim() || !formLast.trim()}
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

  const initials = (name: string) =>
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '·';

  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (statusFilter === 'active' && !r.active) return false;
    if (statusFilter === 'inactive' && r.active) return false;
    if (!q) return true;
    return (
      r.full_name.toLowerCase().includes(q) ||
      (r.barangay_name ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="dcard">
      <div className="bhw-head">
        <div className="bhw-titlerow">
          <div className="bhw-titleleft">
            <h2>{t('bhw.title')}</h2>
            <span className="count-pill">{rows.length}</span>
          </div>
          <button className="bhw-new" onClick={openAdd}>
            <span className="msym" aria-hidden="true">
              add
            </span>
            {t('bhw.addCta')}
          </button>
        </div>
        <p className="bhw-privacy">{t('bhw.privacyNote')}</p>
        <div className="bhw-tools">
          <div className="search-wrap">
            <span className="msym search-ic" aria-hidden="true">
              search
            </span>
            <input
              type="search"
              placeholder={t('bhw.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="select-wrap">
            <select
              value={statusFilter}
              aria-label={t('bhw.colStatus')}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
            >
              <option value="all">{t('common.all')}</option>
              <option value="active">{t('bhw.active')}</option>
              <option value="inactive">{t('bhw.deactivated')}</option>
            </select>
            <span className="msym sel-ic" aria-hidden="true">
              expand_more
            </span>
          </div>
          <button
            className="icon-btn"
            onClick={() => void load()}
            disabled={loading}
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
          >
            <span className={`msym${loading ? ' spin' : ''}`} aria-hidden="true">
              refresh
            </span>
          </button>
        </div>
      </div>

      <div className="bhw-list" aria-busy={loading}>
        {error ? (
          <div className="dstate err">
            <div className="badge">
              <span className="msym" aria-hidden="true">
                cloud_off
              </span>
            </div>
            <div className="st-title">{t('bhw.errorTitle')}</div>
            <div className="st-body">{t('bhw.errorBody')}</div>
            <button className="retry" onClick={() => void load()}>
              <span className="msym" aria-hidden="true">
                refresh
              </span>
              {t('bhw.retry')}
            </button>
          </div>
        ) : loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bhw-row skel" aria-hidden="true">
              <span className="sk av" />
              <div className="bhw-info">
                <span className="sk n" />
                <span className="sk s" />
              </div>
              <span className="sk ch" />
            </div>
          ))
        ) : rows.length === 0 ? (
          <div className="dstate ok">
            <div className="badge">
              <span className="msym" aria-hidden="true">
                group_off
              </span>
            </div>
            <div className="st-title">{t('bhw.empty')}</div>
            <div className="st-body">{t('bhw.emptyDataBody')}</div>
          </div>
        ) : visible.length === 0 ? (
          <div className="dstate ok">
            <div className="badge">
              <span className="msym" aria-hidden="true">
                search_off
              </span>
            </div>
            <div className="st-title">{t('bhw.filterEmptyTitle')}</div>
            <div className="st-body">{t('bhw.filterEmptyBody')}</div>
          </div>
        ) : (
          visible.map((r) => (
            <div key={r.user_id} className={`bhw-row${r.active ? '' : ' inactive'}`}>
              <span className="bhw-avatar">{initials(r.full_name)}</span>
              <div className="bhw-info">
                <span className="bhw-name">{r.full_name}</span>
                <span className="bhw-sub">
                  {r.barangay_name ?? r.barangay_code ?? '—'} ·{' '}
                  {t('bhw.activityLine', {
                    screenings: r.screenings_n,
                    referrals: r.referrals_n,
                  })}
                </span>
              </div>
              <span className={`chip ${r.active ? 'active' : 'inactive'}`}>
                {r.active ? t('bhw.active') : t('bhw.deactivated')}
              </span>
              <div className="bhw-actions">
                <button disabled={busy} onClick={() => openEdit(r)}>
                  {t('bhw.edit')}
                </button>
                <button disabled={busy} onClick={() => void resetPassword(r)}>
                  {t('bhw.resetPw')}
                </button>
                {r.active ? (
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => setView({ kind: 'confirmDeactivate', target: r })}
                  >
                    {t('bhw.deactivate')}
                  </button>
                ) : (
                  <button disabled={busy} onClick={() => void setActive(r, true)}>
                    {t('bhw.reactivate')}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
