/**
 * Barangay Report — the per-barangay screening/referral funnel, for a calendar
 * year, with the previous year alongside it.
 *
 * WHY IT LOOKS LIKE THE CITY HEALTH OFFICE SHEET. The CHO compiles its
 * per-barangay TB figures by hand once a year. This view produces the portion
 * of that work the system actually observes, continuously — same shape (a
 * barangay per row, a column per year, ranked), so it can be read next to the
 * signed document.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM, restated in the UI itself because a
 * screenshot of this view will outlive the caveat in the thesis:
 *   - It is NOT the city case register. Only patients seen through this system
 *     are counted; the CHO's "All Forms" figure includes every other source.
 *   - There is NO treatment-completion column, because no treatment register
 *     exists in this schema (see 0027's header).
 *   - "Missed check-ups" is an ANALOGUE of Lost to Follow-Up, not the same
 *     measurement.
 *
 * POSITIONING (§1, §5): the positive count is TB-DOTS's entered result, never a
 * conclusion drawn here. No score exists anywhere in this file.
 *
 * CHART CHOICES (and why, so a later edit does not undo them):
 *   - Ranked bars are ONE series, so they take one hue and need no legend — the
 *     heading names the measure. Sequential, not categorical.
 *   - Year-over-year is "before -> after per item", which is a DUMBBELL: one
 *     hue in two shades, not two competing colours. The pair #7cbec6 / #016575
 *     was picked by running the palette validator over the brand tokens — it
 *     has the widest separation available (CVD ΔE 29.2, normal 29.5). Its
 *     lighter shade sits under 3:1 on paper, which is why every mark here is
 *     directly labelled and the table below carries the same numbers: that is
 *     the required relief, not an oversight.
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

/** The measures a reader can rank by. Keys match ReportRow fields. */
const METRICS = ['referred_count', 'positive_count', 'screened_count', 'missed_count'] as const;
type Metric = (typeof METRICS)[number];

/** Two shades of ONE hue — see the header. Never two competing hues. */
const SHADE_PREV = '#7cbec6';
const SHADE_CURR = '#016575';

const TOP_N = 12;

function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

async function fetchYear(year: number): Promise<ReportRow[]> {
  const { from, to } = yearRange(year);
  const { data, error } = await supabase.rpc('barangay_report', {
    from_date: from,
    to_date: to,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReportRow[];
}

/* ------------------------------------------------------------------ charts */

/**
 * Ranked horizontal bars, one series, one hue. Values are direct-labelled at
 * the data end; there is no axis, because the label IS the value and a second
 * copy of the same number is noise.
 */
function RankedBars({ rows, metric, label }: { rows: ReportRow[]; metric: Metric; label: string }) {
  const max = rows.reduce((m, r) => Math.max(m, r[metric]), 0);
  const ROW_H = 28;
  const BAR_H = 14;
  const NAME_W = 132;
  const VALUE_W = 40;
  const height = Math.max(rows.length * ROW_H, ROW_H);

  return (
    // Scrolls rather than squashes: label text does NOT shrink with the
    // viewBox, so below ~460px the values overrun their marks and clip. A
    // chart you can push sideways stays readable; one scaled to 260px is not.
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
        const track = 480 - NAME_W - VALUE_W;
        const w = max ? Math.max((r[metric] / max) * track, r[metric] > 0 ? 3 : 0) : 0;
        return (
          <g key={r.barangay_code}>
            <text x={0} y={y + BAR_H} className="brep-cat" dominantBaseline="middle">
              {r.barangay_name}
            </text>
            {/* recessive track so a zero row still reads as a row */}
            <rect x={NAME_W} y={y + BAR_H / 2} width={track} height={1} className="brep-track" />
            <rect
              x={NAME_W}
              y={y + 3}
              width={w}
              height={BAR_H}
              rx={4}
              fill={SHADE_CURR}
            />
            <text
              x={NAME_W + w + 8}
              y={y + BAR_H}
              className="brep-val"
              dominantBaseline="middle"
            >
              {r[metric]}
            </text>
          </g>
        );
      })}
    </svg>
    </div>
  );
}

/**
 * Year-over-year dumbbell: previous year and selected year per barangay, joined
 * by a connector so the CHANGE is the shape you read, not two bar heights you
 * have to subtract by eye.
 */
