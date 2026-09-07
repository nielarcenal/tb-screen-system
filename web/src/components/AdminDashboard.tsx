/**
 * Admin dashboard (redesign §4): a read-only, program-wide overview for the
 * developer portal — four summary tiles (Facilities / Midwives / BHWs / Open
 * referrals) and a per-facility coverage list. All counts come from the
 * admin_overview() RPC (admin role required, SECURITY DEFINER, migration 0012);
 * admins read no patient or referral rows (§1), so these are counts only.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';

interface CoverageRow {
  facility_id: string;
  facility_name: string;
  /** ACTIVE midwives. Counted deactivated accounts too before 0023. */
  midwives: number;
  midwives_inactive: number;
  /** ACTIVE BHWs. Counted deactivated accounts too before 0023. */
  bhws: number;
  bhws_inactive: number;
  open_referrals: number;
}

interface TileSpec {
  key: string;
  value: number;
  label: string;
  sub: string;
  icon: string;
  iconBg: string;
  iconColor: string;
  valueColor: string;
}

export default function AdminDashboard() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<CoverageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('admin_overview');
    if (err) setError(err.message);
    else setRows((data ?? []) as CoverageRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const facilitiesCount = rows.length;
  const midwivesTotal = rows.reduce((s, r) => s + Number(r.midwives), 0);
  const bhwsTotal = rows.reduce((s, r) => s + Number(r.bhws), 0);
  const openTotal = rows.reduce((s, r) => s + Number(r.open_referrals), 0);
  const midwivesOff = rows.reduce((s, r) => s + Number(r.midwives_inactive), 0);
  const bhwsOff = rows.reduce((s, r) => s + Number(r.bhws_inactive), 0);

  /**
   * The headline number counts people who can actually sign in; deactivated
   * accounts are appended rather than folded in or dropped, so the tile cannot
   * be read as a total that quietly includes them (which is what it did before
   * 0023). Omitted entirely at zero -- "0 deactivated" is noise on every tile
   * in the common case.
   */
  const withOff = (sub: string, off: number) =>
    off > 0 ? `${sub} · ${t('adminDash.deactivated', { count: off })}` : sub;

  const tiles: TileSpec[] = [
    {
      key: 'facilities',
      value: facilitiesCount,
      label: t('adminDash.facilities'),
      sub: t('adminDash.facilitiesSub'),
      icon: 'local_hospital',
      iconBg: '#e6f2f2',
      iconColor: '#028090',
      valueColor: '#028090',
    },
    {
      key: 'midwives',
      value: midwivesTotal,
      label: t('adminDash.midwives'),
      sub: withOff(t('adminDash.midwivesSub'), midwivesOff),
      icon: 'badge',
      iconBg: '#eef4f4',
      iconColor: '#046a78',
      valueColor: '#14302f',
    },
    {
      key: 'bhws',
      value: bhwsTotal,
      label: t('adminDash.bhws'),
      sub: withOff(t('adminDash.bhwsSub'), bhwsOff),
      icon: 'groups',
      iconBg: '#dff0ea',
      iconColor: '#12735f',
      valueColor: '#12735f',
    },
    {
      key: 'open',
      value: openTotal,
      label: t('adminDash.openReferrals'),
      sub: t('adminDash.openSub'),
      icon: 'move_to_inbox',
      iconBg: '#f7ecd8',
      iconColor: '#8a5e00',
      valueColor: '#8a5e00',
    },
  ];

  if (error) {
    return (
      <div className="dstate">
        <div className="badge">
          <span className="msym" aria-hidden="true">
            cloud_off
          </span>
        </div>
        <div className="st-title">{t('adminDash.errorTitle')}</div>
        <div className="st-body">{t('adminDash.errorBody')}</div>
        <button className="retry" onClick={() => void load()}>
          <span className="msym" aria-hidden="true">
            refresh
          </span>
          {t('adminDash.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="capdash">
      {/* Summary tiles. */}
      <div className="dcard">
        <div className="dcard-head">
          <div className="title">
            <span className="msym" aria-hidden="true">
              insights
            </span>
            <h2>{t('adminDash.summaryTitle')}</h2>
          </div>
          <button className="refresh" onClick={() => void load()} disabled={loading}>
            <span className={`msym${loading ? ' spin' : ''}`} aria-hidden="true">
              refresh
            </span>
            {t('common.refresh')}
          </button>
        </div>
        <div className="dcard-body" aria-busy={loading}>
          {loading ? (
            <div className="dgrid">
              {Array.from({ length: 4 }).map((_, i) => (
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
                    {tile.value}
                  </div>
                  <div className="lbl">{tile.label}</div>
                  <div className="sub">{tile.sub}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Per-facility coverage. */}
      <div className="dcard">
        <div className="dcard-head">
          <div className="titlebox">
            <span className="msym" aria-hidden="true">
              monitoring
            </span>
            <div>
              <h2>{t('adminDash.coverageTitle')}</h2>
              <div className="capact-sub">{t('adminDash.coverageSub')}</div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="capact-list">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="capact-row skel" aria-hidden="true">
                <span className="sk av" />
                <div className="capact-info">
                  <span className="sk n" style={{ display: 'block' }} />
                </div>
                <span className="sk num" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="dstate ok">
            <div className="badge">
              <span className="msym" aria-hidden="true">
                domain_disabled
              </span>
            </div>
            <div className="st-title">{t('adminDash.emptyTitle')}</div>
            <div className="st-body">{t('adminDash.emptyBody')}</div>
          </div>
        ) : (
          <div className="capact-list">
            {rows.map((r) => (
              <div key={r.facility_id} className="capact-row">
                <span className="capact-avatar">
                  <span className="msym" aria-hidden="true" style={{ fontSize: 19 }}>
                    local_hospital
                  </span>
                </span>
                <div className="capact-info">
                  <div className="capact-name">{r.facility_name}</div>
                </div>
                <div className="capact-nums">
                  <div className="capact-num">
                    <div className="n">{r.midwives}</div>
                    <div className="w">{t('adminDash.covMidwives')}</div>
                  </div>
                  <div className="capact-num">
                    <div className="n">{r.bhws}</div>
                    <div className="w">{t('adminDash.covBhws')}</div>
                  </div>
                  <div className="capact-num">
                    <div
                      className="n"
                      style={{ color: Number(r.open_referrals) > 0 ? '#a5382f' : '#14302f' }}
                    >
                      {r.open_referrals}
                    </div>
                    <div className="w">{t('adminDash.covOpen')}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
