/**
 * Barangay Hotspot View (Feature 10, brief §6): ranked presumptive-case counts
 * by barangay over a date range, from the hotspot_counts() SECURITY DEFINER
 * function (counts only — the portal never sees the rows behind them).
 *
 * SURVEILLANCE, NOT CONTACT TRACING: no household/sitio/per-patient drill-down
 * exists here by design. The "heat" bar is just the count relative to the
 * period's maximum.
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
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

export default function HotspotView() {
  const { t } = useTranslation();
  const [from, setFrom] = useState(toDateOnly(new Date(Date.now() - 29 * DAY_MS)));
  const [to, setTo] = useState(toDateOnly(new Date()));
  const [rows, setRows] = useState<HotspotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (fromDate: string, toDate: string) => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('hotspot_counts', {
      from_date: fromDate,
      to_date: toDate,
    });
    if (err) setError(err.message);
    else setRows((data ?? []) as HotspotRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // initial load only; afterwards via the Apply button

  const apply = (e: FormEvent) => {
    e.preventDefault();
    void load(from, to);
  };

  const max = rows.reduce((m, r) => Math.max(m, r.presumptive_count), 0);

  return (
    <div className="card">
      <h2>{t('hotspot.title')}</h2>
      <p className="mutedline">{t('hotspot.intro')}</p>

      <form className="toolbar" onSubmit={apply}>
        <label style={{ margin: 0 }} htmlFor="from">
          {t('hotspot.from')}
        </label>
        <input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <label style={{ margin: 0 }} htmlFor="to">
          {t('hotspot.to')}
        </label>
        <input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <button type="submit">{t('hotspot.apply')}</button>
      </form>

      {error ? <p className="error">{t('hotspot.loadError', { message: error })}</p> : null}
      {loading ? (
        <p>{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="mutedline">{t('hotspot.empty')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}>{t('hotspot.colRank')}</th>
              <th>{t('hotspot.colBarangay')}</th>
              <th>{t('hotspot.colCity')}</th>
              <th style={{ width: 140 }}>{t('hotspot.colCount')}</th>
              <th style={{ width: '30%' }} aria-hidden />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.barangay_code}>
                <td>{i + 1}</td>
                <td>{r.barangay_name}</td>
                <td>{r.city_name}</td>
                <td>{r.presumptive_count}</td>
                <td>
                  <div
                    className="heatbar"
                    style={{ width: max ? `${(r.presumptive_count / max) * 100}%` : 0 }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
