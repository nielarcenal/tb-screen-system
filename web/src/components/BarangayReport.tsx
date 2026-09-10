/**
 * Barangay Report — screening, registered-case and recorded-outcome counts.
 *
 * Laid out to the redesign guide (docs/TB-Screen_Barangay_Report_UI_Redesign_Guide.md):
 * KPI row, compact ranking card, detailed table with search and pagination.
 * Migration 0039 supplies the new case/outcome aggregate. This remains a
 * counts-only view: it never exposes province-wide patient rows.
 *
 * LIKE FOR LIKE, ALWAYS — the one piece of logic here worth guarding. The
 * comparison period ENDS ON THE SAME DAY OF THE YEAR as the selected one. Pick
 * the current year and you get 1 Jan–today against 1 Jan–today last year; pick
 * a finished year and you get two full years. An earlier version compared a
 * nine-month 2026 against a twelve-month 2025 and made every barangay look like
 * it was improving — a decline that was really just a calendar.
 *
 * WHAT IT DOES NOT CLAIM, restated in the UI because a screenshot outlives a
 * caveat in the thesis: this is not DOH ITIS, and an overdue appointment is not
 * silently reclassified as lost to follow-up. Successful and LTFU totals come
 * only from outcomes explicitly recorded by authorized TB-DOTS staff.
 *
 * POSITIONING (§1, §5): the system reports staff-entered lifecycle facts; it
 * does not infer diagnosis or treatment outcome. No score exists in this file.
 *
 * BARS ARE HTML, NOT SVG. They were inline SVG until the redesign. SVG label
 * text keeps its own size while the viewBox shrinks, so below ~460px the values
 * overran their marks and clipped. A div track with a percentage-width fill
 * reflows at any width, needs no scroll container, and is what HotspotView
 * already does.
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
  case_count: number;
  successful_outcome_count: number;
  lost_to_follow_up_count: number;
}

/** Measures the reader can rank by. Keys match ReportRow fields. */
const METRICS = [
  'referred_count', 'case_count', 'successful_outcome_count',
  'lost_to_follow_up_count', 'screened_count',
] as const;
type Metric = (typeof METRICS)[number];

/** Ranking card shows this many; the table below holds everything. */
const TOP_N = 8;
const PAGE_SIZE = 10;

