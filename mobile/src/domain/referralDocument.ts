/**
 * The printable REFERRAL DOCUMENT (was "specimen form" until the referral-model
 * correction of 2026-09-06): the QR payload and the printable HTML for
 * expo-print.
 *
 * WHAT THIS DOCUMENT IS, AND IS NOT. It is an informational slip a patient may
 * optionally carry to the TB-DOTS facility. It is NOT tied to a physical sample
 * and nothing travels with it — sputum is collected only at the facility, never
 * at the barangay, so a BHW hands over a person and a history, not a specimen.
 * PRINTING IS OPTIONAL in the strongest sense: the referral row reaches the
 * facility portal the moment it is created and syncs, print or no print, and
 * nothing in the app is gated on this screen being opened.
 *
 * There is deliberately no lab sample id anywhere on it. That id belongs to
 * TB-DOTS and is entered by facility staff when they collect the sample on-site
 * (referrals.lab_sample_id, migration 0024); at the moment this document is
 * produced it does not exist, and printing an empty box labelled "Specimen ID"
 * is exactly the misunderstanding this correction retires.
 *
 * POSITIONING (§1): the header, subheading, and footer all carry the
 * non-diagnostic disclaimer, and no field is ever labeled as a result,
 * probability, or score. Vitals are printed as measurements with units and no
 * interpretation (§5) — see domain/vitals.ts.
 *
 * PRIVACY (§4): the paper may pass through several hands and its QR can be
 * scanned by anyone holding it — so the payload and HTML NEVER include the
 * patient's contact number, and the QR payload also excludes the patient's
 * name: the printed sheet shows the name for the receiving facility, but the
 * machine-readable payload stays code-only.
 */
import { PgisSeverity, Sex, SymptomFlags, Vitals } from '../db/types';
import { SYMPTOM_KEYS } from './screeningRules';
import { bmiFrom, formatBloodPressure, formatVital, hasAnyVital } from './vitals';

export interface ReferralDocumentData {
  referralId: string;
  screeningId: string;
  patientId: string;
  displayCode: string;
  patientName: string | null;
  age: number;
  sex: Sex;
  barangayCode: string;
  barangayLabel: string;
  sitio: string | null;
  flags: SymptomFlags;
  pgis: PgisSeverity | null;
  /** Optional measurements taken at the screening; any or all may be null. */
  vitals: Vitals;
  screeningDate: string; // ISO timestamp
  facilityName: string;
  facilityAddress: string | null;
  appointmentDate: string | null; // YYYY-MM-DD
  /** Signed-in BHW's name (who prepared it); null when unknown (offline launch). */
  bhwName: string | null;
  generatedAt: string; // ISO timestamp
}

/**
 * Compact, versioned JSON encoded into the QR. Carries the structured data the
 * TB-DOTS portal needs to look up / verify the referral.
 *
 * v2 (2026-09-06): dropped `spc` — the specimen id the BHW app used to invent —
 * and added `vit`. The version number is what lets a reader tell a v1 payload
 * printed before the correction from a v2 one, so it must be bumped, not reused,
 * whenever the shape changes.
 */
export function buildQrPayload(d: ReferralDocumentData): string {
  return JSON.stringify({
    v: 2,
    typ: 'tbscreen_referral',
    rid: d.referralId,
    sid: d.screeningId,
    pid: d.patientId,
    code: d.displayCode,
    age: d.age,
    sex: d.sex,
    brgy: d.barangayCode,
    flags: d.flags,
    pgis: d.pgis,
    vit: d.vitals,
    sdate: d.screeningDate.slice(0, 10),
    appt: d.appointmentDate,
  });
}

/** Minimal i18next-compatible translate signature (avoids the TFunction generics). */
type TFn = (key: string, options?: Record<string, unknown>) => string;

/** Escape free-text values before interpolating into HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The vitals rows to print: only what was actually measured, each as a plain
 * "label — value unit" pair with NO interpretation attached (§5). BMI is
 * derived here rather than stored, the same way age is derived from birthdate.
 * Blood pressure is one row, as a cuff shows it, and appears only when both
 * halves were taken.
 */
export function vitalsRows(v: Vitals, t: TFn): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  // Keys are written out in full rather than built from the field name: the
  // locale scan in src/i18n/i18n.test.ts reads source for literal key strings,
  // and a `vitals.${key}` template would force the whole namespace onto the
  // runtime-built allowlist — hiding any genuine orphan inside it.
  const push = (label: string, value: string | null, unit: string) => {
    if (value !== null) rows.push({ label, value: `${value} ${unit}` });
  };

  push(t('vitals.height'), formatVital('height_cm', v.height_cm), t('vitals.unitCm'));
  push(t('vitals.weight'), formatVital('weight_kg', v.weight_kg), t('vitals.unitKg'));

  const bmi = bmiFrom(v.height_cm, v.weight_kg);
  if (bmi !== null) {
    rows.push({ label: t('vitals.bmi'), value: `${bmi.toFixed(1)} ${t('vitals.unitBmi')}` });
  }

  push(t('vitals.temperature'), formatVital('temperature_c', v.temperature_c), t('vitals.unitC'));

  const bp = formatBloodPressure(v);
  if (bp !== null) {
    rows.push({ label: t('vitals.bloodPressure'), value: `${bp} ${t('vitals.unitMmHg')}` });
  }

  push(t('vitals.pulse'), formatVital('pulse_rate', v.pulse_rate), t('vitals.unitBpm'));
  push(t('vitals.spo2'), formatVital('spo2_percent', v.spo2_percent), t('vitals.unitPercent'));

  return rows;
}

