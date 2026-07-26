/**
 * Referral detail (redesign §4): the right pane of the master-detail split.
 * Patient header + status/result chips; a read-only screening summary (one row
 * per DOH-NTP symptom, answers as colored chips, PGI-S tagged patient-reported);
 * the actions stack — referral receipt (mark received / undo / locked after
 * testing), laboratory outcome (positive/negative + optional notes, RECORDED by
 * staff and never computed, §1), attendance (presented / no-show), and close;
 * then check-up appointments (attend/miss) with an empty state.
 *
 * POSITIONING (§1): the screening block is read-only pre-screening context; the
 * lab outcome is human-entered data, never a computed result.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import { AppointmentRow, ReferralJoined, SYMPTOM_KEYS, toDateOnly } from '../lib/types';

interface Props {
  referralId: string;
  onBack: () => void;
}

export default function ReferralDetail({ referralId, onBack }: Props) {
  const { t } = useTranslation();
  const [referral, setReferral] = useState<ReferralJoined | null>(null);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultText, setResultText] = useState('');
  const [outcome, setOutcome] = useState<'positive' | 'negative' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('referrals')
      .select(
        '*, patients(*, ref_barangays(name), users!patients_enrolled_by_fkey(full_name)), screenings(*)',
      )
      .eq('referral_id', referralId)
      .maybeSingle();
    if (err) {
      setError(err.message);
      setLoaded(true);
      return;
    }
    const r = (data ?? null) as unknown as ReferralJoined | null;
    setReferral(r);
    setResultText(r?.result ?? '');
    setOutcome(r?.result_outcome ?? null);
    if (r) {
      const { data: appts, error: aErr } = await supabase
        .from('appointments')
        .select('*')
        .eq('patient_id', r.patient_id)
        .order('scheduled_date', { ascending: false });
      if (aErr) setError(aErr.message);
      setAppointments((appts ?? []) as AppointmentRow[]);
    }
    setLoaded(true);
  }, [referralId]);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load]);

  /** Run one update then reload; surfaces RLS/network errors inline. */
  const update = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true);
    setError(null);
    const { error: err } = await fn();
    if (err) setError(err.message);
    await load();
    setBusy(false);
  };

  const updateReferral = (fields: Record<string, unknown>) =>
    update(() => supabase.from('referrals').update(fields).eq('referral_id', referralId));

  const updateAppointment = (appointmentId: string, fields: Record<string, unknown>) =>
    update(() =>
      supabase.from('appointments').update(fields).eq('appointment_id', appointmentId),
    );

  if (!loaded) {
    return (
      <div className="rd-empty">
        <div className="badge">
          <span className="msym spin" aria-hidden="true">
            progress_activity
          </span>
        </div>
        <div className="rd-emptybody">{t('common.loading')}</div>
      </div>
    );
  }
  if (!referral) {
    return (
      <div className="rd-empty err">
        <div className="badge">
          <span className="msym" aria-hidden="true">
            error
          </span>
        </div>
        <div className="rd-emptytitle">{t('detail.notFound')}</div>
        {error ? <div className="rd-emptybody">{error}</div> : null}
      </div>
    );
  }

  const p = referral.patients;
  const s = referral.screenings;
  const flags = s.symptom_flags;
  const status = referral.status;

  return (
    <div className="rdetail">
      {/* Patient header. */}
      <div className="rd-head">
        <div className="rd-headrow">
          <div className="rd-hinfo">
            <div className="rd-name">{p.full_name ?? p.display_code}</div>
            <div className="rd-meta">
              {p.display_code} · {t(`sex.${p.sex}`)} · {p.age} ·{' '}
              {p.ref_barangays?.name ?? p.barangay_code}
              {p.sitio ? ` · ${p.sitio}` : ''}
            </div>
            {p.users?.full_name ? (
              <div className="rd-screened">{t('detail.screenedBy', { name: p.users.full_name })}</div>
            ) : null}
          </div>
          <button className="rd-close" onClick={onBack} aria-label={t('common.back')}>
            <span className="msym" aria-hidden="true">
              close
            </span>
          </button>
        </div>
        <div className="rd-chips">
          <span className={`chip ${status}`}>{t(`status.${status}`)}</span>
          {referral.presented === false ? (
            <span className="chip noshow">{t('inbox.presentedNo')}</span>
          ) : null}
          {referral.result_outcome ? (
            <span className={`result-pill ${referral.result_outcome}`}>
              {t(`detail.outcome${referral.result_outcome === 'positive' ? 'Positive' : 'Negative'}`)}
            </span>
          ) : null}
        </div>
      </div>

      {error ? <div className="rd-error">{t('detail.updateError', { message: error })}</div> : null}

      {/* Screening summary — read-only pre-screening context (§1). */}
      <div className="rd-section">
        <div className="rd-sectionhead">
          <span className="msym" aria-hidden="true">
            checklist
          </span>
          <h3>{t('detail.screeningSummary')}</h3>
          <span className="ro-tag">{t('detail.readOnly')}</span>
        </div>
        {SYMPTOM_KEYS.map((k) => (
          <div key={k} className="sym-row">
            <span className="sym-q">{t(`symptoms.${k}`)}</span>
            <span className={`ans ${flags[k] ?? 'none'}`}>
              {flags[k] ? t(`common.${flags[k]}`) : '—'}
            </span>
          </div>
        ))}
        <div className="pgis-row">
          <span className="pgis-q">{t('detail.pgisLabel')}</span>
          <span className="ans neutral">{s.pgis_severity ? t(`pgis.${s.pgis_severity}`) : '—'}</span>
          <span className="pr-tag">{t('detail.patientReportedTag')}</span>
        </div>
        <p className="rd-note">{t('detail.pgisNote')}</p>
      </div>

      {/* Actions. */}
      <div className="rd-section">
        <div className="rd-sectionhead">
          <span className="msym" aria-hidden="true">
            assignment
          </span>
          <h3>{t('detail.actionsSection')}</h3>
        </div>
        <div className="act-stack">
          {/* Referral receipt: submitted → mark; received → undo; tested/closed → locked. */}
          <div className="act-card">
            <div className="act-cardhead">
              <span className="msym" aria-hidden="true">
                move_to_inbox
              </span>
              <span className="act-cardlabel">{t('detail.recvLabel')}</span>
            </div>
            {status === 'submitted' ? (
              <button
                className="act-primary"
                disabled={busy}
                onClick={() => void updateReferral({ status: 'received' })}
              >
                {t('detail.markReceived')}
              </button>
            ) : status === 'received' ? (
              <div className="act-doneRow">
                <span className="act-done">
                  <span className="msym" aria-hidden="true">
                    check_circle
                  </span>
                  {t('status.received')}
                </span>
                <button
                  className="act-undo"
                  disabled={busy}
                  onClick={() => void updateReferral({ status: 'submitted' })}
                >
                  {t('detail.recvUndo')}
                </button>
              </div>
            ) : (
              <div className="act-lockedRow">
                <span className="act-done">
                  <span className="msym" aria-hidden="true">
                    check_circle
                  </span>
                  {t('status.received')}
                </span>
                <span className="act-locked">
                  <span className="msym" aria-hidden="true">
                    lock
                  </span>
                  {t('detail.recvLocked')}
                </span>
              </div>
            )}
          </div>

          {/* Laboratory outcome — human-entered, never computed (§1). */}
          <div className="act-card act-lab">
            <div className="act-cardhead">
              <span className="msym" aria-hidden="true">
                biotech
              </span>
              <span className="act-cardlabel">{t('detail.labTitle')}</span>
              {referral.result_outcome ? (
                <span className={`result-pill ${referral.result_outcome} act-cardpill`}>
                  {t(`detail.outcome${referral.result_outcome === 'positive' ? 'Positive' : 'Negative'}`)}
                </span>
              ) : null}
            </div>
            <p className="act-hint">{t('detail.labHint')}</p>
            <div className="toggle-pair">
              <button
                className={`tog pos${outcome === 'positive' ? ' on' : ''}`}
                disabled={busy}
                onClick={() => setOutcome('positive')}
              >
                {t('detail.outcomePositive')}
              </button>
              <button
                className={`tog neg${outcome === 'negative' ? ' on' : ''}`}
                disabled={busy}
                onClick={() => setOutcome('negative')}
              >
                {t('detail.outcomeNegative')}
              </button>
            </div>
            <textarea
              rows={2}
              placeholder={t('detail.resultPlaceholder')}
              value={resultText}
              onChange={(e) => setResultText(e.target.value)}
            />
            <div className="act-saverow">
              <button
                className="act-primary"
                disabled={busy || outcome === null}
                onClick={() =>
                  void updateReferral({
                    result_outcome: outcome,
                    result: resultText.trim() || null,
                    result_date: new Date().toISOString(),
                    status: 'tested',
                  })
                }
              >
                {t('detail.saveResult')}
              </button>
              {referral.result_date ? (
                <span className="act-savedon">
                  {t('detail.resultSavedOn', {
                    date: new Date(referral.result_date).toLocaleString(),
                  })}
                </span>
              ) : (
                <span className="act-none">{t('detail.resultNone')}</span>
              )}
            </div>
          </div>

          {/* Attendance. */}
          <div className="act-card">
            <div className="act-cardhead">
              <span className="msym" aria-hidden="true">
                how_to_reg
              </span>
              <span className="act-cardlabel">{t('detail.attendLabel')}</span>
            </div>
            <div className="toggle-pair">
              <button
                className={`tog present${referral.presented === true ? ' on' : ''}`}
                disabled={busy || referral.presented === true}
                onClick={() => void updateReferral({ presented: true })}
              >
                {t('detail.markPresented')}
              </button>
              <button
                className={`tog amber${referral.presented === false ? ' on' : ''}`}
                disabled={busy}
                onClick={() =>
                  void updateReferral({ presented: referral.presented === false ? null : false })
                }
              >
                {t('detail.markNoShow')}
              </button>
            </div>
          </div>

          {/* Close / closed indicator. */}
          {status !== 'closed' ? (
            <button
              className="act-close"
              disabled={busy}
              onClick={() => void updateReferral({ status: 'closed' })}
            >
              {t('detail.closeReferral')}
            </button>
          ) : (
            <div className="closed-row">
              <span className="closed-tag">
                <span className="msym" aria-hidden="true">
                  task_alt
                </span>
                {t('detail.closedTag')}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Check-up appointments. */}
      <div className="rd-section">
        <div className="rd-sectionhead">
          <span className="msym" aria-hidden="true">
            calendar_month
          </span>
          <h3>{t('detail.appointmentsSection')}</h3>
        </div>
        {appointments.length === 0 ? (
          <div className="appt-empty">
            <span className="msym" aria-hidden="true">
              event_available
            </span>
            <div className="appt-emptytext">{t('detail.noAppointments')}</div>
          </div>
        ) : (
          <div className="appt-list">
            {appointments.map((a) => (
              <div key={a.appointment_id} className="appt-row">
                <span className="appt-date">{a.scheduled_date}</span>
                <span className={`chip a-${a.status}`}>
                  {a.status === 'scheduled'
                    ? t('detail.apptScheduled')
                    : a.status === 'attended'
                      ? t('detail.apptAttended')
                      : t('detail.apptMissed')}
                </span>
                {a.status === 'scheduled' ? (
                  <span className="appt-actions">
                    <button
                      className="appt-attend"
                      disabled={busy}
                      onClick={() =>
                        void updateAppointment(a.appointment_id, {
                          attended_date: toDateOnly(new Date()),
                          status: 'attended',
                        })
                      }
                    >
                      {t('detail.markAttended')}
                    </button>
                    <button
                      className="appt-miss"
                      disabled={busy}
                      onClick={() => void updateAppointment(a.appointment_id, { status: 'missed' })}
                    >
                      {t('detail.markMissed')}
                    </button>
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Standing outcome note (§1). */}
      <div className="rd-footer">
        <span className="msym" aria-hidden="true">
          info
        </span>
        <p>{t('detail.footerNote')}</p>
      </div>
    </div>
  );
}
