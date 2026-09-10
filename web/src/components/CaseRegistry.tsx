/**
 * Facility-scoped TB case registry (migration 0031).
 *
 * Cases are records of clinician enrolment decisions. Nothing in this view
 * infers a diagnosis from a screening or laboratory result. RLS restricts the
 * source rows to the signed-in TB-DOTS facility; every mutation goes through
 * the audited lifecycle RPC instead of a direct table update.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import {
  buildCaseRegistry,
  caseMatchesFilter,
  type CaseFilter,
  type CaseRegistryItem,
} from '../lib/caseRegistry';
import {
  manilaToday,
  type AppointmentRow,
  type PatientRow,
  type TbCaseRow,
  type TbCaseStatus,
  type TreatmentFollowupRow,
  type TreatmentOutcome,
} from '../lib/types';

const FILTERS: CaseFilter[] = ['all', 'active', 'closed', 'followup_due', 'missed'];
const OUTCOMES: TreatmentOutcome[] = [
  'cured',
  'treatment_completed',
  'treatment_failed',
  'died',
  'lost_to_follow_up',
  'not_evaluated',
];

const STATUS_KEY: Record<TbCaseStatus, string> = {
  registered: 'cases.status.registered',
  on_treatment: 'cases.status.onTreatment',
  interrupted: 'cases.status.interrupted',
  closed: 'cases.status.closed',
  cancelled: 'cases.status.cancelled',
};

const OUTCOME_KEY: Record<TreatmentOutcome, string> = {
  cured: 'cases.outcome.cured',
  treatment_completed: 'cases.outcome.completed',
  treatment_failed: 'cases.outcome.failed',
  died: 'cases.outcome.died',
  lost_to_follow_up: 'cases.outcome.lost',
  not_evaluated: 'cases.outcome.notEvaluated',
};

const FILTER_KEY: Record<CaseFilter, string> = {
  all: 'cases.filterValue.all',
  active: 'cases.filterValue.active',
  closed: 'cases.filterValue.closed',
  followup_due: 'cases.filterValue.followup_due',
  missed: 'cases.filterValue.missed',
};

const ATTENTION_KEY = {
  interrupted: 'cases.attention.interrupted',
  missed: 'cases.attention.missed',
  due: 'cases.attention.due',
} as const;

function formatDate(value: string | null): string {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString() : '—';
}

interface DetailProps {
  item: CaseRegistryItem;
  onChanged: () => Promise<void>;
}

function CaseDetail({ item, onChanged }: DetailProps) {
  const { t } = useTranslation();
  const { tbCase, patient } = item;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(manilaToday());
  const [outcome, setOutcome] = useState<TreatmentOutcome>('cured');
  const [outcomeDate, setOutcomeDate] = useState(manilaToday());

  useEffect(() => {
    setError(null);
    setStartDate(tbCase.treatment_start_date ?? manilaToday());
    setOutcome(tbCase.outcome ?? 'cured');
    setOutcomeDate(tbCase.outcome_date ?? manilaToday());
  }, [tbCase.case_id, tbCase.outcome, tbCase.outcome_date, tbCase.treatment_start_date]);

  const transition = async (next: TbCaseStatus) => {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('set_tb_case_status', {
      p_case_id: tbCase.case_id,
      p_new_status: next,
      p_treatment_start_date: next === 'on_treatment' ? startDate : null,
      p_outcome: next === 'closed' ? outcome : null,
      p_outcome_date: next === 'closed' ? outcomeDate : null,
    });
    if (rpcError) {
      setError(rpcError.message);
      setBusy(false);
      return;
    }
    await onChanged();
    setBusy(false);
  };

  return (
    <section className="case-detail" aria-label={t('cases.detailTitle')}>
      <div className="case-detail-head">
        <div>
          <span className="case-kicker">{t('cases.caseNumber')}</span>
          <h2>{tbCase.case_number}</h2>
          <p>{patient?.full_name ?? patient?.display_code ?? t('cases.unknownPatient')}</p>
        </div>
        <span className={`case-status ${tbCase.case_status}`}>
          {t(STATUS_KEY[tbCase.case_status])}
        </span>
      </div>

      <div className="case-facts">
        <div><span>{t('cases.patientCode')}</span><strong>{patient?.display_code ?? '—'}</strong></div>
        <div><span>{t('cases.registrationDate')}</span><strong>{formatDate(tbCase.registration_date)}</strong></div>
        <div><span>{t('cases.treatmentStart')}</span><strong>{formatDate(tbCase.treatment_start_date)}</strong></div>
        <div><span>{t('cases.owningFacility')}</span><strong>{tbCase.facility_id}</strong></div>
        <div><span>{t('cases.originReferral')}</span><strong>{tbCase.referral_id ?? t('cases.walkIn')}</strong></div>
        <div><span>{t('cases.createdAt')}</span><strong>{new Date(tbCase.created_at).toLocaleString()}</strong></div>
        <div><span>{t('cases.createdBy')}</span><strong>{tbCase.created_by}</strong></div>
      </div>

      {tbCase.outcome ? (
        <div className="case-outcome">
          <span>{t('cases.outcomeLabel')}</span>
          <strong>{t(OUTCOME_KEY[tbCase.outcome])}</strong>
          <span>{formatDate(tbCase.outcome_date)}</span>
        </div>
      ) : null}

      {tbCase.case_status === 'registered' ? (
        <div className="case-action-card">
          <label>
            <span>{t('cases.startDate')}</span>
            <input type="date" max={manilaToday()} value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <button disabled={busy || !startDate} onClick={() => void transition('on_treatment')}>
            {t('cases.startTreatment')}
          </button>
          <button className="danger-outline" disabled={busy} onClick={() => void transition('cancelled')}>
            {t('cases.cancelCase')}
          </button>
        </div>
      ) : tbCase.case_status === 'on_treatment' ? (
        <div className="case-action-card">
          <button disabled={busy} onClick={() => void transition('interrupted')}>
            {t('cases.markInterrupted')}
          </button>
          <span>{t('cases.orCloseBelow')}</span>
        </div>
      ) : tbCase.case_status === 'interrupted' ? (
        <div className="case-action-card">
          <button disabled={busy} onClick={() => void transition('on_treatment')}>
            {t('cases.resumeTreatment')}
          </button>
          <span>{t('cases.orCloseBelow')}</span>
        </div>
      ) : null}

      {tbCase.case_status === 'on_treatment' || tbCase.case_status === 'interrupted' ? (
        <div className="case-close-card">
          <h3>{t('cases.closeCase')}</h3>
          <label>
            <span>{t('cases.outcomeLabel')}</span>
            <select value={outcome} onChange={(event) => setOutcome(event.target.value as TreatmentOutcome)}>
              {OUTCOMES.map((value) => <option key={value} value={value}>{t(OUTCOME_KEY[value])}</option>)}
            </select>
          </label>
          <label>
            <span>{t('cases.outcomeDate')}</span>
            <input type="date" max={manilaToday()} value={outcomeDate} onChange={(event) => setOutcomeDate(event.target.value)} />
          </label>
          <button disabled={busy || !outcomeDate} onClick={() => void transition('closed')}>
            {t('cases.closeCase')}
          </button>
        </div>
      ) : null}

      {error ? <div className="case-error" role="alert">{t('cases.actionError')} {error}</div> : null}

      <div className="case-grid">
        <section>
          <h3>{t('cases.followups')}</h3>
          {item.followups.length === 0 ? <p className="case-empty-line">{t('cases.noFollowups')}</p> : (
            <div className="case-event-list">
              {item.followups.map((row) => (
                <article key={row.followup_id} className={row.voided_at ? 'voided' : ''}>
                  <strong>{formatDate(row.visit_date)}</strong>
                  <span>{row.voided_at ? t('cases.voided') : row.notes || t('cases.noNotes')}</span>
                </article>
              ))}
            </div>
          )}
        </section>
        <section>
          <h3>{t('cases.appointments')}</h3>
          {item.appointments.length === 0 ? <p className="case-empty-line">{t('cases.noAppointments')}</p> : (
            <div className="case-event-list">
              {item.appointments.map((row) => (
                <article key={row.appointment_id}>
                  <strong>{formatDate(row.scheduled_date)}</strong>
                  <span>{t(`detail.appt${row.status === 'attended' ? 'Attended' : row.status === 'missed' ? 'Missed' : row.status === 'cancelled' ? 'Cancelled' : 'Scheduled'}`)}</span>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

export default function CaseRegistry({ initialCaseId = null }: { initialCaseId?: string | null }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<CaseRegistryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialCaseId);
  const [filter, setFilter] = useState<CaseFilter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = manilaToday();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: caseData, error: caseError } = await supabase
      .from('tb_cases')
      .select('*')
      .order('created_at', { ascending: false });
    if (caseError) {
      setError(caseError.message);
      setLoading(false);
      return;
    }
    const cases = (caseData ?? []) as TbCaseRow[];
    if (cases.length === 0) {
      setItems([]);
      setSelectedId(null);
      setLoading(false);
      return;
    }

    const caseIds = cases.map((row) => row.case_id);
    const patientIds = [...new Set(cases.map((row) => row.patient_id))];
    const [patientResult, followupResult, appointmentResult] = await Promise.all([
      supabase.from('patients').select('*').in('patient_id', patientIds),
      supabase.from('treatment_followups').select('*').in('case_id', caseIds).order('visit_date', { ascending: false }),
      supabase.from('appointments').select('*').in('tb_case_id', caseIds).order('scheduled_date', { ascending: true }),
    ]);
    const childError = patientResult.error ?? followupResult.error ?? appointmentResult.error;
    if (childError) {
      setError(childError.message);
      setLoading(false);
      return;
    }
    const joined = buildCaseRegistry(
      cases,
      (patientResult.data ?? []) as PatientRow[],
      (followupResult.data ?? []) as TreatmentFollowupRow[],
      (appointmentResult.data ?? []) as AppointmentRow[],
      manilaToday(),
    );
    setItems(joined);
    setSelectedId((current) =>
      current && joined.some((item) => item.tbCase.case_id === current)
        ? current
        : joined[0]?.tbCase.case_id ?? null,
    );
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (initialCaseId) setSelectedId(initialCaseId);
  }, [initialCaseId]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      if (!caseMatchesFilter(item, filter, today)) return false;
      if (!query) return true;
      return item.tbCase.case_number.toLowerCase().includes(query)
        || (item.patient?.display_code ?? '').toLowerCase().includes(query)
        || (item.patient?.full_name ?? '').toLowerCase().includes(query);
    });
  }, [filter, items, search, today]);
  // Keep the detail pane inside the current view. Without this fallback, a
  // filter could show a closed-case list while leaving an active case open.
  const selected = visible.find((item) => item.tbCase.case_id === selectedId)
    ?? visible[0]
    ?? null;

  return (
    <div className="case-registry">
      <aside className="case-master">
        <div className="case-tools">
          <input type="search" aria-label={t('cases.search')} placeholder={t('cases.search')} value={search} onChange={(event) => setSearch(event.target.value)} />
          <select aria-label={t('cases.filter')} value={filter} onChange={(event) => setFilter(event.target.value as CaseFilter)}>
            {FILTERS.map((value) => <option key={value} value={value}>{t(FILTER_KEY[value])}</option>)}
          </select>
          <button aria-label={t('common.refresh')} onClick={() => void load()} disabled={loading}><span className="msym" aria-hidden="true">refresh</span></button>
        </div>

        {error ? <div className="case-list-state" role="alert"><strong>{t('cases.loadError')}</strong><span>{error}</span><button onClick={() => void load()}>{t('inbox.retry')}</button></div>
          : loading ? <div className="case-list-state">{t('common.loading')}</div>
          : visible.length === 0 ? <div className="case-list-state">{t('cases.empty')}</div>
          : <div className="case-list">
              {visible.map((item) => (
                <button key={item.tbCase.case_id} className={item.tbCase.case_id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(item.tbCase.case_id)}>
                  <div><strong>{item.patient?.full_name ?? item.patient?.display_code ?? t('cases.unknownPatient')}</strong><span>{item.tbCase.case_number}</span></div>
                  <span className={`case-status ${item.tbCase.case_status}`}>{t(STATUS_KEY[item.tbCase.case_status])}</span>
                  <dl>
                    <div><dt>{t('cases.latestVisit')}</dt><dd>{formatDate(item.latestFollowup?.visit_date ?? null)}</dd></div>
                    <div><dt>{t('cases.nextAppointment')}</dt><dd>{formatDate(item.nextAppointment?.scheduled_date ?? null)}</dd></div>
                  </dl>
                  {item.attention ? <span className={`case-attention ${item.attention}`}>{t(ATTENTION_KEY[item.attention])}</span> : null}
                </button>
              ))}
            </div>}
      </aside>
      <div className="case-detail-pane">
        {selected ? <CaseDetail item={selected} onChanged={load} /> : <div className="case-list-state">{t('cases.selectCase')}</div>}
      </div>
    </div>
  );
}
