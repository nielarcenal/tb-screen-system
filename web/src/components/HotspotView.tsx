/**
 * Barangay Hotspot View (redesign §4): ranked presumptive-case counts by
 * barangay with Last 30 / 60 / 90 day range pills, from the hotspot_counts()
 * SECURITY DEFINER function (counts only — the portal never sees the rows
 * behind them). Bar colour by rank: 1 teal, 2–3 seafoam, the rest light teal.
 *
 * SURVEILLANCE, NOT CONTACT TRACING (§1): no household/sitio/per-patient
 * drill-down exists here by design. The bar is just the count relative to the
 * period's maximum. All four states: loading (skeleton rows), error
 * (retryable), empty, and the ranked list.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import { manilaDaysAgo, manilaToday } from '../lib/types';

interface HotspotRow {
  barangay_code: string;
  barangay_name: string;
  city_name: string;
  presumptive_count: number;
}

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
      from_date: manilaDaysAgo(rangeDays - 1),
      to_date: manilaToday(),
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
    <div className="dcard">
      <div className="hs-head">
        <p className="hs-intro">{t('hotspot.intro')}</p>
        <div className="range-pills">
          {RANGES.map((r) => (
            <button
              key={r}
              className={days === r ? 'active' : ''}
              aria-pressed={days === r}
              onClick={() => setDays(r)}
            >
              {t('hotspot.rangeLast', { days: r })}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="dstate">
          <div className="badge">
            <span className="msym" aria-hidden="true">
              cloud_off
            </span>
          </div>
          <div className="st-title">{t('hotspot.errorTitle')}</div>
          <div className="st-body">{t('hotspot.errorBody')}</div>
          <button className="retry" onClick={() => void load(days)}>
            <span className="msym" aria-hidden="true">
              refresh
            </span>
            {t('hotspot.retry')}
          </button>
        </div>
      ) : loading ? (
        <div className="hs-list" aria-busy="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="hs-row skel" aria-hidden="true">
              <span className="hs-rank">
                <span className="b rk" />
              </span>
              <div className="hs-main">
                <div className="hs-toprow">
                  <span className="b nm" />
                  <span className="b ct" />
                </div>
                <div className="b tr" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="dstate ok">
          <div className="badge">
            <span className="msym" aria-hidden="true">
              bar_chart
            </span>
          </div>
          <div className="st-title">{t('hotspot.empty')}</div>
          <div className="st-body">{t('hotspot.emptyBody')}</div>
        </div>
      ) : (
        <div className="hs-list">
          {rows.map((r, i) => (
            <div key={r.barangay_code} className="hs-row">
              <span className="hs-rank">{String(i + 1).padStart(2, '0')}</span>
              <div className="hs-main">
                <div className="hs-toprow">
                  <div style={{ minWidth: 0 }}>
                    <div className="hs-b">{r.barangay_name}</div>
                    <div className="hs-muni">{r.city_name}</div>
                  </div>
                  <div className="hs-countwrap">
                    <span className="hs-count">{r.presumptive_count}</span>
                    <span className="hs-unit">{t('hotspot.unit')}</span>
                  </div>
                </div>
                <div className="hs-track">
                  <div
                    className="hs-fill"
                    style={{
                      width: max ? `${(r.presumptive_count / max) * 100}%` : '0%',
                      background: barColor(i),
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="dcard-foot">
        <span className="msym" aria-hidden="true">
          info
        </span>
        <p>{t('hotspot.countsNote')}</p>
      </div>
    </div>
  );
}
