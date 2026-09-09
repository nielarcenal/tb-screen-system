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
 * lab outcome is human-entered data, never a computed result. Vitals (0024) are
 * shown as measurements with units and NO interpretation — no colour coding, no
 * "normal range", no verdict of any kind. Reading them is the clinician's job.
 *
 * The laboratory sample id lives here too, and only here: sputum is collected at
 * this facility, so referrals.lab_sample_id is entered by the staff member who
 * takes the sample. The BHW app never writes it (migration 0024).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import { AppointmentRow, ReferralJoined, SYMPTOM_KEYS, manilaToday } from '../lib/types';
import { hasAnyVital, vitalsRows } from '../lib/vitals';

interface Props {
  referralId: string;
  onBack: () => void;
}

/** Whole-day difference toIso − fromIso for local YYYY-MM-DD strings. */
function dayDiff(fromIso: string, toIso: string): number {
  const [ay, am, ad] = fromIso.split('-').map(Number);
  const [by, bm, bd] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export default function ReferralDetail({ referralId, onBack }: Props) {
  const { t } = useTranslation();
  const [referral, setReferral] = useState<ReferralJoined | null>(null);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultText, setResultText] = useState('');
  const [outcome, setOutcome] = useState<'positive' | 'negative' | null>(null);
  // The sample id this facility assigns when it collects sputum (0024). Held as
  // typed text; saved explicitly, because an id half-entered is not an id.
  const [sampleId, setSampleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  // Inline "record attendance" editor: which appointment, and the date the
  // patient ACTUALLY came (may differ from the scheduled date — early or late).
  const [attendId, setAttendId] = useState<string | null>(null);
  const [attendDate, setAttendDate] = useState('');

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('referrals')
      .select(
        '*, patients(*, ref_barangays(name), users!patients_enrolled_by_fkey(full_name, role)), screenings(*)',
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
    setSampleId(r?.lab_sample_id ?? '');
    if (r) {
      // Migration 0031 makes ownership explicit. This referral panel shows its
      // pre-case appointments; treatment visits move to the case detail.
      const { data: appts, error: aErr } = await supabase
        .from('appointments')
        .select('*')
        .eq('referral_id', r.referral_id)
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

  // Reopen restores the last meaningful stage: tested if an outcome was recorded,
  // otherwise received (the referral had to be received to be worked and closed).
  const reopenStatus: 'tested' | 'received' = referral.result_outcome ? 'tested' : 'received';
  const patientId = referral.patient_id;
  const todayStr = manilaToday();
  const minScheduleDate = todayStr; // today or later — same-day check-ups allowed

  // Record attendance on the day the patient actually came (default today, never
  // future). Handles early, on-time, and late arrivals, and recovers a row that
  // was previously marked missed. `on` pre-fills when correcting an existing date.
  const openAttend = (id: string, on?: string | null) => {
    setAttendId(id);
    setAttendDate(on ?? todayStr);
  };
  const confirmAttend = async (id: string) => {
    if (!attendDate) return;
    await updateAppointment(id, { attended_date: attendDate, status: 'attended' });
    setAttendId(null);
  };
  // Undo a mistaken attended/missed back to an open 'scheduled' appointment.
  const undoAppointment = (id: string) =>
    updateAppointment(id, { attended_date: null, status: 'scheduled' });

  /** Neutral early / on-time / late note from the two dates — descriptive, not scored (§1). */
  const timingNote = (a: AppointmentRow): string | null => {
    if (a.status !== 'attended' || !a.attended_date) return null;
    const d = dayDiff(a.scheduled_date, a.attended_date);
    if (d === 0) return t('detail.apptOnTime');
    return d < 0 ? t('detail.apptEarly', { count: -d }) : t('detail.apptLate', { count: d });
  };

  /** Human relative date vs today: today/yesterday/tomorrow, else N days/months/years ago or ahead. */
  const relativeDate = (iso: string): string => {
    const d = dayDiff(todayStr, iso); // signed: iso − today
    if (d === 0) return t('detail.relToday');
    if (d === -1) return t('detail.relYesterday');
    if (d === 1) return t('detail.relTomorrow');
    const ad = Math.abs(d);
    const past = d < 0;
    if (ad < 30) {
      return past ? t('detail.relDaysAgo', { count: ad }) : t('detail.relInDays', { count: ad });
    }
    if (ad < 365) {
      const m = Math.round(ad / 30.44);
      return past ? t('detail.relMonthsAgo', { count: m }) : t('detail.relInMonths', { count: m });
    }
    const y = Math.round(ad / 365.25);
    return past ? t('detail.relYearsAgo', { count: y }) : t('detail.relInYears', { count: y });
  };

  // Schedule a follow-up check-up (RLS: appointments_tbdots_insert, migration 0011 —
  // staff may insert only for a patient referred to their own facility).
  const scheduleCheckup = async () => {
    if (!scheduleDate) return;
    setScheduling(true);
    setScheduleError(null);
    const { error: err } = await supabase
      .from('appointments')
      .insert({
        patient_id: patientId,
        facility_id: referral.facility_id,
        referral_id: referral.referral_id,
        scheduled_date: scheduleDate,
      });
    if (err) {
      setScheduleError(err.message);
      setScheduling(false);
      return;
    }
    setScheduling(false);
    setScheduleOpen(false);
    setScheduleDate('');
    await load();
  };

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
              <div className="rd-screened">
                {p.users.role === 'tb_dots'
                  ? // Registered at this facility, not referred in by a BHW
                    // (0025). Same row, same actions — only the origin differs,
                    // and naming it stops a walk-in reading as a missing BHW.
                    t('detail.registeredHere', { name: p.users.full_name })
                  : t('detail.screenedBy', { name: p.users.full_name })}
              </div>
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

        {/* Vitals (0024) — measurements with units, no interpretation (§5). */}
        <div className="vitals-block">
          <div className="vitals-head">
            <span className="msym" aria-hidden="true">
              monitor_heart
            </span>
            <span className="vitals-title">{t('vitals.heading')}</span>
            <span className="ro-tag">{t('vitals.optionalTag')}</span>
          </div>
          {hasAnyVital(s) ? (
            <>
              <dl className="vitals-grid">
                {vitalsRows(
                  s,
                  {
                    height: t('vitals.height'),
                    weight: t('vitals.weight'),
                    bmi: t('vitals.bmi'),
                    temperature: t('vitals.temperature'),
                    bloodPressure: t('vitals.bloodPressure'),
                    pulse: t('vitals.pulse'),
                    spo2: t('vitals.spo2'),
                  },
                  {
                    cm: t('vitals.unitCm'),
                    kg: t('vitals.unitKg'),
                    bmi: t('vitals.unitBmi'),
                    c: t('vitals.unitC'),
                    mmHg: t('vitals.unitMmHg'),
                    bpm: t('vitals.unitBpm'),
                    percent: t('vitals.unitPercent'),
                  },
                ).map((row) => (
                  <div key={row.key} className="vitals-cell">
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="rd-note">{t('vitals.contextNote')}</p>
            </>
          ) : (
            <p className="rd-note">{t('vitals.noneRecorded')}</p>
          )}
        </div>
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

            {/* Laboratory sample id — THIS facility's, entered when sputum is
                collected here (0024). Deliberately not offered while the
                referral is still 'submitted': the patient has not arrived, so
                there is no sample and nothing to name. */}
            {status === 'submitted' ? (
              <p className="act-hint">{t('detail.sampleIdPending')}</p>
            ) : (
              <div className="sample-row">
                <label className="sample-field">
                  <span>{t('detail.sampleIdLabel')}</span>
                  <input
                    type="text"
                    value={sampleId}
                    placeholder={t('detail.sampleIdPlaceholder')}
                    onChange={(e) => setSampleId(e.target.value)}
                  />
                </label>
                <button
                  className="act-primary secondary"
                  disabled={busy || sampleId.trim() === (referral.lab_sample_id ?? '')}
                  onClick={() =>
                    void updateReferral({ lab_sample_id: sampleId.trim() || null })
                  }
                >
                  {t('detail.sampleIdSave')}
                </button>
              </div>
            )}
            <p className="act-hint">{t('detail.sampleIdHint')}</p>
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
              aria-label={t('detail.resultLabel')}
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
              <button
                className="reopen-btn"
                disabled={busy}
                onClick={() => void updateReferral({ status: reopenStatus })}
              >
                {t('detail.reopen')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Check-up appointments owned by this referral (migration 0031). */}
      <div className="rd-section">
        <div className="rd-sectionhead">
          <span className="msym" aria-hidden="true">
            calendar_month
          </span>
          <h3>{t('detail.appointmentsSection')}</h3>
          <button
            className="appt-schedbtn"
            onClick={() => {
              setScheduleError(null);
              setScheduleOpen((o) => !o);
            }}
          >
            <span className="msym" aria-hidden="true">
              add
            </span>
            {t('detail.scheduleBtn')}
          </button>
        </div>

        <p className="rd-note">{t('detail.appointmentsScope')}</p>

        {scheduleOpen ? (
          <div className="sched-form">
            <div className="sched-row">
              <label className="sched-field">
                <span>{t('detail.scheduleDateLabel')}</span>
                <input
                  type="date"
                  min={minScheduleDate}
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                />
              </label>
              <div className="sched-actions">
                <button
                  className="sched-confirm"
                  disabled={scheduling || !scheduleDate}
                  onClick={() => void scheduleCheckup()}
                >
                  {scheduling ? (
                    <>
                      <span className="msym" aria-hidden="true">
                        progress_activity
                      </span>
                      {t('detail.scheduling')}
                    </>
                  ) : (
                    t('detail.scheduleConfirm')
                  )}
                </button>
                <button
                  className="sched-cancel"
                  disabled={scheduling}
                  onClick={() => {
                    setScheduleOpen(false);
                    setScheduleError(null);
                  }}
                >
                  {t('detail.cancel')}
                </button>
              </div>
            </div>
            <div className="sched-hint">
              <span className="msym" aria-hidden="true">
                event_upcoming
              </span>
              {t('detail.dateFutureHint')}
            </div>
            {scheduleError ? (
              <div className="sched-error">
                <span className="msym" aria-hidden="true">
                  error
                </span>
                <span className="se-msg">{t('detail.scheduleError')}</span>
                <button className="se-retry" onClick={() => void scheduleCheckup()}>
                  {t('detail.retry')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

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
                <span className="appt-date">{relativeDate(a.scheduled_date)}</span>
                <span className="appt-exactdate">{a.scheduled_date}</span>
                <span className={`chip a-${a.status}`}>
                  {a.status === 'scheduled'
                    ? t('detail.apptScheduled')
                    : a.status === 'attended'
                      ? t('detail.apptAttended')
                      : a.status === 'missed'
                        ? t('detail.apptMissed')
                        : t('detail.apptCancelled')}
                </span>
                {timingNote(a) ? <span className="appt-timing">{timingNote(a)}</span> : null}
                {attendId === a.appointment_id ? (
                  <span className="appt-attendform">
                    <input
                      type="date"
                      max={todayStr}
                      aria-label={t('detail.attendDateLabel')}
                      value={attendDate}
                      onChange={(e) => setAttendDate(e.target.value)}
                    />
                    <button
                      className="appt-attend"
                      disabled={busy || !attendDate}
                      onClick={() => void confirmAttend(a.appointment_id)}
                    >
                      {t('detail.attendConfirm')}
                    </button>
                    <button className="appt-undo" disabled={busy} onClick={() => setAttendId(null)}>
                      {t('detail.cancel')}
                    </button>
                  </span>
                ) : (
                  <span className="appt-actions">
                    {a.status === 'scheduled' ? (
                      <>
                        <button
                          className="appt-attend"
                          disabled={busy}
                          onClick={() => openAttend(a.appointment_id)}
                        >
                          {t('detail.markAttended')}
                        </button>
                        <button
                          className="appt-miss"
                          disabled={busy}
                          onClick={() =>
                            void updateAppointment(a.appointment_id, { status: 'missed' })
                          }
                        >
                          {t('detail.markMissed')}
                        </button>
                        <button
                          className="appt-cancel"
                          disabled={busy}
                          onClick={() =>
                            void updateAppointment(a.appointment_id, {
                              attended_date: null,
                              status: 'cancelled',
                            })
                          }
                        >
                          {t('detail.cancelAppointment')}
                        </button>
                      </>
                    ) : a.status === 'attended' ? (
                      <>
                        <button
                          className="appt-editdate"
                          disabled={busy}
                          onClick={() => openAttend(a.appointment_id, a.attended_date)}
                        >
                          {t('detail.editAttendDate')}
                        </button>
                        <button
                          className="appt-undo"
                          disabled={busy}
                          onClick={() => void undoAppointment(a.appointment_id)}
                        >
                          {t('detail.apptUndo')}
                        </button>
                      </>
                    ) : a.status === 'missed' ? (
                      <>
                        <button
                          className="appt-attend"
                          disabled={busy}
                          onClick={() => openAttend(a.appointment_id)}
                        >
                          {t('detail.recordAttendance')}
                        </button>
                        <button
                          className="appt-undo"
                          disabled={busy}
                          onClick={() => void undoAppointment(a.appointment_id)}
                        >
                          {t('detail.apptUndo')}
                        </button>
                      </>
                    ) : (
                      <button
                        className="appt-undo"
                        disabled={busy}
                        onClick={() => void undoAppointment(a.appointment_id)}
                      >
                        {t('detail.apptUndo')}
                      </button>
                    )}
                  </span>
                )}
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
