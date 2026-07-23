/**
 * Facility dashboard (design 1b): today's aggregate counts from the
 * dashboard_counts() RPC (migration 0006) — counts only, TB-DOTS role required
 * server-side. The tested-positive/negative numbers are outcomes RECORDED by
 * staff (§1: the system never computes them), and they are visible only here —
 * BHWs see referral progress, never the outcome.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import { DashboardCounts } from '../lib/types';

interface CardSpec {
  n: number;
  label: string;
  sub: string;
  className: string;
}

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
    else setCounts(((data ?? []) as DashboardCounts[])[0] ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cards: CardSpec[] = counts
    ? [
        {
          n: counts.screened_today,
          label: t('dashboard.screened'),
          sub: t('dashboard.screenedSub'),
          className: 'teal',
        },
        {
          n: counts.referred_today,
          label: t('dashboard.referred'),
          sub: t('dashboard.referredSub'),
          className: 'plain',
        },
        {
          n: counts.positive_today,
          label: t('dashboard.positive'),
          sub: t('dashboard.positiveSub'),
          className: 'red',
        },
        {
          n: counts.negative_today,
          label: t('dashboard.negative'),
          sub: t('dashboard.negativeSub'),
          className: 'neutral',
        },
        {
          n: counts.attended_today,
          label: t('dashboard.attended'),
          sub: t('dashboard.attendedSub', { total: counts.scheduled_today }),
          className: 'plain',
        },
        {
          n: counts.missed_today,
          label: t('dashboard.missed'),
          sub: t('dashboard.missedSub'),
          className: 'plain red-n',
        },
      ]
    : [];

  return (
    <div className="card">
      <h2>{t('dashboard.title')}</h2>
      <p className="mutedline">
        {t('dashboard.intro', { date: new Date().toLocaleDateString() })}
        {'  '}
        <button className="secondary" onClick={() => void load()} style={{ marginLeft: 8 }}>
          {t('common.refresh')}
        </button>
      </p>

      {error ? <p className="error">{t('dashboard.loadError', { message: error })}</p> : null}
      {loading ? (
        <p>{t('common.loading')}</p>
      ) : (
        <div className="statgrid">
          {cards.map((c) => (
            <div key={c.label} className={`statcard ${c.className}`}>
              <span className="n">{c.n}</span>
              <span className="label">{c.label}</span>
              <span className="sub">{c.sub}</span>
            </div>
          ))}
        </div>
      )}

      <p className="mutedline" style={{ marginTop: 14 }}>
        {t('dashboard.outcomeNote')}
      </p>
    </div>
  );
}
