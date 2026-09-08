/**
 * Barangay Report — screening and referral counts per barangay, ranked, with
 * the same period a year earlier beside them.
 *
 * WHY IT LOOKS LIKE THE CITY HEALTH OFFICE SHEET. The CHO compiles its
 * per-barangay TB figures by hand once a year. This produces the portion of
 * that work the system observes, continuously.
 *
 * LIKE FOR LIKE, ALWAYS. The comparison period ENDS ON THE SAME DAY OF THE YEAR
 * as the selected one. Pick the current year and you get 1 Jan–today against
 * 1 Jan–today last year; pick a finished year and you get two full years. The
 * first version compared a nine-month 2026 against a twelve-month 2025 and made
 * every barangay look like it was improving — a decline that was really just a
 * calendar. Never compare a part year to a whole one.
 *
 * WHAT IT DOES NOT CLAIM, restated in the UI because a screenshot outlives a
 * caveat in the thesis: not the city case register (only patients seen through
 * this system are counted), no treatment-completion column (no treatment
 * register exists in this schema), and "missed check-ups" is an analogue of
 * lost to follow-up, not the same measurement.
 *
 * POSITIONING (§1, §5): the positive count is TB-DOTS's entered result, never a
 * conclusion drawn here. No score exists anywhere in this file.
 *
 * ONE CHART ON PURPOSE. An earlier version also drew a year-over-year dumbbell.
 * It was removed: the arrow in its label read left-to-right while its dots ran
 * right-to-left whenever a figure fell, which is two contradictory directions
 * for one fact. The year-on-year comparison lives in the table, which is where
 * the health office sheet keeps it too.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import { manilaToday } from '../lib/types';

interface ReportRow {
  barangay_code: string;
  barangay_name: string;
  city_name: string;
  screened_count: number;
  referred_count: number;
  presented_count: number;
  tested_count: number;
  positive_count: number;
  missed_count: number;
}

/** Measures the reader can rank the chart by. Keys match ReportRow fields. */
const METRICS = ['referred_count', 'positive_count', 'screened_count'] as const;
type Metric = (typeof METRICS)[number];

const BAR = '#016575';
const TOP_N = 12;

