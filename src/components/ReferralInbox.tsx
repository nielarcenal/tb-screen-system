/**
 * Referral inbox (Feature 7): every referral addressed to the signed-in staff's
 * facility — the RLS policy (referrals_tbdots_read) does the scoping; the query
 * itself has no facility filter. Client-side status filter + text search only
 * (volumes are small; §2 keep it minimal).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import { ReferralJoined, ReferralStatus } from '../lib/types';

const STATUSES: ReferralStatus[] = ['submitted', 'received', 'tested', 'closed'];

interface Props {
  onOpen: (referralId: string) => void;
}

export default function ReferralInbox({ onOpen }: Props) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ReferralJoined[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | ReferralStatus>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('referrals')
      .select('*, patients(*, ref_barangays(name)), screenings(*)')
      .order('created_at', { ascending: false });
    if (err) {
      setError(err.message);
    } else {
      setRows((data ?? []) as unknown as ReferralJoined[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (!q) return true;
    return (
      (r.specimen_id ?? '').toLowerCase().includes(q) ||
      r.patients.display_code.toLowerCase().includes(q) ||
      (r.patients.full_name ?? '').toLowerCase().includes(q)
    );
  });

  const presentedCell = (r: ReferralJoined) =>
    r.presented === null ? (
      '—'
    ) : r.presented ? (
      t('inbox.presentedYes')
    ) : (
      <span className="chip noshow">{t('inbox.presentedNo')}</span>
    );

  return (
    <div className="card">
      <h2>{t('inbox.title')}</h2>

      <div className="toolbar">
        <input
          type="search"
          placeholder={t('inbox.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="mutedline">{t('inbox.statusFilter')}</span>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | ReferralStatus)}
        >
          <option value="all">{t('common.all')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
        <button className="secondary" onClick={() => void load()}>
          {t('common.refresh')}
        </button>
      </div>

      {error ? <p className="error">{t('inbox.loadError', { message: error })}</p> : null}
      {loading ? (
        <p>{t('common.loading')}</p>
      ) : visible.length === 0 ? (
        <p className="mutedline">{t('inbox.empty')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('inbox.colSpecimen')}</th>
              <th>{t('inbox.colPatient')}</th>
              <th>{t('inbox.colBarangay')}</th>
              <th>{t('inbox.colReferredOn')}</th>
              <th>{t('inbox.colStatus')}</th>
              <th>{t('inbox.colPresented')}</th>
              <th>{t('inbox.colResult')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.referral_id} className="rowlink" onClick={() => onOpen(r.referral_id)}>
                <td>{r.specimen_id ?? '—'}</td>
                <td>
                  {r.patients.full_name ? (
                    <>
                      <b>{r.patients.full_name}</b>
                      <div className="mutedline">{r.patients.display_code}</div>
                    </>
                  ) : (
                    r.patients.display_code
                  )}
                </td>
                <td>{r.patients.ref_barangays?.name ?? r.patients.barangay_code}</td>
                <td>{new Date(r.created_at).toLocaleDateString()}</td>
                <td>
                  <span className={`chip ${r.status}`}>{t(`status.${r.status}`)}</span>
                </td>
                <td>{presentedCell(r)}</td>
                <td>{r.result ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