/**
 * The printable document. Kept as plain semantic HTML + inline CSS (expo-print
 * renders it via the OS print service; "Save as PDF" is available from the
 * Android print dialog).
 */
export function buildReferralDocumentHtml(
  d: ReferralDocumentData,
  qrPngDataUrl: string,
  t: TFn,
): string {
  const answer = (k: (typeof SYMPTOM_KEYS)[number]): string => {
    const v = d.flags[k];
    return v ? t(`common.${v}`) : '—';
  };

  const checklistRows = SYMPTOM_KEYS.map(
    (k) => `
      <tr>
        <td>${esc(t(`screening.symptoms.${k}`))}</td>
        <td class="ans">${esc(answer(k))}</td>
      </tr>`,
  ).join('');

  const pgisLine = d.pgis
    ? t('referralDoc.pgisLine', { value: t(`screening.pgisOptions.${d.pgis}`) })
    : t('referralDoc.pgisNotRecorded');

  // Only printed when something was measured — an empty grid of dashes tells
  // the facility nothing and takes up a third of the page.
  const vitalsBlock = hasAnyVital(d.vitals)
    ? `
  <h2>${esc(t('referralDoc.vitalsSection'))}</h2>
  <table class="kv">
    ${vitalsRows(d.vitals, t)
      .map((r) => `<tr><td>${esc(r.label)}</td><td><b>${esc(r.value)}</b></td></tr>`)
      .join('')}
  </table>
  <p class="note">${esc(t('referralDoc.vitalsNote'))}</p>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: -apple-system, Roboto, 'Segoe UI', sans-serif; font-size: 12px;
         color: #111; margin: 24px; }
  h1 { font-size: 18px; margin: 0; }
  .sub { font-size: 11px; font-weight: bold; margin: 4px 0 16px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  .qr { text-align: center; }
  .qr img { width: 140px; height: 140px; }
  .qr .cap { font-size: 9px; max-width: 150px; }
  .code { font-size: 16px; font-weight: bold; border: 2px solid #111;
          padding: 6px 10px; display: inline-block; margin-bottom: 12px; }
  h2 { font-size: 13px; border-bottom: 1px solid #999; padding-bottom: 2px;
       margin: 16px 0 6px; }
  table { border-collapse: collapse; width: 100%; }
  td { border: 1px solid #bbb; padding: 3px 6px; }
  td.ans { width: 90px; font-weight: bold; text-align: center; }
  .kv td { border: none; padding: 2px 12px 2px 0; }
  .kv td:first-child { color: #555; }
  .note { font-size: 10px; color: #555; margin: 4px 0 0; }
  .sig { margin-top: 28px; }
  .sig .line { border-top: 1px solid #111; width: 240px; padding-top: 2px; }
  .foot { margin-top: 16px; font-size: 10px; color: #444; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>${esc(t('referralDoc.heading'))}</h1>
      <div class="sub">${esc(t('referralDoc.subheading'))}</div>
      <div class="code">${esc(t('referralDoc.patientCode'))}: ${esc(d.displayCode)}</div>
    </div>
    <div class="qr">
      <img src="${qrPngDataUrl}" />
      <div class="cap">${esc(t('referralDoc.qrCaption'))}</div>
    </div>
  </div>

  <h2>${esc(t('referralDoc.patientSection'))}</h2>
  <table class="kv">
    ${d.patientName ? `<tr><td>${esc(t('enroll.fullNameLabel'))}</td><td><b>${esc(d.patientName)}</b></td></tr>` : ''}
    <tr><td>${esc(t('referralDoc.patientCode'))}</td><td><b>${esc(d.displayCode)}</b></td></tr>
    <tr><td>${esc(t('patientDetail.ageSex'))}</td>
        <td>${esc(t('patients.itemDescription', { sex: t(`sex.${d.sex}`), age: d.age }))}</td></tr>
    <tr><td>${esc(t('address.barangay'))}</td><td>${esc(d.barangayLabel)}</td></tr>
    ${d.sitio ? `<tr><td>${esc(t('address.sitio'))}</td><td>${esc(d.sitio)}</td></tr>` : ''}
  </table>

  <h2>${esc(t('referralDoc.screeningSection'))}</h2>
  <table class="kv">
    <tr><td>${esc(t('referralDoc.screeningDate'))}</td>
        <td>${esc(new Date(d.screeningDate).toLocaleDateString())}</td></tr>
  </table>
  <table>${checklistRows}</table>
  <p>${esc(pgisLine)}</p>
${vitalsBlock}

  <h2>${esc(t('referralDoc.referralSection'))}</h2>
  <table class="kv">
    <tr><td>${esc(t('referralDoc.facility'))}</td>
        <td><b>${esc(d.facilityName)}</b>${d.facilityAddress ? ` — ${esc(d.facilityAddress)}` : ''}</td></tr>
    <tr><td>${esc(t('referralDoc.appointment'))}</td>
        <td><b>${esc(d.appointmentDate ?? '—')}</b></td></tr>
  </table>
  <p class="note">${esc(t('referralDoc.sputumNote'))}</p>

  <div class="sig">
    ${d.bhwName ? `<div><b>${esc(d.bhwName)}</b> (BHW)</div>` : ''}
    <div class="line">${esc(t('referralDoc.preparedBy'))}</div>
  </div>

  <div class="foot">
    ${esc(t('screening.nonDiagnostic'))}<br/>
    ${esc(t('referralDoc.generatedAt', { date: new Date(d.generatedAt).toLocaleString() }))}
  </div>
</body>
</html>`;
}
