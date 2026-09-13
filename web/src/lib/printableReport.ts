/** Standalone, offline printable report. Escape every supplied value: labels
 * and aggregate names must never become executable downloaded HTML. */
export interface PrintableReport {
  language: string;
  title: string;
  disclaimer: string;
  instruction: string;
  scope: string;
  generated: string;
  columns: string[];
  periods: { label: string; rows: (string | number)[][] }[];
  notes: string[];
}

export function buildPrintableReport(report: PrintableReport): string {
  const escape = (value: string | number) => String(value).replace(/[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  return `<!doctype html>
<html lang="${escape(report.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(report.title)}</title><style>
*{box-sizing:border-box}body{font:13px/1.5 Arial,sans-serif;color:#182c30;margin:32px auto;max-width:1100px;padding:0 24px}
h1{font-size:26px;margin:8px 0}h2{font-size:17px;margin:24px 0 10px}.brand{font-weight:bold;letter-spacing:2px;color:#14635d}
.disclaimer{border:2px solid #9a6300;padding:14px;background:#fff8e6;font-weight:bold;margin:16px 0}
.instruction{background:#edf5f4;padding:12px}.meta{color:#465659}table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:20px}
th,td{border:1px solid #bac9c7;padding:8px;overflow-wrap:anywhere;text-align:right}th:first-child,td:first-child,th:nth-child(2),td:nth-child(2){text-align:left}
thead{background:#e9f1f0}thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}footer{font-size:10px;border-top:1px solid #666;padding-top:6px;margin-top:24px}
@page{size:A4 landscape;margin:16mm 12mm 24mm}
@media print{body{margin:0;padding:0;max-width:none;font-size:10px}.instruction{display:none}footer{position:fixed;bottom:-18mm;left:0;right:0;background:white}th,td{padding:6px}}
</style></head><body>
<div class="brand">TB-SCREEN · CAPSTONE DEMO</div><h1>${escape(report.title)}</h1>
<p class="meta">${escape(report.scope)} · ${escape(report.generated)}</p>
<div class="disclaimer">${escape(report.disclaimer)}</div><p class="instruction">${escape(report.instruction)}</p>
${report.periods.map(period => `<section><h2>${escape(period.label)}</h2><table><thead><tr>${report.columns.map(c => `<th scope="col">${escape(c)}</th>`).join('')}</tr></thead><tbody>${period.rows.map(row => `<tr>${row.map(c => `<td>${escape(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`).join('')}
${report.notes.map(note => `<p>${escape(note)}</p>`).join('')}
<footer>${escape(report.disclaimer)}</footer></body></html>`;
}
