/**
 * Admin view: create and edit TB-DOTS facility records (redesign §4). A
 * facility row is name / type / address only — nothing clinical — so unlike
 * account management this writes the facilities table directly; RLS
 * (facilities_admin_insert/update, migration 0013) confines writes to admins.
 * New facilities are always type 'tb_dots'. No delete: facilities are
 * referenced by users and referrals.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';

interface FacilityRow {
  facility_id: string;
  name: string;
  address: string | null;
  type: string;
}

type View = { kind: 'list' } | { kind: 'form'; editing: FacilityRow | null };

export default function FacilityManagement() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<FacilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [formName, setFormName] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('facilities')
      .select('facility_id, name, address, type')
      .eq('type', 'tb_dots')
      .order('name');
    if (err) setError(err.message);
    else setRows((data ?? []) as FacilityRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openAdd = () => {
    setFormName('');
    setFormAddress('');
    setView({ kind: 'form', editing: null });
  };

  const openEdit = (r: FacilityRow) => {
    setFormName(r.name);
    setFormAddress(r.address ?? '');
    setView({ kind: 'form', editing: r });
  };

  const submitForm = async (editing: FacilityRow | null) => {
    setBusy(true);
    setError(null);
    try {
      const name = formName.trim();
      const address = formAddress.trim() || null;
      if (editing) {
        const { error: err } = await supabase
          .from('facilities')
          .update({ name, address })
          .eq('facility_id', editing.facility_id);
        if (err) throw new Error(err.message);
      } else {
        const { error: err } = await supabase
          .from('facilities')
          .insert({ name, address, type: 'tb_dots' });
        if (err) throw new Error(err.message);
      }
      setView({ kind: 'list' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (view.kind === 'form') {
    const editing = view.editing;
    return (
      <div className="card centered" style={{ maxWidth: 480 }}>
        <h2>{editing ? t('facilities.editTitle') : t('facilities.addTitle')}</h2>
        {error ? <p className="error">{t('facilities.saveError', { message: error })}</p> : null}
        <label htmlFor="fac-name">{t('facilities.nameLabel')}</label>
        <input
          id="fac-name"
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
          style={{ width: '100%' }}
        />
        <label htmlFor="fac-addr">{t('facilities.addressLabel')}</label>
        <input
          id="fac-addr"
          value={formAddress}
          onChange={(e) => setFormAddress(e.target.value)}
          style={{ width: '100%' }}
        />
        <p>
          <button disabled={busy || !formName.trim()} onClick={() => void submitForm(editing)}>
            {/* bhw.create is "Create account"; this form creates a facility. */}
            {editing ? t('bhw.save') : t('facilities.create')}
          </button>
          <button className="secondary" disabled={busy} onClick={() => setView({ kind: 'list' })}>
            {t('bhw.cancel')}
          </button>
        </p>
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const visible = rows.filter(
    (r) => !q || r.name.toLowerCase().includes(q) || (r.address ?? '').toLowerCase().includes(q),
  );

  return (
    <div className="dcard">
      <div className="bhw-head">
        <div className="bhw-titlerow">
          <div className="bhw-titleleft">
            <h2>{t('facilities.title')}</h2>
            <span className="count-pill">{rows.length}</span>
          </div>
          <button className="bhw-new" onClick={openAdd}>
            <span className="msym" aria-hidden="true">
              add
            </span>
            {t('facilities.addCta')}
          </button>
        </div>
        <div className="bhw-tools">
          <div className="search-wrap">
            <span className="msym search-ic" aria-hidden="true">
              search
            </span>
            <input
              type="search"
              placeholder={t('facilities.searchPlaceholder')}
              aria-label={t('facilities.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
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
            <div className="st-title">{t('facilities.errorTitle')}</div>
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
                domain_disabled
              </span>
            </div>
            <div className="st-title">{t('facilities.empty')}</div>
            <div className="st-body">{t('facilities.emptyDataBody')}</div>
          </div>
        ) : visible.length === 0 ? (
          <div className="dstate ok">
            <div className="badge">
              <span className="msym" aria-hidden="true">
                search_off
              </span>
            </div>
            <div className="st-title">{t('facilities.filterEmptyTitle')}</div>
            <div className="st-body">{t('bhw.filterEmptyBody')}</div>
          </div>
        ) : (
          visible.map((r) => (
            <div key={r.facility_id} className="bhw-row">
              <span className="bhw-avatar">
                <span className="msym" aria-hidden="true" style={{ fontSize: 19 }}>
                  local_hospital
                </span>
              </span>
              <div className="bhw-info">
                <span className="bhw-name">{r.name}</span>
                <span className="bhw-sub">{r.address ?? t('facilities.noAddress')}</span>
              </div>
              <span className="chip tested">{t('facilities.typeChip')}</span>
              <div className="bhw-actions">
                <button disabled={busy} onClick={() => openEdit(r)}>
                  {t('bhw.edit')}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
