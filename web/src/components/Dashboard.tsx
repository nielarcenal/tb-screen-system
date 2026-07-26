/**
 * Facility dashboard (redesign §4): today's aggregate counts from the
 * dashboard_counts() RPC (migration 0006) — counts only, TB-DOTS role required
 * server-side. The tested-positive/negative numbers are outcomes RECORDED by
 * staff (§1: the system never computes them), visible only here — BHWs see
 * referral progress, never the outcome.
 *
 * Six stat tiles in one card with all its states: loading (skeleton tiles),
 * error (retryable), and idle (the tiles). A day with no activity shows honest
 * zeros — there is no separate "empty" for a fixed set of counts.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import { DashboardCounts } from '../lib/types';

interface TileSpec {
  key: string;
  n: number;
  label: string;
  sub: string;
  icon: string;
  iconBg: string;
  iconColor: string;
  valueColor: string;
}

const ZERO: DashboardCounts = {
  screened_today: 0,
  referred_today: 0,
  positive_today: 0,
  negative_today: 0,
  attended_today: 0,
  scheduled_today: 0,
  missed_today: 0,
};

export default function Dashboard() {
  const { t } = useTranslation();
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('dashboard_counts');
    if (err) setError(err.message);
    else setCounts(((data ?? []) as DashboardCounts[])[0] ?? ZERO);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const c = counts ?? ZERO;
  const tiles: TileSpec[] = [
    {
      key: 'screened',
      n: c.screened_today,
      label: t('dashboard.screened'),
      sub: t('dashboard.screenedSub'),
      icon: 'fact_check',
      iconBg: '#e6f2f2',
      iconColor: '#028090',
      valueColor: '#028090',
    },
    {
      key: 'referred',
      n: c.referred_today,
      label: t('dashboard.referred'),
      sub: t('dashboard.referredSub'),
      icon: 'move_to_inbox',
      iconBg: '#eef4f4',
      iconColor: '#046a78',
      valueColor: '#14302f',
    },
    {
      key: 'positive',
      n: c.positive_today,
      label: t('dashboard.positive'),
      sub: t('dashboard.positiveSub'),
      icon: 'coronavirus',
      iconBg: '#fbe7e5',
      iconColor: '#b0473b',
      valueColor: '#a5382f',
    },
    {
      key: 'negative',
      n: c.negative_today,
      label: t('dashboard.negative'),
      sub: t('dashboard.negativeSub'),
      icon: 'verified',
      iconBg: '#eef2f1',
      iconColor: '#46514e',
      valueColor: '#3f4b48',
    },
    {
      key: 'attended',
      n: c.attended_today,
      label: t('dashboard.attended'),
      sub: t('dashboard.attendedSub', { total: c.scheduled_today }),
      icon: 'how_to_reg',
      iconBg: '#dff0ea',
      iconColor: '#17876e',
      valueColor: '#12735f',
    },
    {
      key: 'missed',
      n: c.missed_today,
      label: t('dashboard.missed'),
      sub: t('dashboard.missedSub'),
      icon: 'event_busy',
      iconBg: '#f7ecd8',
      iconColor: '#8a5e00',
      valueColor: '#8a5e00',
    },
  ];

  return (
    <div className="dcard">
      <div className="dcard-head">
        <div className="title">
          <span className="msym" aria-hidden="true">
            insights
          </span>
          <h2>{t('dashboard.cardTitle')}</h2>
        </div>
        <button className="refresh" onClick={() => void load()} disabled={loading}>
          <span className={`msym${loading ? ' spin' : ''}`} aria-hidden="true">
            refresh
          </span>
          {t('common.refresh')}
        </button>
      </div>

      <div className="dcard-body" aria-busy={loading}>
        {error ? (
          <div className="dstate">
            <div className="badge">
              <span className="msym" aria-hidden="true">
                cloud_off
              </span>
            </div>
            <div className="st-title">{t('dashboard.errorTitle')}</div>
            <div className="st-body">{t('dashboard.errorBody')}</div>
            <button className="retry" onClick={() => void load()}>
              <span className="msym" aria-hidden="true">
                refresh
              </span>
              {t('dashboard.retry')}
            </button>
          </div>
        ) : loading ? (
          <div className="dgrid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="dtile skel" aria-hidden="true">
                <div className="b chip" />
                <div className="b val" />
                <div className="b lbl" />
                <div className="b sub" />
              </div>
            ))}
          </div>
        ) : (
          <div className="dgrid">
            {tiles.map((tile) => (
              <div key={tile.key} className="dtile">
                <span className="chip" style={{ background: tile.iconBg }}>
                  <span className="msym" aria-hidden="true" style={{ color: tile.iconColor }}>
                    {tile.icon}
                  </span>
                </span>
                <div className="val" style={{ color: tile.valueColor }}>
                  {tile.n}
                </div>
                <div className="lbl">{tile.label}</div>
                <div className="sub">{tile.sub}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="dcard-foot">
        <span className="msym" aria-hidden="true">
          info
        </span>
        <p>{t('dashboard.outcomeNote')}</p>
      </div>
    </div>
  );
}
