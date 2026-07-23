/**
 * Referral detail (design 1b): the right-hand panel of the master-detail
 * split — patient header + status chip, compact screening summary with
 * colored answers, and the action stack: mark received (tap again to undo),
 * laboratory outcome (positive/negative + optional notes — RECORDED by staff,
 * never computed, §1), presented / no-show, per-appointment attendance, and
 * closing.
 *
 * POSITIONING (§1): the screening block is read-only pre-screening context.
 * PGI-S is shown as supplementary, patient-reported information.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import {
  AppointmentRow,
  ReferralJoined,
  SYMPTOM_KEYS,
  toDateOnly,
} from '../lib/types';

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

  if (!loaded) return <p>{t('common.loading')}</p>;
  if (!referral) {
    return (
      <>
        <p className="mutedline">{t('detail.notFound')}</p>
        {error ? <p className="error">{error}</p> : null}
      </>
    );
  }

  const p = referral.patients;
  const s = referral.screenings;
  const flags = s.symptom_flags;
  const received = referral.status !== 'submitted';

  return (
    <>
      {error ? <p className="error">{t('detail.updateError', { message: error })}</p> : null}

      {/* Patient header. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>
            {p.full_name ?? p.display_code}
          </div>
          <div className="mutedline" style={{ marginTop: 2 }}>
            {p.display_code} · {t(`sex.${p.sex}`)} · {p.age} ·{' '}
            {p.ref_barangays?.name ?? p.barangay_code}
            {p.sitio ? ` · ${p.sitio}` : ''}
          </div>
          {p.users?.full_name ? (
            <div className="mutedline" style={{ marginTop: 2 }}>
              {t('detail.screenedBy', { name: p.users.full_name })}
            </div>
          ) : null}
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span className={`chip ${referral.status}`}>{t(`status.${referral.status}`)}</span>
            {referral.presented === false ? (
              <span className="chip noshow">{t('inbox.presentedNo')}</span>
            ) : null}
          </div>
        </div>
        <button className="secondary" onClick={onBack} aria-label={t('common.back')}>
          ×
        </button>
      </div>

      {/* Screening summary — read-only pre-screening context (§1). */}
      <h3>
        {t('detail.screeningSummary')} · {new Date(s.created_at).toLocaleDateString()}
      </h3>
      <div className="summarybox">
        {SYMPTOM_KEYS.map((k) => (
          <div key={k} className="row">
            <span className="q">{t(`symptoms.${k}`)}</span>
            <span className={`v ${flags[k] ?? 'no'}`}>
              {flags[k] ? t(`common.${flags[k]}`) : '—'}
            </span>
          </div>
        ))}
        <div className="row pgis">
          <span className="q">
            PGI-S <span className="tag-patient">{t('detail.patientReportedTag')}</span>
          </span>
          <span className="v">
            {s.pgis_severity ? t(`pgis.${s.pgis_severity}`) : '—'}
          </span>
        </div>
      </div>

      {/* Actions. */}
      <h3>{t('detail.actionsSection')}</h3>
      <div className="actionstack">
        {/* Undo only flips received ↔ submitted; a tested/closed referral has
            moved past this stage and must not be demoted. */}
        <button
          className={received ? 'done' : ''}
          disabled={busy || (referral.status !== 'submitted' && referral.status !== 'received')}
          onClick={() =>
            void updateReferral({ status: received ? 'submitted' : 'received' })
          }
        >
          {received ? t('detail.receivedDone') : t('detail.markReceived')}
        </button>

        <p className="mutedline" style={{ margin: '4px 0 0' }}>
          {t('detail.outcomeLabel')}
        </p>
        <div className="pair">
          <button
            className={outcome === 'positive' ? '' : 'secondary'}
            disabled={busy}
            onClick={() => setOutcome('positive')}
          >
            {t('detail.outcomePositive')}
          </button>
          <button
            className={outcome === 'negative' ? '' : 'secondary'}
            disabled={busy}
            onClick={() => setOutcome('negative')}
          >
            {t('detail.outcomeNegative')}
          </button>
        </div>
        <textarea
          rows={2}
          style={{ width: '100%' }}
          placeholder={t('detail.resultPlaceholder')}
          value={resultText}
          onChange={(e) => setResultText(e.target.value)}
        />
        <button
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
          <p className="mutedline" style={{ margin: 0 }}>
            {t('detail.resultSavedOn', {
              date: new Date(referral.result_date).toLocaleString(),
            })}
          </p>
        ) : null}

        <p className="mutedline" style={{ margin: '4px 0 0' }}>
          {t('detail.presentedLabel')}
        </p>
        <div className="pair">
          <button
            className={referral.presented === true ? 'done' : 'secondary'}
            disabled={busy || referral.presented === true}
            onClick={() => void updateReferral({ presented: true })}
          >
            {t('detail.markPresented')}
          </button>
          <button
            className={`amber${referral.presented === false ? ' on' : ''}`}
            disabled={busy}
            onClick={() =>
              void updateReferral({
                presented: referral.presented === false ? null : false,
              })
            }
          >
            {t('detail.markNoShow')}
          </button>
        </div>

        {referral.status !== 'closed' ? (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void updateReferral({ status: 'closed' })}
          >
            {t('detail.closeReferral')}
          </button>
        ) : null}
      </div>

      {/* Check-up appointments — compact rows with attend/miss actions. */}
      <h3>{t('detail.appointmentsSection')}</h3>
      {appointments.length === 0 ? (
        <p className="mutedline">{t('detail.noAppointments')}</p>
      ) : (
        <div className="actionstack">
          {appointments.map((a) => (
            <div key={a.appointment_id} className="summarybox">
              <div className="row">
                <span className="q">{a.scheduled_date}</span>
                <span className="v">
                  {a.status === 'scheduled'
                    ? t('detail.apptScheduled')
                    : a.status === 'attended'
                      ? t('detail.apptAttended')
                      : t('detail.apptMissed')}
                </span>
              </div>
              {a.status === 'scheduled' ? (
                <div className="pair" style={{ marginTop: 6 }}>
                  <button
                    className="secondary"
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
                    className="amber"
                    disabled={busy}
                    onClick={() =>
                      void updateAppointment(a.appointment_id, { status: 'missed' })
                    }
                  >
                    {t('detail.markMissed')}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <p className="notebox" style={{ marginTop: 14 }}>
        {t('detail.dnpNote')}
      </p>
    </>
  );
}