async function fetchPeriod(from: string, to: string): Promise<ReportRow[]> {
  const { data, error } = await supabase.rpc('barangay_report_v2', {
    from_date: from,
    to_date: to,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReportRow[];
}

/**
 * The two periods to compare. `end` is capped at today for the current year and
 * the earlier period is cut to the SAME month and day, so the two cover an
 * equal stretch of calendar. See the header.
 */
function periodsFor(year: number, today: string) {
  const [ty, tm, td] = today.split('-');
  const isCurrent = year === Number(ty);
  const endMd = isCurrent ? `${tm}-${td}` : '12-31';
  return {
    isPartial: isCurrent,
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
    return iso;
  }
}

export default function BarangayReport() {
  const { t, i18n } = useTranslation();
  const today = manilaToday();
  const thisYear = Number(today.slice(0, 4));
  const YEARS = [thisYear, thisYear - 1, thisYear - 2];

  const [year, setYear] = useState(thisYear);
  const [metric, setMetric] = useState<Metric>('referred_count');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ranked.filter((r) => r.barangay_name.toLowerCase().includes(q)) : ranked;
  }, [ranked, query]);

  // A filter or a re-sort can leave the reader on a page that no longer exists.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => setPage(1), [query, metric, year]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          screened: a.screened + r.screened_count,
          referred: a.referred + r.referred_count,
          cases: a.cases + r.case_count,
          successful: a.successful + r.successful_outcome_count,
          ltfu: a.ltfu + r.lost_to_follow_up_count,
        }),
        { screened: 0, referred: 0, cases: 0, successful: 0, ltfu: 0 },
      ),
    [rows],
  );

  /** Noun form for prose: "Top barangays by referrals", not "by referred". */
  const metricNoun = (m: Metric) =>
    ({
      referred_count: t('report.nReferred'),
      case_count: t('report.nCases'),
      successful_outcome_count: t('report.nSuccessful'),
      lost_to_follow_up_count: t('report.nLtfu'),
      screened_count: t('report.nScreened'),
    })[m];

  const metricLabel = (m: Metric) =>
    ({
      referred_count: t('report.mReferred'),
      case_count: t('report.mCases'),
      successful_outcome_count: t('report.mSuccessful'),
      lost_to_follow_up_count: t('report.mLtfu'),
      screened_count: t('report.mScreened'),
    })[m];

  const exportCsv = () => {
    const head = [
      t('report.colBarangay'),
      t('report.colCity'),
      `${t('report.mScreened')} ${year}`,
      `${t('report.mReferred')} ${year}`,
      `${t('report.mCases')} ${year}`,
      `${t('report.mSuccessful')} ${year}`,
      `${t('report.mLtfu')} ${year}`,
      `${t('report.mScreened')} ${year - 1}`,
      `${t('report.mReferred')} ${year - 1}`,
      `${t('report.mCases')} ${year - 1}`,
      `${t('report.mSuccessful')} ${year - 1}`,
      `${t('report.mLtfu')} ${year - 1}`,
    ];
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const body = ranked.map((r) => {
      const p = prevByCode.get(r.barangay_code);
      return [
        r.barangay_name, r.city_name,
        r.screened_count, r.referred_count, r.case_count,
        r.successful_outcome_count, r.lost_to_follow_up_count,
        p?.screened_count ?? 0, p?.referred_count ?? 0, p?.case_count ?? 0,
        p?.successful_outcome_count ?? 0, p?.lost_to_follow_up_count ?? 0,
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

  const goToTable = () => {
    document.getElementById('brep-all')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  const kpis = [
    { icon: 'fact_check', label: t('report.mScreened'), value: totals.screened, desc: t('report.dScreened'), tone: '' },
    { icon: 'description', label: t('report.mReferred'), value: totals.referred, desc: t('report.dReferred'), tone: '' },
    { icon: 'clinical_notes', label: t('report.mCases'), value: totals.cases, desc: t('report.dCases'), tone: ' warn' },
    { icon: 'task_alt', label: t('report.mSuccessful'), value: totals.successful, desc: t('report.dSuccessful'), tone: '' },
    { icon: 'person_alert', label: t('report.mLtfu'), value: totals.ltfu, desc: t('report.dLtfu'), tone: ' warn' },
  ];

  const max = top.reduce((m, r) => Math.max(m, r[metric]), 0);

  return (
    <div className="brep">
      {/* Period and year sit above everything: what stretch of calendar these
          numbers cover has to be settled before any of them is read. */}
      <div className="brep-toolbar">
        <div className="brep-context">
          <span className="brep-city"><span className="msym" aria-hidden="true">location_city</span>{t('report.cityLabel')}</span>
          <p className="brep-period">
            {periods.isPartial
              ? t('report.periodPartial', { end: readableDate(periods.now.to, i18n.language) })
              : t('report.periodFull', { year })}
          </p>
        </div>
        <div className="range-pills" role="group" aria-label={t('report.yearGroup')}>
          {YEARS.map((y) => (
            <button key={y} className={year === y ? 'active' : ''} aria-pressed={year === y} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="brep-kpirow" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="brep-kpi skel" aria-hidden="true">
              <span className="b l" />
              <span className="b v" />
              <span className="b d" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="brep-kpirow">
            {kpis.map((k) => (
              <div key={k.label} className={`brep-kpi${k.tone}`}>
                <span className="brep-kpi-ic" aria-hidden="true">
                  <span className="msym">{k.icon}</span>
                </span>
                <div className="brep-kpi-body">
                  <span className="brep-kpi-l">{k.label}</span>
                  <span className="brep-kpi-v">{k.value}</span>
                  <span className="brep-kpi-d">{k.desc}</span>
                </div>
              </div>
            ))}
          </div>

          <section className="dcard brep-card" aria-labelledby="brep-rank-h">
            <div className="brep-cardhead">
              <h2 id="brep-rank-h">{t('report.rankedTitle', { metric: metricNoun(metric) })}</h2>
              <button type="button" className="brep-link" onClick={goToTable}>
                {t('report.viewAll')}
                <span className="msym" aria-hidden="true">arrow_forward</span>
              </button>
            </div>

            <div className="range-pills brep-metrics" role="group" aria-label={t('report.metricGroup')}>
              {METRICS.map((m) => (
                <button key={m} className={metric === m ? 'active' : ''} aria-pressed={metric === m} onClick={() => setMetric(m)}>
                  {metricLabel(m)}
                </button>
              ))}
            </div>

            {top.length === 0 ? (
              <div className="dstate ok">
                <div className="badge"><span className="msym" aria-hidden="true">bar_chart</span></div>
                <div className="st-title">{t('report.empty')}</div>
                <div className="st-body">{t('report.emptyBody')}</div>
              </div>
            ) : (
              // An ordered list: the ranking is the semantics, not decoration,
              // so a screen reader gets it from the markup rather than the badge.
              <ol className="brep-rank">
                {top.map((r) => (
                  <li key={r.barangay_code}>
                    <span className="brep-rk" aria-hidden="true">{ranked.indexOf(r) + 1}</span>
                    <span className="brep-nm">{r.barangay_name}</span>
                    <span className="brep-trk">
                      <span className="brep-fill" style={{ width: max ? `${(r[metric] / max) * 100}%` : '0%' }} />
                    </span>
                    <span className="brep-v">{r[metric]}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="dcard brep-card" id="brep-all" aria-labelledby="brep-all-h">
            <div className="brep-cardhead">
              <h2 id="brep-all-h">{t('report.tableTitle')}</h2>
              <label className="brep-search">
                <span className="msym" aria-hidden="true">search</span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('report.searchPlaceholder')}
                  aria-label={t('report.searchPlaceholder')}
                />
              </label>
            </div>

            <div className="brep-tablewrap">
              <p className="brep-citynote">{t('report.cityNote')}</p>
              <div className="brep-defs">
                <span><strong>{t('report.mCases')}</strong> — {t('report.defCases')}</span>
                <span><strong>{t('report.mSuccessful')}</strong> — {t('report.defSuccessful')}</span>
                <span><strong>{t('report.mLtfu')}</strong> — {t('report.defLtfu')}</span>
              </div>
              <table className="brep-table">
                <thead>
                  {/* Grouped by year so equivalent staff-recorded measures are
                      comparable at a glance (guide §9). */}
                  <tr className="brep-grouprow">
                    <th scope="col" rowSpan={2} className="brep-numcol">#</th>
                    <th scope="col" rowSpan={2} className="brep-namecol">{t('report.colBarangay')}</th>
                    <th scope="colgroup" colSpan={5} className="brep-grp">{year}</th>
                    <th scope="colgroup" colSpan={5} className="brep-grp brep-sep">{year - 1}</th>
                  </tr>
                  <tr>
                    <th scope="col">{t('report.mScreened')}</th>
                    <th scope="col">{t('report.mReferred')}</th>
                    <th scope="col">{t('report.mCases')}</th>
                    <th scope="col">{t('report.mSuccessful')}</th>
                    <th scope="col">{t('report.mLtfu')}</th>
                    <th scope="col" className="brep-sep">{t('report.mScreened')}</th>
                    <th scope="col">{t('report.mReferred')}</th>
                    <th scope="col">{t('report.mCases')}</th>
                    <th scope="col">{t('report.mSuccessful')}</th>
                    <th scope="col">{t('report.mLtfu')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const p = prevByCode.get(r.barangay_code);
                    return (
                      <tr key={r.barangay_code}>
                        <td className="brep-numcol">{ranked.indexOf(r) + 1}</td>
                        <th scope="row">{r.barangay_name}</th>
                        <td>{r.screened_count}</td>
                        <td>{r.referred_count}</td>
                        <td>{r.case_count}</td>
                        <td>{r.successful_outcome_count}</td>
                        <td>{r.lost_to_follow_up_count}</td>
                        <td className="brep-prev brep-sep">{p?.screened_count ?? 0}</td>
                        <td className="brep-prev">{p?.referred_count ?? 0}</td>
                        <td className="brep-prev">{p?.case_count ?? 0}</td>
                        <td className="brep-prev">{p?.successful_outcome_count ?? 0}</td>
                        <td className="brep-prev">{p?.lost_to_follow_up_count ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {pageRows.length === 0 && <p className="brep-nomatch">{t('report.noMatch', { q: query })}</p>}
            </div>

            <p className="brep-caveat">{t('report.ltfuCaveat')}</p>

            <div className="brep-foot">
              <span className="brep-count">
                {filtered.length === 0
                  ? t('report.showingNone')
                  : t('report.showing', {
                      from: (safePage - 1) * PAGE_SIZE + 1,
                      to: Math.min(safePage * PAGE_SIZE, filtered.length),
                      total: filtered.length,
                    })}
              </span>
              <div className="brep-pager">
                <button type="button" onClick={() => setPage(safePage - 1)} disabled={safePage <= 1} aria-label={t('report.prevPage')}>
                  <span className="msym" aria-hidden="true">chevron_left</span>
                </button>
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={n === safePage ? 'active' : ''}
                    aria-current={n === safePage ? 'page' : undefined}
                    onClick={() => setPage(n)}
                  >
                    {n}
                  </button>
                ))}
                <button type="button" onClick={() => setPage(safePage + 1)} disabled={safePage >= pageCount} aria-label={t('report.nextPage')}>
                  <span className="msym" aria-hidden="true">chevron_right</span>
                </button>
              </div>
            </div>

            <div className="brep-actions">
              <button className="retry" onClick={exportCsv}>
                <span className="msym" aria-hidden="true">download</span>
                {t('report.exportCsv')}
              </button>
            </div>
          </section>

          <p className="brep-scope">
            <span className="msym" aria-hidden="true">info</span>
            {t('report.scopeNoteV2')}
          </p>
        </>
      )}
    </div>
  );
}
