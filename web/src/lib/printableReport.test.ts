import { describe, expect, it } from 'vitest';
import { buildPrintableReport, type PrintableReport } from './printableReport';

const report: PrintableReport = {
  language: 'en', title: 'Barangay report', disclaimer: 'CAPSTONE DEMO ONLY — All data is fictional.',
  instruction: 'Print with Ctrl+P', scope: 'Bukidnon', generated: '2026-09-13',
  columns: ['Barangay', 'City', 'Screened'],
  periods: [
    { label: '2026-01-01 – 2026-09-13', rows: [['Alpha', 'Valencia', 5]] },
    { label: '2025-01-01 – 2025-09-13', rows: [['Beta', 'Valencia', 2]] },
  ], notes: ['Not an official health report.'],
};

describe('printable report', () => {
  it('includes both periods and repeats the disclaimer in its print footer', () => {
    const doc = new DOMParser().parseFromString(buildPrintableReport(report), 'text/html');
    expect(doc.querySelectorAll('table')).toHaveLength(2);
    expect(doc.querySelector('.disclaimer')?.textContent).toBe(report.disclaimer);
    expect(doc.querySelector('footer')?.textContent).toBe(report.disclaimer);
    expect(doc.body.textContent).toContain('Beta');
    expect(doc.querySelector('style')?.textContent).toContain('A4 landscape');
  });

  it('escapes supplied names and labels rather than allowing executable HTML', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const doc = new DOMParser().parseFromString(buildPrintableReport({ ...report,
      title: hostile, periods: [{ label: hostile, rows: [[hostile, 'A & B', 0]] }],
    }), 'text/html');
    expect(doc.querySelectorAll('img, script')).toHaveLength(0);
    expect(doc.querySelector('td')?.textContent).toBe(hostile);
    expect(doc.body.textContent).toContain('A & B');
  });
});
