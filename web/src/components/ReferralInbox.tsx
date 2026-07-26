/**
 * Referral inbox (redesign §4): the master pane of the master-detail split.
 * Compact rows — patient name, code, barangay · date, and a status chip (plus
 * a small result pill once an outcome is recorded) — clicking a row opens it in
 * the detail pane (selected row keeps a teal edge). Every referral addressed to
 * the signed-in staff's facility; the RLS policy (referrals_tbdots_read) does
 * the scoping, so the query has no facility filter. Client-side status filter +
 * text search only (volumes are small; §2 keep it minimal).
 *
 * All four list states: loading (skeleton rows), error (retryable), empty
 * (nothing yet, or nothing matching the filter), and the rows themselves.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import { ReferralJoined, ReferralStatus } from '../lib/types';

const STATUSES: ReferralStatus[] = ['submitted', 'received', 'tested', 'closed'];

interface Props {
  onOpen: (referralId: string) => void;
  selectedId: string | null;
}

export default function ReferralInbox({ onOpen, selectedId }: Props) {
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

  const statusChip = (r: ReferralJoined) =>
    r.presented === false ? (
      <span className="chip noshow">{t('inbox.presentedNo')}</span>
    ) : (
      <span className={`chip ${r.status}`}>{t(`status.${r.status}`)}</span>
    );

  return (
    <div className="inbox-pane">
      <div className="inbox-head">
        <div className="inbox-titlerow">
          <h2>{t('inbox.title')}</h2>
          <span className="count-pill">{t('inbox.count', { count: visible.length })}</span>
        </div>
        <div className="inbox-tools">
          <div className="search-wrap">
            <span className="msym search-ic" aria-hidden="true">
              search
            </span>
            <input
              type="search"
              placeholder={t('inbox.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="select-wrap">
            <select
              value={statusFilter}
              aria-label={t('inbox.statusFilter')}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | ReferralStatus)}
            >
              <option value="all">{t('common.all')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
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

      <div className="inbox-list" aria-busy={loading}>
        {error ? (
          <div className="list-state err">
            <span className="msym" aria-hidden="true">
              cloud_off
            </span>
            <div className="ls-title">{t('inbox.errorTitle')}</div>
            <div className="ls-body">{t('inbox.errorBody')}</div>
            <button className="retry" onClick={() => void load()}>
              <span className="msym" aria-hidden="true">
                refresh
              </span>
              {t('inbox.retry')}
            </button>
          </div>
        ) : loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="inbox-row skel" aria-hidden="true">
              <div className="row-main">
                <div className="b n" />
                <div className="b c" />
                <div className="b m" />
              </div>
              <div className="row-side">
                <div className="b" />
              </div>
            </div>
          ))
        ) : visible.length === 0 ? (
          <div className="list-state">
            <span className="msym" aria-hidden="true">
              search_off
            </span>
            {rows.length === 0 ? (
              <div className="ls-title">{t('inbox.empty')}</div>
            ) : (
              <>
                <div className="ls-title">{t('inbox.filterEmptyTitle')}</div>
                <div className="ls-body">{t('inbox.filterEmptyBody')}</div>
              </>
            )}
          </div>
        ) : (
          visible.map((r) => {
            const name = r.patients.full_name || r.patients.display_code;
            const barangay = r.patients.ref_barangays?.name ?? r.patients.barangay_code;
            const date = new Date(r.created_at).toLocaleDateString();
            return (
              <button
                key={r.referral_id}
                className={`inbox-row${r.referral_id === selectedId ? ' selected' : ''}`}
                aria-current={r.referral_id === selectedId ? 'true' : undefined}
                onClick={() => onOpen(r.referral_id)}
              >
                <div className="row-main">
                  <span className="row-name">{name}</span>
                  {r.patients.full_name ? (
                    <span className="row-code">{r.patients.display_code}</span>
                  ) : null}
                  <span className="row-meta">
                    {barangay} · {date}
                  </span>
                </div>
                <div className="row-side">
                  {statusChip(r)}
                  {r.result_outcome ? (
                    <span className={`result-pill ${r.result_outcome}`}>
                      {t(`detail.outcome${r.result_outcome === 'positive' ? 'Positive' : 'Negative'}`)}
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
