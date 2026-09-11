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
  type ReferralRow,
  type ScreeningRow,
  SYMPTOM_KEYS,
  type TbCaseRow,
  type TbCaseStatus,
  type TreatmentFollowupRow,
  type TreatmentOutcome,
} from '../lib/types';
import { hasAnyVital, vitalsRows } from '../lib/vitals';
import CaseLabResults from './CaseLabResults';
import CaseVisitWorkflow from './CaseVisitWorkflow';
import CaseVitalsLog from './CaseVitalsLog';
import PatientTimeline from './PatientTimeline';

const FILTERS: CaseFilter[] = [
  'all', 'active', 'closed', 'followup_due', 'overdue', 'due_soon',
  'appointments_today', 'stale', 'missed',
];
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
  overdue: 'cases.filterValue.overdue',
  due_soon: 'cases.filterValue.due_soon',
  appointments_today: 'cases.filterValue.appointments_today',
  stale: 'cases.filterValue.stale',
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
  onOpenReferral?: (referralId: string) => void;
}

function CaseDetail({ item, onChanged, onOpenReferral }: DetailProps) {
  const { t } = useTranslation();
  const { tbCase, patient } = item;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(manilaToday());
  const [outcome, setOutcome] = useState<TreatmentOutcome>('cured');
  const [outcomeDate, setOutcomeDate] = useState(manilaToday());

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

      <div className="case-clinical-grid">
        <section className="case-clinical-card">
          <h3><span className="msym" aria-hidden="true">checklist</span>{t('cases.preScreening')}</h3>
          {item.screening ? (
            <>
              <div className="case-screening-list">
                {SYMPTOM_KEYS.map((key) => (
                  <div key={key}>
                    <span>{t(`symptoms.${key}`)}</span>
                    <strong>{item.screening?.symptom_flags[key] ? t(`common.${item.screening.symptom_flags[key]}`) : '—'}</strong>
                  </div>
                ))}
              </div>
              <div className="case-pgis"><span>{t('detail.pgisLabel')}</span><strong>{item.screening.pgis_severity ? t(`pgis.${item.screening.pgis_severity}`) : '—'}</strong><small>{t('detail.patientReportedTag')}</small></div>
            </>
          ) : <p className="case-empty-line">{t('cases.noScreening')}</p>}
        </section>

        <section className="case-clinical-card">
          <h3><span className="msym" aria-hidden="true">monitor_heart</span>{t('cases.vitalsAtScreening')}</h3>
          {item.screening && hasAnyVital(item.screening) ? (
            <dl className="vitals-grid">
              {vitalsRows(item.screening, {
                height: t('vitals.height'), weight: t('vitals.weight'), bmi: t('vitals.bmi'),
                temperature: t('vitals.temperature'), bloodPressure: t('vitals.bloodPressure'),
                pulse: t('vitals.pulse'), spo2: t('vitals.spo2'),
              }, {
                cm: t('vitals.unitCm'), kg: t('vitals.unitKg'), bmi: t('vitals.unitBmi'),
                c: t('vitals.unitC'), mmHg: t('vitals.unitMmHg'), bpm: t('vitals.unitBpm'),
                percent: t('vitals.unitPercent'),
              }).map((row) => <div key={row.key} className="vitals-cell"><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
            </dl>
          ) : <p className="case-empty-line">{t('vitals.noneRecorded')}</p>}
        </section>

        <section className="case-clinical-card">
          <h3><span className="msym" aria-hidden="true">biotech</span>{t('cases.labReport')}</h3>
          {item.referral ? (
            <dl className="case-lab-grid">
              <div><dt>{t('detail.sampleIdLabel')}</dt><dd>{item.referral.lab_sample_id ?? '—'}</dd></div>
              <div><dt>{t('cases.labOutcome')}</dt><dd>{item.referral.result_outcome ? t(`detail.outcome${item.referral.result_outcome === 'positive' ? 'Positive' : 'Negative'}`) : '—'}</dd></div>
              <div><dt>{t('cases.labDate')}</dt><dd>{formatDate(item.referral.result_date)}</dd></div>
              <div><dt>{t('cases.labNotes')}</dt><dd>{item.referral.result || '—'}</dd></div>
            </dl>
          ) : <p className="case-empty-line">{t('cases.noLabReport')}</p>}
          {item.referral && onOpenReferral ? (
            <button type="button" className="case-card-link" onClick={() => onOpenReferral(item.referral!.referral_id)}>
              {item.referral.result_outcome ? t('cases.openReferral') : t('cases.recordDiagnosticResult')}
            </button>
          ) : null}
        </section>
      </div>

      <CaseLabResults caseId={tbCase.case_id} caseStatus={tbCase.case_status} />
      <CaseVitalsLog
        caseId={tbCase.case_id}
        caseStatus={tbCase.case_status}
        registrationDate={tbCase.registration_date}
        outcomeDate={tbCase.outcome_date}
      />

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
          <p className="case-outcome-hint">{t('cases.outcomeHint')}</p>
        </div>
      ) : null}

      {error ? <div className="case-error" role="alert">{t('cases.actionError')} {error}</div> : null}

      <CaseVisitWorkflow item={item} onChanged={onChanged} />

      <PatientTimeline patientId={tbCase.patient_id} />

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

export default function CaseRegistry({
  initialCaseId = null,
  initialFilter = 'all',
  onOpenReferral,
}: {
  initialCaseId?: string | null;
  initialFilter?: CaseFilter;
  onOpenReferral?: (referralId: string) => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<CaseRegistryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialCaseId);
  const [filter, setFilter] = useState<CaseFilter>(initialFilter);
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
    const referralIds = cases.flatMap((row) => row.referral_id ? [row.referral_id] : []);
    const [patientResult, followupResult, appointmentResult, referralResult] = await Promise.all([
      supabase.from('patients').select('*').in('patient_id', patientIds),
      supabase.from('treatment_followups').select('*').in('case_id', caseIds).order('visit_date', { ascending: false }),
      supabase.from('appointments').select('*').in('tb_case_id', caseIds).order('scheduled_date', { ascending: true }),
      referralIds.length
        ? supabase.from('referrals').select('*').in('referral_id', referralIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const referrals = (referralResult.data ?? []) as ReferralRow[];
    const screeningIds = [...new Set(referrals.map((row) => row.screening_id))];
    const screeningResult = screeningIds.length
      ? await supabase.from('screenings').select('*').in('screening_id', screeningIds)
      : { data: [], error: null };
    const childError = patientResult.error ?? followupResult.error ?? appointmentResult.error
      ?? referralResult.error ?? screeningResult.error;
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
      referrals,
      (screeningResult.data ?? []) as ScreeningRow[],
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
  useEffect(() => { setFilter(initialFilter); }, [initialFilter]);

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
                <button key={item.tbCase.case_id} className={item.tbCase.case_id === selected?.tbCase.case_id ? 'selected' : ''} onClick={() => setSelectedId(item.tbCase.case_id)}>
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
        {selected ? (
          <CaseDetail
            key={`${selected.tbCase.case_id}:${selected.tbCase.updated_at}`}
            item={selected}
            onChanged={load}
            onOpenReferral={onOpenReferral}
          />
        ) : <div className="case-list-state">{t('cases.selectCase')}</div>}
      </div>
    </div>
  );
}
