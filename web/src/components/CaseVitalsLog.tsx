/**
 * Vital signs measured during a TB case (migration 0040).
 *
 * The pre-screening vitals are a single snapshot from before the case existed.
 * Weight in particular is taken again at treatment visits, because drug doses
 * follow weight bands. This records each set of measurements by date.
 *
 * Measurements only, exactly as on the screening (§5): the same ranges, the
 * same parsing, BMI computed at display time and never stored, and no
 * interpretation — no category, no colour, no trend verdict.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import {
  manilaToday,
  type CaseVitalsRow,
  type TbCaseStatus,
  type Vitals,
  VITALS_KEYS,
} from '../lib/types';
import { bmiFrom, emptyVitals, parseVital, VITALS_RANGE, vitalsRows } from '../lib/vitals';

const VITALS_LABEL: Record<keyof Vitals, string> = {
  height_cm: 'vitals.height',
  weight_kg: 'vitals.weight',
  temperature_c: 'vitals.temperature',
  systolic_bp: 'vitals.systolic',
  diastolic_bp: 'vitals.diastolic',
  pulse_rate: 'vitals.pulse',
  spo2_percent: 'vitals.spo2',
};

const VITALS_UNIT: Record<keyof Vitals, string> = {
  height_cm: 'vitals.unitCm',
  weight_kg: 'vitals.unitKg',
  temperature_c: 'vitals.unitC',
  systolic_bp: 'vitals.unitMmHg',
  diastolic_bp: 'vitals.unitMmHg',
  pulse_rate: 'vitals.unitBpm',
  spo2_percent: 'vitals.unitPercent',
};

const emptyText = Object.fromEntries(VITALS_KEYS.map((k) => [k, ''])) as Record<keyof Vitals, string>;

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString();
}

interface Props {
  caseId: string;
  caseStatus: TbCaseStatus;
  registrationDate: string;
  outcomeDate: string | null;
}

export default function CaseVitalsLog({ caseId, caseStatus, registrationDate, outcomeDate }: Props) {
  const { t } = useTranslation();
  const today = manilaToday();
  const maxDate = outcomeDate && outcomeDate < today ? outcomeDate : today;
  const [rows, setRows] = useState<CaseVitalsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [measuredOn, setMeasuredOn] = useState(maxDate);
  const [text, setText] = useState<Record<keyof Vitals, string>>(emptyText);
  const [rowId, setRowId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error: err } = await supabase
      .from('case_vitals')
      .select('*')
      .eq('case_id', caseId)
      .order('measured_on', { ascending: false });
    if (err) setLoadError(err.message);
    else setRows((data ?? []) as CaseVitalsRow[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  const vitals: Vitals = { ...emptyVitals };
  const invalid: Partial<Record<keyof Vitals, boolean>> = {};
  for (const key of VITALS_KEYS) {
    const { value, valid } = parseVital(key, text[key]);
    vitals[key] = value;
    if (!valid) invalid[key] = true;
  }
  const allValid = VITALS_KEYS.every((k) => !invalid[k]);
  const anyValue = VITALS_KEYS.some((k) => vitals[k] !== null);
  const bmi = bmiFrom(vitals.height_cm, vitals.weight_kg);

  const resetForm = () => {
    setText(emptyText);
    setMeasuredOn(maxDate);
    setRowId(crypto.randomUUID());
  };

  const save = async () => {
    if (!allValid || !anyValue || !measuredOn) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('case_vitals').insert({
      vitals_id: rowId,
      case_id: caseId,
      measured_on: measuredOn,
      ...vitals,
    });
    if (err && (err as { code?: string }).code !== '23505') {
      setError(err.message);
      setBusy(false);
      return;
    }
    resetForm();
    setFormOpen(false);
    await load();
    setBusy(false);
  };

  const voidRow = async (id: string) => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('void_case_vitals', {
      p_vitals_id: id,
      p_reason: voidReason.trim(),
    });
    if (err) setError(err.message);
    else {
      setVoidingId(null);
      setVoidReason('');
      await load();
    }
    setBusy(false);
  };

  const field = (key: keyof Vitals) => (
    <label key={key}>
      <span>{`${t(VITALS_LABEL[key])} (${t(VITALS_UNIT[key])})`}</span>
      <input
        type="text"
        inputMode={VITALS_RANGE[key].decimals === 1 ? 'decimal' : 'numeric'}
        className={invalid[key] ? 'bad' : undefined}
        aria-invalid={invalid[key] === true}
        value={text[key]}
        onChange={(e) => setText((p) => ({ ...p, [key]: e.target.value }))}
      />
    </label>
  );

  const labels = {
    height: t('vitals.height'), weight: t('vitals.weight'), bmi: t('vitals.bmi'),
    temperature: t('vitals.temperature'), bloodPressure: t('vitals.bloodPressure'),
    pulse: t('vitals.pulse'), spo2: t('vitals.spo2'),
  };
  const units = {
    cm: t('vitals.unitCm'), kg: t('vitals.unitKg'), bmi: t('vitals.unitBmi'),
    c: t('vitals.unitC'), mmHg: t('vitals.unitMmHg'), bpm: t('vitals.unitBpm'),
    percent: t('vitals.unitPercent'),
  };

  const canAdd = caseStatus !== 'cancelled';

  return (
    <section className="case-records" aria-label={t('cases.vitalsLog.title')}>
      <div className="case-records-head">
        <h3><span className="msym" aria-hidden="true">monitor_heart</span>{t('cases.vitalsLog.title')}</h3>
        {canAdd && !formOpen ? (
          <button type="button" onClick={() => { setError(null); setFormOpen(true); }}>
            <span className="msym" aria-hidden="true">add</span>{t('cases.vitalsLog.add')}
          </button>
        ) : null}
      </div>
      <p className="case-records-note">{t('cases.vitalsLog.intro')}</p>

      {formOpen ? (
        <div className="case-visit-form case-records-form">
          <label>
            <span>{t('cases.vitalsLog.measuredOn')}</span>
            <input type="date" min={registrationDate} max={maxDate} value={measuredOn} onChange={(e) => setMeasuredOn(e.target.value)} />
          </label>
          {field('weight_kg')}
          {field('height_cm')}
          <label>
            <span>{t('vitals.bmiDerived')}</span>
            <div className="derived-box">{bmi !== null ? bmi.toFixed(1) : '—'}</div>
          </label>
          {field('temperature_c')}
          {field('spo2_percent')}
          {field('systolic_bp')}
          {field('diastolic_bp')}
          {field('pulse_rate')}
          {!allValid ? <p className="error case-visit-notes">{t('vitals.outOfRange')}</p> : null}
          <div className="case-records-actions">
            <button type="button" disabled={busy || !allValid || !anyValue || !measuredOn} onClick={() => void save()}>
              {busy ? t('cases.vitalsLog.saving') : t('cases.vitalsLog.save')}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => { resetForm(); setFormOpen(false); }}>
              {t('cases.visit.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {loadError ? (
        <div className="case-error" role="alert">{t('cases.vitalsLog.loadError')} {loadError}</div>
      ) : loading ? (
        <p className="case-empty-line">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="case-empty-line">{t('cases.vitalsLog.empty')}</p>
      ) : (
        <div className="case-correction-list">
          {rows.map((row) => (
            <article key={row.vitals_id} className={row.voided_at ? 'voided' : ''}>
              <div><strong>{formatDate(row.measured_on)}</strong></div>
              <dl className="vitals-grid">
                {vitalsRows(row, labels, units).map((v) => (
                  <div key={v.key} className="vitals-cell"><dt>{v.label}</dt><dd>{v.value}</dd></div>
                ))}
              </dl>
              {row.voided_at ? (
                <div className="case-void-summary"><span>{t('cases.visit.voidedReason')} {row.void_reason}</span></div>
              ) : voidingId === row.vitals_id ? (
                <div className="case-inline-editor">
                  <input aria-label={t('cases.visit.voidReason')} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
                  <button disabled={busy || !voidReason.trim()} onClick={() => void voidRow(row.vitals_id)}>{t('cases.visit.confirmVoid')}</button>
                  <button disabled={busy} onClick={() => setVoidingId(null)}>{t('cases.visit.cancel')}</button>
                </div>
              ) : (
                <div className="case-correction-actions">
                  <button className="danger-outline" disabled={busy} onClick={() => { setVoidReason(''); setVoidingId(row.vitals_id); }}>
                    {t('cases.visit.voidRecord')}
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {error ? <div className="case-error" role="alert">{t('cases.vitalsLog.actionError')} {error}</div> : null}
    </section>
  );
}
