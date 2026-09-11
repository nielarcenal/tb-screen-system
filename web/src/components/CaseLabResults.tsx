/**
 * Laboratory results recorded during a TB case (migration 0040).
 *
 * The diagnostic result stays on the referral, where it was entered; this is
 * for everything after it — above all the DOH-NTP monitoring sputum at month
 * 2, month 5 and the end of treatment, which is what a "Cured" outcome rests
 * on. Every value is typed by facility staff. Nothing here derives an outcome
 * or a classification from the results (§1): the list informs the clinician
 * who closes the case, it never closes it.
 *
 * Rows are append-only. A mistake is voided with a reason and re-entered,
 * the same correction model treatment visits use.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import {
  manilaToday,
  type CaseLabOutcome,
  type CaseLabPurpose,
  type CaseLabResultRow,
  type CaseLabTest,
  type TbCaseStatus,
} from '../lib/types';

const TESTS: CaseLabTest[] = ['smear', 'xpert', 'culture', 'other'];
const PURPOSES: CaseLabPurpose[] = ['month_2', 'month_5', 'end_of_treatment', 'baseline', 'other'];
const OUTCOMES: CaseLabOutcome[] = ['negative', 'positive', 'invalid'];

/** Written out in full so the locale scan sees literal keys. */
const TEST_KEY: Record<CaseLabTest, string> = {
  xpert: 'cases.lab.test.xpert',
  smear: 'cases.lab.test.smear',
  culture: 'cases.lab.test.culture',
  other: 'cases.lab.test.other',
};
const PURPOSE_KEY: Record<CaseLabPurpose, string> = {
  baseline: 'cases.lab.purpose.baseline',
  month_2: 'cases.lab.purpose.month_2',
  month_5: 'cases.lab.purpose.month_5',
  end_of_treatment: 'cases.lab.purpose.end_of_treatment',
  other: 'cases.lab.purpose.other',
};
const OUTCOME_KEY: Record<CaseLabOutcome, string> = {
  positive: 'cases.lab.outcome.positive',
  negative: 'cases.lab.outcome.negative',
  invalid: 'cases.lab.outcome.invalid',
};

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString();
}

interface Props {
  caseId: string;
  caseStatus: TbCaseStatus;
}

