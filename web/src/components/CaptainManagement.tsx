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

type View =
  | { kind: 'list' }
  | { kind: 'form'; editing: CaptainRow | null }
  | { kind: 'created'; email: string; tempPassword: string; name: string; reset?: boolean }
  | { kind: 'confirmDeactivate'; target: CaptainRow };

export default function CaptainManagement() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<CaptainRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [formFirst, setFormFirst] = useState('');
  const [formLast, setFormLast] = useState('');
  const [formBrgy, setFormBrgy] = useState<string | null>(null);
  // Facility is DERIVED from the barangay (nearest DOTS center, 0009) — shown
  // read-only; the Edge Function does the same lookup server-side.
  const [mappedFacility, setMappedFacility] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const initials = (name: string) =>
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '·';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('users')
      .select('user_id, full_name, facility_id, assigned_barangay_code, active, ref_barangays(name)')
      .eq('role', 'captain')
      .order('full_name');
    if (err) setError(err.message);
    else setRows((data ?? []) as unknown as CaptainRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Look up the barangay's nearest DOTS center for display.
  useEffect(() => {
    if (!formBrgy) {
      setMappedFacility(null);
      return;
    }
    void supabase
      .from('ref_barangays')
      .select('ref_cities(default_facility_id, facilities(name))')
      .eq('barangay_code', formBrgy)
      .maybeSingle()
      .then(({ data }) => {
        const name =
          (data as { ref_cities: { facilities: { name: string } | null } | null } | null)
            ?.ref_cities?.facilities?.name ?? null;
        setMappedFacility(name);
      });
  }, [formBrgy]);

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

  const openEdit = (row: CaptainRow) => {
    const [first, ...rest] = row.full_name.trim().split(/\s+/);
    setFormFirst(first ?? '');
    setFormLast(rest.join(' '));
    setFormBrgy(row.assigned_barangay_code);
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
        // No facility_id: the function derives the nearest DOTS center (0009).
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
      <div className="card centered" style={{ maxWidth: 480 }}>
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
      <div className="card centered" style={{ maxWidth: 480 }}>
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
        <AddressCascadeWeb value={formBrgy} onChange={setFormBrgy} />
        {!editing && formBrgy ? (
          <p className="mutedline" style={{ marginTop: 10 }}>
            <b>{t('captains.facilityLabel')}:</b>{' '}
            {mappedFacility ?? t('captains.noFacilityMapped')}
          </p>
        ) : null}
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
              (!editing && !mappedFacility)
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

  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (statusFilter === 'active' && !r.active) return false;
    if (statusFilter === 'inactive' && r.active) return false;
    if (!q) return true;
    return (
      r.full_name.toLowerCase().includes(q) ||
      (r.ref_barangays?.name ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="dcard">
      <div className="bhw-head">
        <div className="bhw-titlerow">
          <div className="bhw-titleleft">
            <h2>{t('captains.title')}</h2>
            <span className="count-pill">{rows.length}</span>
          </div>
          <button className="bhw-new" onClick={openAdd}>
            <span className="msym" aria-hidden="true">
              add
            </span>
            {t('captains.addCta')}
          </button>
        </div>
        <p className="bhw-privacy">{t('captains.privacyNote')}</p>
        <div className="bhw-tools">
          <div className="search-wrap">
            <span className="msym search-ic" aria-hidden="true">
              search
            </span>
            <input
              type="search"
              placeholder={t('bhw.searchPlaceholder')}
              aria-label={t('bhw.searchPlaceholder')}
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
            <div className="st-title">{t('captains.errorTitle')}</div>
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
            <div className="st-title">{t('captains.empty')}</div>
            <div className="st-body">{t('captains.emptyDataBody')}</div>
          </div>
        ) : visible.length === 0 ? (
          <div className="dstate ok">
            <div className="badge">
              <span className="msym" aria-hidden="true">
                search_off
              </span>
            </div>
            <div className="st-title">{t('captains.filterEmptyTitle')}</div>
            <div className="st-body">{t('bhw.filterEmptyBody')}</div>
          </div>
        ) : (
          visible.map((r) => (
            <div key={r.user_id} className={`bhw-row${r.active ? '' : ' inactive'}`}>
              <span className="bhw-avatar">{initials(r.full_name)}</span>
              <div className="bhw-info">
                <span className="bhw-name">{r.full_name}</span>
                <span className="bhw-sub">
                  {r.ref_barangays?.name ?? r.assigned_barangay_code ?? '—'}
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
