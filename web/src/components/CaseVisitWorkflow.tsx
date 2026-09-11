import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CaseRegistryItem } from '../lib/caseRegistry';
import { supabase } from '../lib/supabase';
import { manilaToday, type TbCaseStatus, type TreatmentOutcome } from '../lib/types';

interface Props {
  item: CaseRegistryItem;
  onChanged: () => Promise<void>;
}

type VisitTransition = '' | Exclude<TbCaseStatus, 'registered' | 'cancelled'>;

const OUTCOMES: TreatmentOutcome[] = [
  'cured',
  'treatment_completed',
  'treatment_failed',
  'died',
  'lost_to_follow_up',
  'not_evaluated',
];

const OUTCOME_KEY: Record<TreatmentOutcome, string> = {
  cured: 'cases.outcome.cured',
  treatment_completed: 'cases.outcome.completed',
  treatment_failed: 'cases.outcome.failed',
  died: 'cases.outcome.died',
  lost_to_follow_up: 'cases.outcome.lost',
  not_evaluated: 'cases.outcome.notEvaluated',
};

const STATUS_KEY: Record<Exclude<VisitTransition, ''>, string> = {
  on_treatment: 'cases.status.onTreatment',
  interrupted: 'cases.status.interrupted',
  closed: 'cases.status.closed',
};

function allowedTransitions(status: TbCaseStatus): VisitTransition[] {
  if (status === 'registered') return ['', 'on_treatment'];
  if (status === 'on_treatment') return ['', 'interrupted', 'closed'];
  if (status === 'interrupted') return ['', 'on_treatment', 'closed'];
  return [];
}

function appointmentStatusKey(status: string): string {
  if (status === 'attended') return 'detail.apptAttended';
  if (status === 'missed') return 'detail.apptMissed';
  return 'detail.apptScheduled';
}

