import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { PrintableReport } from './printableReport';

/** Text-only PDF export: no remote assets or patient-level information. */
export function buildReportPdf(report: PrintableReport) {
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
  const clean = (text: string | number) => String(text).replace(/[–—‑]/g, '-').replace(/[’‘]/g, "'");
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  report.periods.forEach((period, index) => {
    if (index) doc.addPage();
    autoTable(doc, {
      head: [report.columns.map(clean)], body: period.rows.map(row => row.map(clean)),
      margin: { top: 57, bottom: 29, left: 12, right: 12 }, startY: 57,
      theme: 'grid', rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, overflow: 'linebreak', halign: 'right' },
      columnStyles: { 0: { cellWidth: 49, halign: 'left' }, 1: { cellWidth: 44, halign: 'left' } },
      headStyles: { fillColor: [16, 70, 67], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 248, 247] },
      didDrawPage: () => {
        doc.setTextColor(16, 70, 67).setFont('helvetica', 'bold').setFontSize(10);
        doc.text('TB-SCREEN | CAPSTONE DEMO', 12, 11);
        doc.setFontSize(17).text(clean(report.title), 12, 19);
        doc.setFont('helvetica', 'normal').setFontSize(10);
        doc.text(clean(`${report.scope} | ${report.generated}`), 12, 26);
        doc.setFillColor(255, 247, 228).rect(12, 30, width - 24, 17, 'F');
        doc.setTextColor(91, 61, 0).setFontSize(8);
        doc.text(doc.splitTextToSize(clean(report.disclaimer), width - 32), 16, 35);
        doc.setTextColor(20, 40, 40).setFontSize(10).text(clean(period.label), 12, 53);
      },
    });
  });
  const count = doc.getNumberOfPages();
  for (let page = 1; page <= count; page++) {
    doc.setPage(page).setFont('helvetica', 'normal').setFontSize(7).setTextColor(65, 65, 65);
    doc.text(doc.splitTextToSize(clean(report.disclaimer), width - 24), 12, height - 20);
    doc.text(`${page} / ${count}`, width - 12, height - 8, { align: 'right' });
  }
  return doc;
}
