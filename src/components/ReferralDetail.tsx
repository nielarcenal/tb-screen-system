/**
 * Referral detail (Feature 7): the patient/screening context plus the four
 * TB-DOTS actions from the brief — mark received, record the laboratory
 * result, flag presented / no-show, mark check-up attendance — and closing.
 *
 * POSITIONING (§1): the screening block is read-only pre-screening context.
 * The `result` field is free text RECORDED BY STAFF after laboratory testing —
 * the system never computes or suggests it. PGI-S is shown as supplementary.
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
      .select('*, patients(*, ref_barangays(name)), screenings(*)')
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
      <div className="card">
        <button className="secondary" onClick={onBack}>
          {t('common.back')}
        </button>
        <p className="mutedline" style={{ marginTop: 12 }}>
          {t('detail.notFound')}
        </p>
        {error ? <p className="error">{error}</p> : null}
      </div>
    );
  }

  const p = referral.patients;
  const s = referral.screenings;
  const flags = s.symptom_flags;

  return (
    <>
      <button className="secondary" onClick={onBack} style={{ marginBottom: 12 }}>
        {t('common.back')}
      </button>
      {error ? <p className="error">{t('detail.updateError', { message: error })}</p> : null}

      <div className="card">
        <h2>
          {p.full_name ? `${p.full_name} · ` : ''}
          {p.display_code} — {referral.specimen_id ?? '—'}{' '}
          <span className={`chip ${referral.status}`}>{t(`status.${referral.status}`)}</span>
        </h2>

        <h3>{t('detail.patientSection')}</h3>
        <table className="kv">
          <tbody>
            <tr>
              <td>{t('detail.ageSex')}</td>
              <td>
                {p.age} / {t(`sex.${p.sex}`)}
              </td>
            </tr>
            <tr>
              <td>{t('detail.barangay')}</td>
              <td>{p.ref_barangays?.name ?? p.barangay_code}</td>
            </tr>
            {p.sitio ? (
              <tr>
                <td>{t('detail.sitio')}</td>
                <td>{p.sitio}</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <h3>{t('detail.screeningSection')}</h3>
        <table className="kv">
          <tbody>
            <tr>
              <td>{t('detail.screeningDate')}</td>
              <td>{new Date(s.created_at).toLocaleDateString()}</td>
            </tr>
          </tbody>
        </table>
        <table style={{ maxWidth: 620, marginTop: 8 }}>
          <tbody>
            {SYMPTOM_KEYS.map((k) => (
              <tr key={k}>
                <td>{t(`symptoms.${k}`)}</td>
                <td style={{ width: 90, fontWeight: 600, textAlign: 'center' }}>
                  {flags[k] ? t(`common.${flags[k]}`) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mutedline">
          {s.pgis_severity
            ? t('detail.pgisLine', { value: t(`pgis.${s.pgis_severity}`) })
            : t('detail.pgisNotRecorded')}
        </p>
      </div>

      <div className="card">
        <h3>{t('detail.referralSection')}</h3>

        {referral.status === 'submitted' ? (
          <p>
            <button disabled={busy} onClick={() => void updateReferral({ status: 'received' })}>
              {t('detail.markReceived')}
            </button>
          </p>
        ) : null}

        <p className="mutedline">{t('detail.presentedLabel')}</p>
        <p>
          <button
            disabled={busy || referral.presented === true}
            onClick={() => void updateReferral({ presented: true })}
          >
            {t('detail.markPresented')}
          </button>
          <button
            className="secondary"
            disabled={busy || referral.presented === false}
            onClick={() => void updateReferral({ presented: false })}
          >
            {t('detail.markNoShow')}
          </button>
        </p>

        {/* Structured outcome (0006) — RECORDED by staff, never computed (§1).
            Visible only at the facility; BHWs see referral progress alone. */}
        <p className="mutedline">{t('detail.outcomeLabel')}</p>
        <p>
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
        </p>

        <label htmlFor="result">{t('detail.resultLabel')}</label>
        <textarea
          id="result"
          rows={2}
          style={{ width: '100%', maxWidth: 620 }}
          placeholder={t('detail.resultPlaceholder')}
          value={resultText}
          onChange={(e) => setResultText(e.target.value)}
        />
        <p>
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
          {referral.status !== 'closed' ? (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void updateReferral({ status: 'closed' })}
            >
              {t('detail.closeReferral')}
            </button>
          ) : null}
        </p>
        {referral.result_date ? (
          <p className="mutedline">
            {t('detail.resultSavedOn', {
              date: new Date(referral.result_date).toLocaleString(),
            })}
          </p>
        ) : null}
      </div>

      <div className="card">
        <h3>{t('detail.appointmentsSection')}</h3>
        {appointments.length === 0 ? (
          <p className="mutedline">{t('detail.noAppointments')}</p>
        ) : (
          <table style={{ maxWidth: 720 }}>
            <thead>
              <tr>
                <th>{t('detail.colScheduled')}</th>
                <th>{t('detail.colAttended')}</th>
                <th>{t('detail.colStatus')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <tr key={a.appointment_id}>
                  <td>{a.scheduled_date}</td>
                  <td>{a.attended_date ?? '—'}</td>
                  <td>
                    <span className="chip">
                      {a.status === 'scheduled'
                        ? t('detail.apptScheduled')
                        : a.status === 'attended'
                          ? t('detail.apptAttended')
                          : t('detail.apptMissed')}
                    </span>
                  </td>
                  <td>
                    {a.status === 'scheduled' ? (
                      <>
                        <button
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
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void updateAppointment(a.appointment_id, { status: 'missed' })
                          }
                        >
                          {t('detail.markMissed')}
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