export default function CaseVisitWorkflow({ item, onChanged }: Props) {
  const { t } = useTranslation();
  const { tbCase } = item;
  const today = manilaToday();
  const [visitDate, setVisitDate] = useState(today);
  const [appointmentId, setAppointmentId] = useState('');
  const [notes, setNotes] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [newStatus, setNewStatus] = useState<VisitTransition>('');
  const [startDate, setStartDate] = useState(tbCase.treatment_start_date ?? today);
  const [outcome, setOutcome] = useState<TreatmentOutcome>('cured');
  const [outcomeDate, setOutcomeDate] = useState(today);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctedDate, setCorrectedDate] = useState('');
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [correctedNotes, setCorrectedNotes] = useState('');
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');

  useEffect(() => {
    setVisitDate(manilaToday());
    setAppointmentId('');
    setNotes('');
    setNextDate('');
    setNewStatus('');
    setStartDate(tbCase.treatment_start_date ?? manilaToday());
    setOutcome('cured');
    setOutcomeDate(manilaToday());
    setRequestId(crypto.randomUUID());
    setError(null);
    setCorrectingId(null);
    setEditingNotesId(null);
    setVoidingId(null);
  }, [tbCase.case_id, tbCase.treatment_start_date]);

  const liveAppointmentIds = useMemo(
    () => new Set(item.followups.filter((row) => !row.voided_at && row.appointment_id).map((row) => row.appointment_id)),
    [item.followups],
  );
  const visitAppointments = item.appointments.filter(
    (row) => row.status !== 'cancelled' && !liveAppointmentIds.has(row.appointment_id),
  );
  const transitions = allowedTransitions(tbCase.case_status);
  const terminal = transitions.length === 0;

  const submitVisit = async () => {
      setBusy(true);
      setError(null);
      const closing = newStatus === 'closed';
      const { error: rpcError } = await supabase.rpc('record_visit', {
        p_case_id: tbCase.case_id,
        p_visit_date: visitDate,
        p_appointment_id: appointmentId || null,
        p_notes: notes.trim() || null,
        p_next_scheduled_date: closing ? null : nextDate || null,
        p_new_case_status: newStatus || null,
        p_treatment_start_date: newStatus === 'on_treatment' ? startDate : null,
        p_outcome: closing ? outcome : null,
        p_outcome_date: closing ? outcomeDate : null,
        p_request_id: requestId,
      });
      if (rpcError) {
        setError(rpcError.message);
        setBusy(false);
        return;
      }
      setRequestId(crypto.randomUUID());
      setNotes('');
      setAppointmentId('');
      setNextDate('');
      setNewStatus('');
      await onChanged();
      setBusy(false);
  };

  const correctDate = async (followupId: string) => {
      setBusy(true);
      setError(null);
      const { error: rpcError } = await supabase.rpc('correct_followup_visit_date', {
        p_followup_id: followupId,
        p_visit_date: correctedDate,
      });
      if (rpcError) setError(rpcError.message);
      else {
        setCorrectingId(null);
        await onChanged();
      }
      setBusy(false);
  };

  const correctNotes = async (followupId: string) => {
      setBusy(true);
      setError(null);
      const { error: updateError } = await supabase
        .from('treatment_followups')
        .update({ notes: correctedNotes.trim() || null })
        .eq('followup_id', followupId);
      if (updateError) setError(updateError.message);
      else {
        setEditingNotesId(null);
        await onChanged();
      }
      setBusy(false);
  };

  const voidFollowup = async (followupId: string) => {
      setBusy(true);
      setError(null);
      const { error: rpcError } = await supabase.rpc('void_tb_followup', {
        p_followup_id: followupId,
        p_reason: voidReason.trim(),
      });
      if (rpcError) setError(rpcError.message);
      else {
        setVoidingId(null);
        setVoidReason('');
        await onChanged();
      }
      setBusy(false);
  };

  const undoAttendance = async (appointmentIdToUndo: string) => {
      setBusy(true);
      setError(null);
      const { error: updateError } = await supabase
        .from('appointments')
        .update({ status: 'scheduled', attended_date: null })
        .eq('appointment_id', appointmentIdToUndo);
      if (updateError) setError(updateError.message);
      else await onChanged();
      setBusy(false);
  };

  return (
    <section className="case-visit-workflow" aria-label={t('cases.visit.title')}>
      <h3>{t('cases.visit.title')}</h3>
      {terminal ? <p className="case-empty-line">{t('cases.visit.terminal')}</p> : (
        <div className="case-visit-form">
          <label>
            <span>{t('cases.visit.appointment')}</span>
            <select value={appointmentId} onChange={(event) => setAppointmentId(event.target.value)}>
              <option value="">{t('cases.visit.unscheduled')}</option>
              {visitAppointments.map((row) => (
                <option key={row.appointment_id} value={row.appointment_id}>
                  {row.scheduled_date} — {t(appointmentStatusKey(row.status))}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('cases.visit.date')}</span>
            <input type="date" min={tbCase.registration_date} max={today} value={visitDate} onChange={(event) => setVisitDate(event.target.value)} />
          </label>
          <label className="case-visit-notes">
            <span>{t('cases.visit.notes')}</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t('cases.visit.notesPlaceholder')} />
          </label>
          <label>
            <span>{t('cases.visit.statusAfter')}</span>
            <select value={newStatus} onChange={(event) => setNewStatus(event.target.value as VisitTransition)}>
              <option value="">{t('cases.visit.noStatusChange')}</option>
              {transitions.filter(Boolean).map((status) => <option key={status} value={status}>{t(STATUS_KEY[status as Exclude<VisitTransition, ''>])}</option>)}
            </select>
          </label>
          {newStatus === 'on_treatment' ? (
            <label>
              <span>{t('cases.startDate')}</span>
              <input type="date" min={tbCase.registration_date} max={today} value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
          ) : null}
          {newStatus === 'closed' ? (
            <>
              <label>
                <span>{t('cases.outcomeLabel')}</span>
                <select value={outcome} onChange={(event) => setOutcome(event.target.value as TreatmentOutcome)}>
                  {OUTCOMES.map((value) => <option key={value} value={value}>{t(OUTCOME_KEY[value])}</option>)}
                </select>
              </label>
              <label>
                <span>{t('cases.outcomeDate')}</span>
                <input type="date" min={visitDate} max={today} value={outcomeDate} onChange={(event) => setOutcomeDate(event.target.value)} />
              </label>
              <p className="case-outcome-hint case-visit-notes">{t('cases.outcomeHint')}</p>
            </>
          ) : (
            <label>
              <span>{t('cases.visit.nextDate')}</span>
              <input type="date" min={today} value={nextDate} onChange={(event) => setNextDate(event.target.value)} />
            </label>
          )}
          <button disabled={busy || !visitDate || (newStatus === 'on_treatment' && !startDate) || (newStatus === 'closed' && !outcomeDate)} onClick={() => void submitVisit()}>
            {busy ? t('cases.visit.saving') : t('cases.visit.save')}
          </button>
        </div>
      )}

      <h3 className="case-corrections-heading">{t('cases.visit.corrections')}</h3>
      {item.followups.length === 0 ? <p className="case-empty-line">{t('cases.noFollowups')}</p> : (
        <div className="case-correction-list">
          {item.followups.map((row) => {
            const linkedAppointment = item.appointments.find((appointment) => appointment.appointment_id === row.appointment_id);
            return (
              <article key={row.followup_id} className={row.voided_at ? 'voided' : ''}>
                <div><strong>{row.visit_date}</strong><span>{row.notes || t('cases.noNotes')}</span></div>
                {row.voided_at ? (
                  <div className="case-void-summary">
                    <span>{t('cases.visit.voidedReason')} {row.void_reason}</span>
                    {linkedAppointment?.status === 'attended'
                      && !liveAppointmentIds.has(linkedAppointment.appointment_id) ? (
                      <button disabled={busy} onClick={() => void undoAttendance(linkedAppointment.appointment_id)}>{t('cases.visit.undoAttendance')}</button>
                    ) : null}
                  </div>
                ) : correctingId === row.followup_id ? (
                  <div className="case-inline-editor">
                    <input aria-label={t('cases.visit.correctedDate')} type="date" min={tbCase.registration_date} max={today} value={correctedDate} onChange={(event) => setCorrectedDate(event.target.value)} />
                    <button disabled={busy || !correctedDate} onClick={() => void correctDate(row.followup_id)}>{t('cases.visit.saveCorrection')}</button>
                    <button disabled={busy} onClick={() => setCorrectingId(null)}>{t('cases.visit.cancel')}</button>
                  </div>
                ) : editingNotesId === row.followup_id ? (
                  <div className="case-inline-editor case-notes-editor">
                    <textarea aria-label={t('cases.visit.correctedNotes')} value={correctedNotes} onChange={(event) => setCorrectedNotes(event.target.value)} />
                    <button disabled={busy} onClick={() => void correctNotes(row.followup_id)}>{t('cases.visit.saveCorrection')}</button>
                    <button disabled={busy} onClick={() => setEditingNotesId(null)}>{t('cases.visit.cancel')}</button>
                  </div>
                ) : voidingId === row.followup_id ? (
                  <div className="case-inline-editor">
                    <input aria-label={t('cases.visit.voidReason')} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} />
                    <button disabled={busy || !voidReason.trim()} onClick={() => void voidFollowup(row.followup_id)}>{t('cases.visit.confirmVoid')}</button>
                    <button disabled={busy} onClick={() => setVoidingId(null)}>{t('cases.visit.cancel')}</button>
                  </div>
                ) : (
                  <div className="case-correction-actions">
                    <button disabled={busy} onClick={() => { setCorrectedDate(row.visit_date); setCorrectingId(row.followup_id); }}>{t('cases.visit.correctDate')}</button>
                    <button disabled={busy} onClick={() => { setCorrectedNotes(row.notes ?? ''); setEditingNotesId(row.followup_id); }}>{t('cases.visit.correctNotes')}</button>
                    <button className="danger-outline" disabled={busy} onClick={() => setVoidingId(row.followup_id)}>{t('cases.visit.voidRecord')}</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {error ? <div className="case-error" role="alert">{t('cases.visit.actionError')} {error}</div> : null}
    </section>
  );
}