function Dumbbell({
  rows,
  prevByCode,
  metric,
  prevYear,
  year,
  label,
}: {
  rows: ReportRow[];
  prevByCode: Map<string, ReportRow>;
  metric: Metric;
  prevYear: number;
  year: number;
  label: string;
}) {
  const max = rows.reduce(
    (m, r) => Math.max(m, r[metric], prevByCode.get(r.barangay_code)?.[metric] ?? 0),
    0,
  );
  const ROW_H = 30;
  const NAME_W = 132;
  // Wide enough for the "prev → curr" pair at two digits each; at 44 the label
  // ran past the viewBox and clipped at the card edge.
  const PAD_R = 68;
  const height = Math.max(rows.length * ROW_H, ROW_H);
  const track = 480 - NAME_W - PAD_R;
  const x = (v: number) => NAME_W + (max ? (v / max) * track : 0);

  return (
    <>
      <div className="brep-legend">
        <span>
          <i style={{ background: SHADE_PREV }} aria-hidden="true" />
          {prevYear}
        </span>
        <span>
          <i style={{ background: SHADE_CURR }} aria-hidden="true" />
          {year}
        </span>
      </div>
      <div className="brep-chartwrap">
      <svg
        className="brep-chart"
        viewBox={`0 0 480 ${height}`}
        role="img"
        aria-label={label}
        preserveAspectRatio="xMinYMin meet"
      >
        {rows.map((r, i) => {
          const y = i * ROW_H + 15;
          const prev = prevByCode.get(r.barangay_code)?.[metric] ?? 0;
          const curr = r[metric];
          return (
            <g key={r.barangay_code}>
              <text x={0} y={y} className="brep-cat" dominantBaseline="middle">
                {r.barangay_name}
              </text>
              <line
                x1={x(Math.min(prev, curr))}
                x2={x(Math.max(prev, curr))}
                y1={y}
                y2={y}
                className="brep-conn"
              />
              {/* 2px surface ring keeps the dots readable where they overlap */}
              <circle cx={x(prev)} cy={y} r={5} fill={SHADE_PREV} className="brep-dot" />
              <circle cx={x(curr)} cy={y} r={5} fill={SHADE_CURR} className="brep-dot" />
              {/* Anchored to the RIGHT edge, not a fixed offset: "107 → 116"
                  is wider than "6 → 71" and a left-anchored label clipped the
                  widest row at the card boundary. */}
              <text
                x={480}
                y={y}
                textAnchor="end"
                className="brep-val"
                dominantBaseline="middle"
              >
                {prev} → {curr}
              </text>
            </g>
          );
        })}
      </svg>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- view */

export default function BarangayReport() {
  const { t } = useTranslation();
  const thisYear = Number(manilaToday().slice(0, 4));
  const YEARS = [thisYear, thisYear - 1, thisYear - 2];

  const [year, setYear] = useState(thisYear);
  const [metric, setMetric] = useState<Metric>('referred_count');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [prev, setPrev] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (y: number) => {
    setLoading(true);
    setError(null);
    try {
      const [curr, before] = await Promise.all([fetchYear(y), fetchYear(y - 1)]);
      setRows(curr);
      setPrev(before);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(year);
  }, [load, year]);

  const prevByCode = useMemo(
    () => new Map(prev.map((r) => [r.barangay_code, r])),
    [prev],
  );

  // Ranked by the chosen measure. The RPC orders by positives; re-sort here so
  // the pills actually change the ranking rather than only the bar lengths.
  const ranked = useMemo(
    () => [...rows].sort((a, b) => b[metric] - a[metric] || a.barangay_name.localeCompare(b.barangay_name)),
    [rows, metric],
  );
  const top = useMemo(() => ranked.filter((r) => r[metric] > 0).slice(0, TOP_N), [ranked, metric]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          screened: acc.screened + r.screened_count,
          referred: acc.referred + r.referred_count,
          presented: acc.presented + r.presented_count,
          tested: acc.tested + r.tested_count,
          positive: acc.positive + r.positive_count,
          missed: acc.missed + r.missed_count,
        }),
        { screened: 0, referred: 0, presented: 0, tested: 0, positive: 0, missed: 0 },
      ),
    [rows],
  );

  const metricLabel = (m: Metric) =>
    ({
      referred_count: t('report.mReferred'),
      positive_count: t('report.mPositive'),
      screened_count: t('report.mScreened'),
      missed_count: t('report.mMissed'),
    })[m];

  const exportCsv = () => {
    const head = [
      t('report.colBarangay'),
      t('report.colCity'),
      `${t('report.mScreened')} ${year}`,
      `${t('report.mReferred')} ${year}`,
      `${t('report.colPresented')} ${year}`,
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
        r.barangay_name,
        r.city_name,
        r.screened_count,
        r.referred_count,
        r.presented_count,
        r.tested_count,
        r.positive_count,
        r.missed_count,
        p?.referred_count ?? 0,
        p?.positive_count ?? 0,
      ]
        .map(esc)
        .join(',');
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
            <span className="msym" aria-hidden="true">
              cloud_off
            </span>
          </div>
          <div className="st-title">{t('report.errorTitle')}</div>
          <div className="st-body">{t('report.errorBody')}</div>
          <button className="retry" onClick={() => void load(year)}>
            <span className="msym" aria-hidden="true">
              refresh
            </span>
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
            <button
              key={y}
              className={year === y ? 'active' : ''}
              aria-pressed={year === y}
              onClick={() => setYear(y)}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="hs-list" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="hs-row skel" aria-hidden="true">
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
      ) : (
        <>
          <div className="brep-kpis">
            <div>
              <span className="brep-k">{totals.screened}</span>
              <span className="brep-l">{t('report.mScreened')}</span>
            </div>
            <div>
              <span className="brep-k">{totals.referred}</span>
              <span className="brep-l">{t('report.mReferred')}</span>
            </div>
            <div>
              <span className="brep-k">{totals.presented}</span>
              <span className="brep-l">{t('report.colPresented')}</span>
            </div>
            <div>
              <span className="brep-k">{totals.tested}</span>
              <span className="brep-l">{t('report.colTested')}</span>
            </div>
            <div>
              <span className="brep-k">{totals.positive}</span>
              <span className="brep-l">{t('report.mPositive')}</span>
            </div>
            <div>
              <span className="brep-k">{totals.missed}</span>
              <span className="brep-l">{t('report.mMissed')}</span>
            </div>
          </div>

          <div className="range-pills brep-metrics">
            {METRICS.map((m) => (
              <button
                key={m}
                className={metric === m ? 'active' : ''}
                aria-pressed={metric === m}
                onClick={() => setMetric(m)}
              >
                {metricLabel(m)}
              </button>
            ))}
          </div>

          {top.length === 0 ? (
            <div className="dstate ok">
              <div className="badge">
                <span className="msym" aria-hidden="true">
                  bar_chart
                </span>
              </div>
              <div className="st-title">{t('report.empty')}</div>
              <div className="st-body">{t('report.emptyBody')}</div>
            </div>
          ) : (
            <>
              <h3 className="brep-h">{t('report.rankedTitle', { metric: metricLabel(metric), year })}</h3>
              <RankedBars
                rows={top}
                metric={metric}
                label={t('report.rankedTitle', { metric: metricLabel(metric), year })}
              />

              <h3 className="brep-h">
                {t('report.yoyTitle', { metric: metricLabel(metric), prev: year - 1, year })}
              </h3>
              <Dumbbell
                rows={top}
                prevByCode={prevByCode}
                metric={metric}
                prevYear={year - 1}
                year={year}
                label={t('report.yoyTitle', { metric: metricLabel(metric), prev: year - 1, year })}
              />
            </>
          )}

          <div className="brep-tablewrap">
            <table className="brep-table">
              <thead>
                <tr>
                  <th>{t('report.colBarangay')}</th>
                  <th>{t('report.mScreened')}</th>
                  <th>{t('report.mReferred')}</th>
                  <th>{t('report.colPresented')}</th>
                  <th>{t('report.colTested')}</th>
                  <th>{t('report.mPositive')}</th>
                  <th>{t('report.mMissed')}</th>
                  <th>{t('report.colPrevPositive', { year: year - 1 })}</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r) => (
                  <tr key={r.barangay_code}>
                    <td>
                      {r.barangay_name}
                      <span className="brep-sub">{r.city_name}</span>
                    </td>
                    <td>{r.screened_count}</td>
                    <td>{r.referred_count}</td>
                    <td>{r.presented_count}</td>
                    <td>{r.tested_count}</td>
                    <td>{r.positive_count}</td>
                    <td>{r.missed_count}</td>
                    <td>{prevByCode.get(r.barangay_code)?.positive_count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="retry brep-export" onClick={exportCsv}>
            <span className="msym" aria-hidden="true">
              download
            </span>
            {t('report.exportCsv')}
          </button>
        </>
      )}

      <div className="dcard-foot">
        <span className="msym" aria-hidden="true">
          info
        </span>
        <p>{t('report.scopeNote')}</p>
      </div>
    </div>
  );
}
