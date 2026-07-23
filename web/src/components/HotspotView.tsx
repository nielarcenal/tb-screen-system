/**
 * Barangay Hotspot View (design 1b): ranked presumptive-case counts by
 * barangay with "Last 30 / 60 / 90 days" range pills, from the
 * hotspot_counts() SECURITY DEFINER function (counts only — the portal never
 * sees the rows behind them). Bar color by rank: 1 deep teal, 2–3 seafoam,
 * the rest light teal.
 *
 * SURVEILLANCE, NOT CONTACT TRACING: no household/sitio/per-patient drill-down
 * exists here by design. The bar is just the count relative to the period's
 * maximum.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import { toDateOnly } from '../lib/types';

interface HotspotRow {
  barangay_code: string;
  barangay_name: string;
  city_name: string;
  presumptive_count: number;
}

const DAY_MS = 86_400_000;
const RANGES = [30, 60, 90] as const;
type RangeDays = (typeof RANGES)[number];

export default function HotspotView() {
  const { t } = useTranslation();
  const [days, setDays] = useState<RangeDays>(30);
  const [rows, setRows] = useState<HotspotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (rangeDays: RangeDays) => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('hotspot_counts', {
      from_date: toDateOnly(new Date(Date.now() - (rangeDays - 1) * DAY_MS)),
      to_date: toDateOnly(new Date()),
    });
    if (err) setError(err.message);
    else setRows((data ?? []) as HotspotRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(days);
  }, [load, days]);

  const max = rows.reduce((m, r) => Math.max(m, r.presumptive_count), 0);
  const barColor = (i: number) =>
    i === 0 ? 'var(--teal)' : i < 3 ? 'var(--seafoam)' : 'var(--teal-border)';

  return (
    <div className="card">
      <h2>{t('hotspot.title')}</h2>
      <p className="mutedline">{t('hotspot.intro')}</p>

      <div className="pillrow">
        {RANGES.map((r) => (
          <button
            key={r}
            className={days === r ? '' : 'secondary'}
            onClick={() => setDays(r)}
          >
            {t('hotspot.rangeLast', { days: r })}
          </button>
        ))}
      </div>

      {error ? <p className="error">{t('hotspot.loadError', { message: error })}</p> : null}
      {loading ? (
        <p>{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="mutedline">{t('hotspot.empty')}</p>
      ) : (
        <div className="hotlist">
          {rows.map((r, i) => (
            <div key={r.barangay_code} className="hotrow">
              <span className="rank">{String(i + 1).padStart(2, '0')}</span>
              <span className="name">
                {r.barangay_name}
                <div className="city">{r.city_name}</div>
              </span>
              <span className="track">
                <span
                  className="heatbar"
                  style={{
                    display: 'block',
                    width: max ? `${(r.presumptive_count / max) * 100}%` : 0,
                    background: barColor(i),
                  }}
                />
              </span>
              <span className="count">{r.presumptive_count}</span>
            </div>
          ))}
          <p className="mutedline" style={{ borderTop: '1px solid #f0ede7', paddingTop: 10, margin: 0 }}>
            {t('hotspot.countsNote')}
          </p>
        </div>
      )}
    </div>
  );
}
