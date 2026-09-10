/**
 * Facility dashboard (0037): one count-only RPC for factual attention queues,
 * program totals, and today's activity. Attention cards navigate to the same
 * predicates in the case registry or referral inbox; no patient data, ranking,
 * diagnosis inference, or risk score is produced here.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import type { CaseFilter } from '../lib/caseRegistry';
import type { FacilityDashboardOverview } from '../lib/types';

export type DashboardTarget =
  | { page: 'cases'; filter: CaseFilter }
  | { page: 'inbox'; filter: 'awaiting' };

interface TileSpec {
  key: string;
  n: number;
  label: string;
  sub: string;
  icon: string;
  tone?: 'teal' | 'amber' | 'red' | 'green' | 'slate';
  target?: DashboardTarget;
}

const ZERO: FacilityDashboardOverview = {
  screened_today: 0, referred_today: 0, positive_today: 0, negative_today: 0,
  attended_today: 0, missed_today: 0, scheduled_today: 0,
  attention_overdue_followups: 0, attention_missed_followups: 0,
  attention_due_soon: 0, attention_referrals_awaiting: 0,
  attention_stale_cases: 0, attention_appointments_today: 0,
  metric_screened: 0, metric_referred: 0, metric_referral_received: 0,
  metric_cases_created: 0, metric_active_treatment_cases: 0,
  metric_followups_due: 0, metric_missed_followups: 0, metric_closed_cases: 0,
};

function Tile({ tile, onNavigate }: { tile: TileSpec; onNavigate: (target: DashboardTarget) => void }) {
  const body = (
    <>
      <span className={`chip ${tile.tone ?? 'slate'}`}>
        <span className="msym" aria-hidden="true">{tile.icon}</span>
      </span>
      <span className="val">{tile.n}</span>
      <span className="lbl">{tile.label}</span>
      <span className="sub">{tile.sub}</span>
      {tile.target ? <span className="open msym" aria-hidden="true">arrow_forward</span> : null}
    </>
  );
  return tile.target ? (
    <button className="dtile dashboard-action" onClick={() => onNavigate(tile.target!)}>
      {body}
    </button>
  ) : <div className="dtile">{body}</div>;
}

function SkeletonCard() {
  return (
    <div className="dcard" aria-busy="true">
      <div className="dcard-body"><div className="dgrid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="dtile skel" aria-hidden="true">
            <div className="b chip" /><div className="b val" />
            <div className="b lbl" /><div className="b sub" />
          </div>
        ))}
      </div></div>
    </div>
  );
}

export default function Dashboard({
  onNavigate = () => undefined,
}: {
  onNavigate?: (target: DashboardTarget) => void;
}) {
  const { t } = useTranslation();
  const [counts, setCounts] = useState<FacilityDashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('facility_dashboard_overview');
    if (err) setError(err.message);
    else setCounts(((data ?? []) as FacilityDashboardOverview[])[0] ?? ZERO);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const c = counts ?? ZERO;
  const attention: TileSpec[] = [
    { key: 'overdue', n: c.attention_overdue_followups, label: t('dashboard.attention.overdue'), sub: t('dashboard.attention.overdueSub'), icon: 'pending_actions', tone: 'amber', target: { page: 'cases', filter: 'overdue' } },
    { key: 'missed', n: c.attention_missed_followups, label: t('dashboard.attention.missed'), sub: t('dashboard.attention.missedSub'), icon: 'event_busy', tone: 'red', target: { page: 'cases', filter: 'missed' } },
    { key: 'dueSoon', n: c.attention_due_soon, label: t('dashboard.attention.dueSoon'), sub: t('dashboard.attention.dueSoonSub'), icon: 'event_upcoming', tone: 'teal', target: { page: 'cases', filter: 'due_soon' } },
    { key: 'awaiting', n: c.attention_referrals_awaiting, label: t('dashboard.attention.awaiting'), sub: t('dashboard.attention.awaitingSub'), icon: 'move_to_inbox', tone: 'amber', target: { page: 'inbox', filter: 'awaiting' } },
    { key: 'stale', n: c.attention_stale_cases, label: t('dashboard.attention.stale'), sub: t('dashboard.attention.staleSub'), icon: 'history', tone: 'slate', target: { page: 'cases', filter: 'stale' } },
    { key: 'today', n: c.attention_appointments_today, label: t('dashboard.attention.today'), sub: t('dashboard.attention.todaySub'), icon: 'today', tone: 'green', target: { page: 'cases', filter: 'appointments_today' } },
  ];
  const program: TileSpec[] = [
    { key: 'screened', n: c.metric_screened, label: t('dashboard.program.screened'), sub: t('dashboard.program.screenedSub'), icon: 'fact_check', tone: 'teal' },
    { key: 'referred', n: c.metric_referred, label: t('dashboard.program.referred'), sub: t('dashboard.program.allTime'), icon: 'send', tone: 'slate' },
    { key: 'received', n: c.metric_referral_received, label: t('dashboard.program.received'), sub: t('dashboard.program.receivedSub'), icon: 'move_to_inbox', tone: 'green' },
    { key: 'cases', n: c.metric_cases_created, label: t('dashboard.program.cases'), sub: t('dashboard.program.allTime'), icon: 'clinical_notes', tone: 'teal' },
    { key: 'active', n: c.metric_active_treatment_cases, label: t('dashboard.program.active'), sub: t('dashboard.program.activeSub'), icon: 'medical_services', tone: 'green' },
    { key: 'due', n: c.metric_followups_due, label: t('dashboard.program.due'), sub: t('dashboard.program.dueSub'), icon: 'pending_actions', tone: 'amber' },
    { key: 'missed', n: c.metric_missed_followups, label: t('dashboard.program.missed'), sub: t('dashboard.program.missedSub'), icon: 'event_busy', tone: 'red' },
    { key: 'closed', n: c.metric_closed_cases, label: t('dashboard.program.closed'), sub: t('dashboard.program.allTime'), icon: 'task_alt', tone: 'slate' },
  ];
  const today: TileSpec[] = [
    { key: 'screened', n: c.screened_today, label: t('dashboard.screened'), sub: t('dashboard.screenedSub'), icon: 'fact_check', tone: 'teal' },
    { key: 'referred', n: c.referred_today, label: t('dashboard.referred'), sub: t('dashboard.referredSub'), icon: 'move_to_inbox', tone: 'slate' },
    { key: 'positive', n: c.positive_today, label: t('dashboard.positive'), sub: t('dashboard.positiveSub'), icon: 'coronavirus', tone: 'red' },
    { key: 'negative', n: c.negative_today, label: t('dashboard.negative'), sub: t('dashboard.negativeSub'), icon: 'verified', tone: 'slate' },
    { key: 'attended', n: c.attended_today, label: t('dashboard.attended'), sub: t('dashboard.attendedSub', { total: c.scheduled_today }), icon: 'how_to_reg', tone: 'green' },
    { key: 'missed', n: c.missed_today, label: t('dashboard.missed'), sub: t('dashboard.missedSub'), icon: 'event_busy', tone: 'amber' },
  ];

  if (error) {
    return (
      <div className="dcard"><div className="dstate" role="alert">
        <div className="badge"><span className="msym" aria-hidden="true">cloud_off</span></div>
        <div className="st-title">{t('dashboard.errorTitle')}</div>
        <div className="st-body">{t('dashboard.errorBody')}</div>
        <button className="retry" onClick={() => void load()}>
          <span className="msym" aria-hidden="true">refresh</span>{t('dashboard.retry')}
        </button>
      </div></div>
    );
  }
  if (loading) return <SkeletonCard />;

  const section = (title: string, icon: string, tiles: TileSpec[], note?: string) => (
    <section className="dcard">
      <div className="dcard-head"><div className="title">
        <span className="msym" aria-hidden="true">{icon}</span><h2>{title}</h2>
      </div></div>
      <div className="dcard-body"><div className="dgrid">
        {tiles.map((tile) => <Tile key={tile.key} tile={tile} onNavigate={onNavigate} />)}
      </div></div>
      {note ? <div className="dcard-foot"><span className="msym" aria-hidden="true">info</span><p>{note}</p></div> : null}
    </section>
  );

  return (
    <div className="dashboard-stack">
      <div className="dashboard-toolbar">
        <span>{t('dashboard.updatedNote')}</span>
        <button className="refresh" onClick={() => void load()} disabled={loading}>
          <span className="msym" aria-hidden="true">refresh</span>{t('common.refresh')}
        </button>
      </div>
      {section(t('dashboard.attention.title'), 'priority_high', attention, t('dashboard.attention.note'))}
      {section(t('dashboard.program.title'), 'monitoring', program, t('dashboard.program.note'))}
      {section(t('dashboard.cardTitle'), 'insights', today, t('dashboard.outcomeNote'))}
    </div>
  );
}
