/**
 * Captain dashboard (redesign §4): a read-only overview of the captain's own
 * barangay BHW team — three summary tiles (BHWs / Screenings / Referrals over
 * the last 30 days) and a per-BHW activity list. Everything comes from the
 * bhw_activity() RPC (captain role required, barangay-scoped, 0008) that the
 * BHW-management view already uses; captains read no patient data of any kind
 * (§1), so these are counts only.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import { BhwActivityRow } from '../lib/types';

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

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '·'
  );
}

export default function CaptainDashboard() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<BhwActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('bhw_activity', { days_back: 30 });
    if (err) setError(err.message);
    else setRows((data ?? []) as BhwActivityRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const total = rows.length;
  const active = rows.filter((r) => r.active).length;
  const inactive = total - active;
  const scr30 = rows.reduce((s, r) => s + Number(r.screenings_n), 0);
  const ref30 = rows.reduce((s, r) => s + Number(r.referrals_n), 0);

  const tiles: TileSpec[] = [
    {
      key: 'bhws',
      value: total,
      label: t('capDash.bhws'),
      sub: `${active} ${t('capDash.activeLc')} · ${inactive} ${t('capDash.inactiveLc')}`,
      icon: 'groups',
      iconBg: '#e6f2f2',
      iconColor: '#028090',
      valueColor: '#028090',
    },
    {
      key: 'screenings',
      value: scr30,
      label: t('capDash.screenings'),
      sub: t('capDash.last30'),
      icon: 'fact_check',
      iconBg: '#eef4f4',
      iconColor: '#046a78',
      valueColor: '#14302f',
    },
    {
      key: 'referrals',
      value: ref30,
      label: t('capDash.referrals'),
      sub: t('capDash.last30'),
      icon: 'move_to_inbox',
      iconBg: '#dff0ea',
      iconColor: '#12735f',
      valueColor: '#12735f',
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
        <div className="st-title">{t('capDash.errorTitle')}</div>
        <div className="st-body">{t('capDash.errorBody')}</div>
        <button className="retry" onClick={() => void load()}>
          <span className="msym" aria-hidden="true">
            refresh
          </span>
          {t('capDash.retry')}
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
            <h2>{t('capDash.summaryTitle')}</h2>
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
              {Array.from({ length: 3 }).map((_, i) => (
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

      {/* Per-BHW activity. */}
      <div className="dcard">
        <div className="dcard-head">
          <div className="titlebox">
            <span className="msym" aria-hidden="true">
              monitoring
            </span>
            <div>
              <h2>{t('capDash.activityTitle')}</h2>
              <div className="capact-sub">{t('capDash.activitySub')}</div>
            </div>
          </div>
          <span className="ro-tag">{t('detail.readOnly')}</span>
        </div>

        {loading ? (
          <div className="capact-list">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="capact-row skel" aria-hidden="true">
                <span className="sk av" />
                <div className="capact-info">
                  <span className="sk n" style={{ display: 'block' }} />
                  <span className="sk b" style={{ display: 'block' }} />
                </div>
                <span className="sk num" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="dstate ok">
            <div className="badge">
              <span className="msym" aria-hidden="true">
                group_add
              </span>
            </div>
            <div className="st-title">{t('capDash.emptyTitle')}</div>
            <div className="st-body">{t('capDash.emptyBody')}</div>
          </div>
        ) : (
          <div className="capact-list">
            {rows.map((r) => (
              <div key={r.user_id} className={`capact-row${r.active ? '' : ' inactive'}`}>
                <span className="capact-avatar">{initials(r.full_name)}</span>
                <div className="capact-info">
                  <div className="capact-namerow">
                    <span className="capact-name">{r.full_name}</span>
                    <span className={`chip ${r.active ? 'active' : 'inactive'}`}>
                      {r.active ? t('bhw.active') : t('bhw.deactivated')}
                    </span>
                  </div>
                  <div className="capact-brgy">{r.barangay_name ?? r.barangay_code ?? '—'}</div>
                </div>
                <div className="capact-nums">
                  <div className="capact-num">
                    <div className="n scr">{r.screenings_n}</div>
                    <div className="w">{t('capDash.wordScreenings')}</div>
                  </div>
                  <div className="capact-num">
                    <div className="n ref">{r.referrals_n}</div>
                    <div className="w">{t('capDash.wordReferrals')}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="dcard-foot">
          <span className="msym" aria-hidden="true">
            shield
          </span>
          <p>{t('capDash.footerNote')}</p>
        </div>
      </div>
    </div>
  );
}