export default function CaseLabResults({ caseId, caseStatus }: Props) {
  const { t } = useTranslation();
  const today = manilaToday();
  const [rows, setRows] = useState<CaseLabResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [testType, setTestType] = useState<CaseLabTest>('smear');
  const [purpose, setPurpose] = useState<CaseLabPurpose>('month_2');
  const [resultDate, setResultDate] = useState(today);
  const [outcome, setOutcome] = useState<CaseLabOutcome | null>(null);
  const [sampleId, setSampleId] = useState('');
  const [notes, setNotes] = useState('');
  const [rowId, setRowId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error: err } = await supabase
      .from('case_lab_results')
      .select('*')
      .eq('case_id', caseId)
      .order('result_date', { ascending: false });
    if (err) setLoadError(err.message);
    else setRows((data ?? []) as CaseLabResultRow[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  const resetForm = () => {
    setTestType('smear');
    setPurpose('month_2');
    setResultDate(manilaToday());
    setOutcome(null);
    setSampleId('');
    setNotes('');
    setRowId(crypto.randomUUID());
  };

  const save = async () => {
    if (!outcome || !resultDate) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('case_lab_results').insert({
      lab_result_id: rowId,
      case_id: caseId,
      test_type: testType,
      purpose,
      result_date: resultDate,
      result_outcome: outcome,
      lab_sample_id: sampleId.trim() || null,
      notes: notes.trim() || null,
    });
    // 23505 on our own id means a retried request already landed.
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
    const { error: err } = await supabase.rpc('void_case_lab_result', {
      p_lab_result_id: id,
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

  const canAdd = caseStatus !== 'cancelled';

  return (
    <section className="case-records" aria-label={t('cases.lab.title')}>
      <div className="case-records-head">
        <h3><span className="msym" aria-hidden="true">biotech</span>{t('cases.lab.title')}</h3>
        {canAdd && !formOpen ? (
          <button type="button" onClick={() => { setError(null); setFormOpen(true); }}>
            <span className="msym" aria-hidden="true">add</span>{t('cases.lab.add')}
          </button>
        ) : null}
      </div>
      <p className="case-records-note">{t('cases.lab.schedule')}</p>

      {formOpen ? (
        <div className="case-visit-form case-records-form">
          <label>
            <span>{t('cases.lab.testType')}</span>
            <select value={testType} onChange={(e) => setTestType(e.target.value as CaseLabTest)}>
              {TESTS.map((v) => <option key={v} value={v}>{t(TEST_KEY[v])}</option>)}
            </select>
          </label>
          <label>
            <span>{t('cases.lab.purposeLabel')}</span>
            <select value={purpose} onChange={(e) => setPurpose(e.target.value as CaseLabPurpose)}>
              {PURPOSES.map((v) => <option key={v} value={v}>{t(PURPOSE_KEY[v])}</option>)}
            </select>
          </label>
          <label>
            <span>{t('cases.lab.resultDate')}</span>
            <input type="date" max={today} value={resultDate} onChange={(e) => setResultDate(e.target.value)} />
          </label>
          <label>
            <span>{t('cases.lab.sampleId')}</span>
            <input type="text" value={sampleId} maxLength={64} onChange={(e) => setSampleId(e.target.value)} />
          </label>
          <div className="case-records-outcome" role="group" aria-label={t('cases.lab.resultLabel')}>
            <span>{t('cases.lab.resultLabel')}</span>
            <div className="toggle-pair tri">
              {OUTCOMES.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`tog${outcome === v ? ' on' : ''}`}
                  aria-pressed={outcome === v}
                  onClick={() => setOutcome(v)}
                >
                  {t(OUTCOME_KEY[v])}
                </button>
              ))}
            </div>
          </div>
          <label className="case-visit-notes">
            <span>{t('cases.lab.notes')}</span>
            <textarea value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="case-records-actions">
            <button type="button" disabled={busy || !outcome || !resultDate} onClick={() => void save()}>
              {busy ? t('cases.lab.saving') : t('cases.lab.save')}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => { resetForm(); setFormOpen(false); }}>
              {t('cases.visit.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {loadError ? (
        <div className="case-error" role="alert">{t('cases.lab.loadError')} {loadError}</div>
      ) : loading ? (
        <p className="case-empty-line">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="case-empty-line">{t('cases.lab.empty')}</p>
      ) : (
        <div className="case-correction-list">
          {rows.map((row) => (
            <article key={row.lab_result_id} className={row.voided_at ? 'voided' : ''}>
              <div>
                <strong>{formatDate(row.result_date)} · {t(PURPOSE_KEY[row.purpose])}</strong>
                <span>{t(TEST_KEY[row.test_type])}</span>
              </div>
              <dl className="case-lab-grid">
                <div><dt>{t('cases.lab.resultLabel')}</dt><dd>{t(OUTCOME_KEY[row.result_outcome])}</dd></div>
                <div><dt>{t('cases.lab.sampleId')}</dt><dd>{row.lab_sample_id ?? '—'}</dd></div>
                {row.notes ? <div><dt>{t('cases.lab.notes')}</dt><dd>{row.notes}</dd></div> : null}
              </dl>
              {row.voided_at ? (
                <div className="case-void-summary"><span>{t('cases.visit.voidedReason')} {row.void_reason}</span></div>
              ) : voidingId === row.lab_result_id ? (
                <div className="case-inline-editor">
                  <input aria-label={t('cases.visit.voidReason')} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
                  <button disabled={busy || !voidReason.trim()} onClick={() => void voidRow(row.lab_result_id)}>{t('cases.visit.confirmVoid')}</button>
                  <button disabled={busy} onClick={() => setVoidingId(null)}>{t('cases.visit.cancel')}</button>
                </div>
              ) : (
                <div className="case-correction-actions">
                  <button className="danger-outline" disabled={busy} onClick={() => { setVoidReason(''); setVoidingId(row.lab_result_id); }}>
                    {t('cases.visit.voidRecord')}
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {error ? <div className="case-error" role="alert">{t('cases.lab.actionError')} {error}</div> : null}
    </section>
  );
}
