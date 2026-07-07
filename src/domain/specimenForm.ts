/**
 * Specimen referral form (Feature 6, brief §8.6): the QR payload and the
 * printable HTML for expo-print.
 *
 * POSITIONING (§1): the form is a PRE-SCREENING REFERRAL document — the header,
 * subheading, and footer all carry the non-diagnostic disclaimer, and no field
 * is ever labeled as a result/probability/score.
 *
 * PRIVACY (§4): the paper form travels with the specimen and its QR can be
 * scanned by anyone who handles it — so the payload and HTML NEVER include the
 * patient's contact number. There is no name anywhere in the system by design;
 * the patient is identified by display_code + patient_id.
 */
import { PgisSeverity, Sex, SymptomFlags } from '../db/types';
import { SYMPTOM_KEYS } from './screeningRules';

export interface SpecimenData {
  referralId: string;
  screeningId: string;
  patientId: string;
  specimenId: string | null;
  displayCode: string;
  age: number;
  sex: Sex;
  barangayCode: string;
  barangayLabel: string;
  sitio: string | null;
  flags: SymptomFlags;
  pgis: PgisSeverity | null;
  screeningDate: string; // ISO timestamp
  facilityName: string;
  facilityAddress: string | null;
  appointmentDate: string | null; // YYYY-MM-DD
  generatedAt: string; // ISO timestamp
}

/**
 * Compact, versioned JSON encoded into the QR. Carries the structured data the
 * TB-DOTS portal needs to look up / verify the referral (Feature 7 can parse it).
 */
export function buildQrPayload(d: SpecimenData): string {
  return JSON.stringify({
    v: 1,
    typ: 'tbscreen_referral',
    rid: d.referralId,
    sid: d.screeningId,
    pid: d.patientId,
    spc: d.specimenId,
    code: d.displayCode,
    age: d.age,
    sex: d.sex,
    brgy: d.barangayCode,
    flags: d.flags,
    pgis: d.pgis,
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
 * The printable form. Kept as plain semantic HTML + inline CSS (expo-print
 * renders it via the OS print service; "Save as PDF" is available from the
 * Android print dialog).
 */
export function buildSpecimenHtml(d: SpecimenData, qrPngDataUrl: string, t: TFn): string {
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
    ? t('specimen.pgisLine', { value: t(`screening.pgisOptions.${d.pgis}`) })
    : t('specimen.pgisNotRecorded');

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
  .spc { font-size: 16px; font-weight: bold; border: 2px solid #111;
         padding: 6px 10px; display: inline-block; margin-bottom: 12px; }
  h2 { font-size: 13px; border-bottom: 1px solid #999; padding-bottom: 2px;
       margin: 16px 0 6px; }
  table { border-collapse: collapse; width: 100%; }
  td { border: 1px solid #bbb; padding: 3px 6px; }
  td.ans { width: 90px; font-weight: bold; text-align: center; }
  .kv td { border: none; padding: 2px 12px 2px 0; }
  .kv td:first-child { color: #555; }
  .sig { margin-top: 28px; }
  .sig .line { border-top: 1px solid #111; width: 240px; padding-top: 2px; }
  .foot { margin-top: 16px; font-size: 10px; color: #444; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>${esc(t('specimen.heading'))}</h1>
      <div class="sub">${esc(t('specimen.subheading'))}</div>
      <div class="spc">${esc(t('specimen.specimenId'))}: ${esc(d.specimenId ?? '—')}</div>
    </div>
    <div class="qr">
      <img src="${qrPngDataUrl}" />
      <div class="cap">${esc(t('specimen.qrCaption'))}</div>
    </div>
  </div>

  <h2>${esc(t('specimen.patientSection'))}</h2>
  <table class="kv">
    <tr><td>${esc(t('specimen.patientCode'))}</td><td><b>${esc(d.displayCode)}</b></td></tr>
    <tr><td>${esc(t('patientDetail.ageSex'))}</td>
        <td>${esc(t('patients.itemDescription', { sex: t(`sex.${d.sex}`), age: d.age }))}</td></tr>
    <tr><td>${esc(t('address.barangay'))}</td><td>${esc(d.barangayLabel)}</td></tr>
    ${d.sitio ? `<tr><td>${esc(t('address.sitio'))}</td><td>${esc(d.sitio)}</td></tr>` : ''}
  </table>

  <h2>${esc(t('specimen.screeningSection'))}</h2>
  <table class="kv">
    <tr><td>${esc(t('specimen.screeningDate'))}</td>
        <td>${esc(new Date(d.screeningDate).toLocaleDateString())}</td></tr>
  </table>
  <table>${checklistRows}</table>
  <p>${esc(pgisLine)}</p>

  <h2>${esc(t('specimen.referralSection'))}</h2>
  <table class="kv">
    <tr><td>${esc(t('specimen.facility'))}</td>
        <td><b>${esc(d.facilityName)}</b>${d.facilityAddress ? ` — ${esc(d.facilityAddress)}` : ''}</td></tr>
    <tr><td>${esc(t('specimen.appointment'))}</td>
        <td><b>${esc(d.appointmentDate ?? '—')}</b></td></tr>
  </table>

  <div class="sig">
    <div class="line">${esc(t('specimen.preparedBy'))}</div>
  </div>

  <div class="foot">
    ${esc(t('screening.nonDiagnostic'))}<br/>
    ${esc(t('specimen.generatedAt', { date: new Date(d.generatedAt).toLocaleString() }))}
  </div>
</body>
</html>`;
}