async function fetchPeriod(from: string, to: string): Promise<ReportRow[]> {
  const { data, error } = await supabase.rpc('barangay_report', {
    from_date: from,
    to_date: to,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReportRow[];
}

/**
 * The two periods to compare. `end` is capped at today for the current year, and
 * the earlier period is cut to the SAME month and day so the two cover an equal
 * stretch of calendar. See the header.
 */
function periodsFor(year: number, today: string) {
  const [ty, tm, td] = today.split('-');
  const isCurrent = year === Number(ty);
  const endMd = isCurrent ? `${tm}-${td}` : '12-31';
  return {
    isPartial: isCurrent,
    endMd,
    now: { from: `${year}-01-01`, to: `${year}-${endMd}` },
    before: { from: `${year - 1}-01-01`, to: `${year - 1}-${endMd}` },
  };
}

/**
 * "8 September 2026" from "2026-09-08". Built from the parts rather than
 * `new Date(iso)`, which parses a bare date as UTC and can render the day
 * before in a positive-offset zone like Manila.
 */
function readableDate(iso: string, lang: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' })
      .format(new Date(y, m - 1, d));
  } catch {
    return iso; // unknown locale tag: the ISO date is still true, just plainer
  }
}

/** Ranked horizontal bars: one series, one hue, value labelled at the bar end. */
function RankedBars({ rows, metric, label }: { rows: ReportRow[]; metric: Metric; label: string }) {
  const max = rows.reduce((m, r) => Math.max(m, r[metric]), 0);
  const ROW_H = 26;
  const BAR_H = 13;
  const NAME_W = 132;
  const VALUE_W = 44;
  const track = 480 - NAME_W - VALUE_W;
  const height = Math.max(rows.length * ROW_H, ROW_H);

  return (
    // Scrolls rather than squashes: SVG label text keeps its size while the
    // viewBox shrinks, so below ~460px the values overrun their marks.
    <div className="brep-chartwrap">
      <svg
        className="brep-chart"
        viewBox={`0 0 480 ${height}`}
        role="img"
        aria-label={label}
        preserveAspectRatio="xMinYMin meet"
      >
        {rows.map((r, i) => {
          const y = i * ROW_H;
          const w = max ? Math.max((r[metric] / max) * track, r[metric] > 0 ? 3 : 0) : 0;
          return (
            <g key={r.barangay_code}>
              <text x={0} y={y + BAR_H} className="brep-cat" dominantBaseline="middle">
                {r.barangay_name}
              </text>
              <rect x={NAME_W} y={y + BAR_H / 2} width={track} height={1} className="brep-track" />
              <rect x={NAME_W} y={y + 3} width={w} height={BAR_H} rx={4} fill={BAR} />
              <text x={NAME_W + w + 8} y={y + BAR_H} className="brep-val" dominantBaseline="middle">
                {r[metric]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function BarangayReport() {
  const { t, i18n } = useTranslation();
  const today = manilaToday();
  const thisYear = Number(today.slice(0, 4));
  const YEARS = [thisYear, thisYear - 1, thisYear - 2];

  const [year, setYear] = useState(thisYear);
  const [metric, setMetric] = useState<Metric>('referred_count');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [prev, setPrev] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const periods = useMemo(() => periodsFor(year, today), [year, today]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, b] = await Promise.all([
        fetchPeriod(periods.now.from, periods.now.to),
        fetchPeriod(periods.before.from, periods.before.to),
      ]);
      setRows(a);
      setPrev(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [periods]);

  useEffect(() => {
    void load();
  }, [load]);

  const prevByCode = useMemo(() => new Map(prev.map((r) => [r.barangay_code, r])), [prev]);

  const ranked = useMemo(
    () =>
      [...rows].sort(
        (a, b) => b[metric] - a[metric] || a.barangay_name.localeCompare(b.barangay_name),
      ),
    [rows, metric],
  );
  const top = useMemo(() => ranked.filter((r) => r[metric] > 0).slice(0, TOP_N), [ranked, metric]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          screened: a.screened + r.screened_count,
          referred: a.referred + r.referred_count,
          positive: a.positive + r.positive_count,
        }),
        { screened: 0, referred: 0, positive: 0 },
      ),
    [rows],
  );

  const metricLabel = (m: Metric) =>
    ({
      referred_count: t('report.mReferred'),
      positive_count: t('report.mPositive'),
      screened_count: t('report.mScreened'),
    })[m];

  const exportCsv = () => {
    const head = [
      t('report.colBarangay'),
      t('report.colCity'),
      `${t('report.mScreened')} ${year}`,
      `${t('report.mReferred')} ${year}`,
      `${t('report.colTested')} ${year}`,
      `${t('report.mPositive')} ${year}`,
      `${t('report.mMissed')} ${year}`,
      `${t('report.mReferred')} ${year - 1}`,
      `${t('report.mPositive')} ${year - 1}`,
    ];
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const body = ranked.map((r) => {
      const p = prevByCode.get(r.barangay_code);
      return [
        r.barangay_name, r.city_name,
        r.screened_count, r.referred_count, r.tested_count, r.positive_count, r.missed_count,
        p?.referred_count ?? 0, p?.positive_count ?? 0,
      ].map(esc).join(',');
    });
    const csv = [head.map(esc).join(','), ...body].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `barangay-report-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="dcard">
        <div className="dstate">
          <div className="badge">
            <span className="msym" aria-hidden="true">cloud_off</span>
          </div>
          <div className="st-title">{t('report.errorTitle')}</div>
          <div className="st-body">{t('report.errorBody')}</div>
          <button className="retry" onClick={() => void load()}>
            <span className="msym" aria-hidden="true">refresh</span>
            {t('report.retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dcard">
      <div className="hs-head">
        <p className="hs-intro">{t('report.intro')}</p>
        <div className="range-pills">
          {YEARS.map((y) => (
            <button key={y} className={year === y ? 'active' : ''} aria-pressed={year === y} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="hs-list" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="hs-row skel" aria-hidden="true">
              <div className="hs-main">
                <div className="hs-toprow"><span className="b nm" /><span className="b ct" /></div>
                <div className="b tr" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Says what the period IS before any number is read. */}
          <p className="brep-period">
            {periods.isPartial
              ? t('report.periodPartial', { year, end: readableDate(periods.now.to, i18n.language) })
              : t('report.periodFull', { year })}
          </p>

          <div className="brep-kpis">
            <div>
              <span className="brep-k">{totals.screened}</span>
              <span className="brep-l">{t('report.mScreened')}</span>
              <span className="brep-h2">{t('report.dScreened')}</span>
            </div>
            <div>
              <span className="brep-k">{totals.referred}</span>
              <span className="brep-l">{t('report.mReferred')}</span>
              <span className="brep-h2">{t('report.dReferred')}</span>
            </div>
            <div>
              <span className="brep-k">{totals.positive}</span>
              <span className="brep-l">{t('report.mPositive')}</span>
              <span className="brep-h2">{t('report.dPositive')}</span>
            </div>
          </div>

          {top.length === 0 ? (
            <div className="dstate ok">
              <div className="badge"><span className="msym" aria-hidden="true">bar_chart</span></div>
              <div className="st-title">{t('report.empty')}</div>
              <div className="st-body">{t('report.emptyBody')}</div>
            </div>
          ) : (
            <>
              <h3 className="brep-h">{t('report.rankedTitle', { metric: metricLabel(metric) })}</h3>
              <div className="range-pills brep-metrics">
                {METRICS.map((m) => (
                  <button key={m} className={metric === m ? 'active' : ''} aria-pressed={metric === m} onClick={() => setMetric(m)}>
                    {metricLabel(m)}
                  </button>
                ))}
              </div>
              <RankedBars rows={top} metric={metric} label={t('report.rankedTitle', { metric: metricLabel(metric) })} />
            </>
          )}

          <h3 className="brep-h">{t('report.tableTitle')}</h3>
          <div className="brep-tablewrap">
            <table className="brep-table">
              <thead>
                <tr>
                  <th>{t('report.colBarangay')}</th>
                  <th>{t('report.colYear', { metric: t('report.mScreened'), year })}</th>
                  <th>{t('report.colYear', { metric: t('report.mReferred'), year })}</th>
                  <th>{t('report.colYear', { metric: t('report.mReferred'), year: year - 1 })}</th>
                  <th>{t('report.colYear', { metric: t('report.mPositive'), year })}</th>
                  <th>{t('report.colYear', { metric: t('report.mPositive'), year: year - 1 })}</th>
                  <th>{t('report.colYear', { metric: t('report.mMissed'), year })}</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r) => {
                  const p = prevByCode.get(r.barangay_code);
                  return (
                    <tr key={r.barangay_code}>
                      <td>{r.barangay_name}</td>
                      <td>{r.screened_count}</td>
                      <td>{r.referred_count}</td>
                      <td className="brep-prev">{p?.referred_count ?? 0}</td>
                      <td>{r.positive_count}</td>
                      <td className="brep-prev">{p?.positive_count ?? 0}</td>
                      <td>{r.missed_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button className="retry brep-export" onClick={exportCsv}>
            <span className="msym" aria-hidden="true">download</span>
            {t('report.exportCsv')}
          </button>
        </>
      )}

      <div className="dcard-foot">
        <span className="msym" aria-hidden="true">info</span>
        <p>{t('report.scopeNote')}</p>
      </div>
    </div>
  );
}
