/**
 * Locale hygiene + <html lang> tracking.
 *
 * These guard two classes of defect that the type system cannot see. The
 * Translation type makes tl and ceb carry every KEY en does, so a missing
 * string is a compile error — but nothing stops a key from carrying English
 * text, or from carrying an English unit abbreviation inside otherwise
 * translated prose. Both had happened:
 *
 *   apptEarly was '{{count}}d maaga' / '{{count}}d sayo', rendering "1d maaga"
 *   in the appointments list — an English abbreviation for "day" sitting inside
 *   a Tagalog sentence.
 *
 *   markNoShow and presentedNo were the literal string 'No-show' in all three
 *   bundles, so the attendance controls stayed English in every language.
 */
import { describe, expect, it } from 'vitest';

import { en } from './locales/en';
import { tl } from './locales/tl';
import { ceb } from './locales/ceb';
import { changeLanguage, storedLanguage, SUPPORTED_LANGUAGES } from './index';

describe('locale bundles', () => {
  it('spells the day unit in each language rather than reusing "d"', () => {
    // English may keep the compact form; the others must not inherit it.
    for (const [name, bundle] of [['tl', tl], ['ceb', ceb]] as const) {
      for (const key of ['apptEarly', 'apptLate'] as const) {
        expect(bundle.detail[key], `${name}.detail.${key}`).not.toMatch(/\{\{count\}\}d\b/);
        expect(bundle.detail[key], `${name}.detail.${key}`).toContain('{{count}}');
      }
    }
  });

  it('translates the attendance controls out of English', () => {
    // The two live in different namespaces: the inbox chip and the detail
    // panel's button, both of which read 'No-show' in every language.
    for (const [name, bundle] of [['tl', tl], ['ceb', ceb]] as const) {
      expect(bundle.detail.markNoShow, `${name}.detail.markNoShow`).not.toBe(
        en.detail.markNoShow,
      );
      expect(bundle.inbox.presentedNo, `${name}.inbox.presentedNo`).not.toBe(
        en.inbox.presentedNo,
      );
    }
  });

  it('keeps the result-notes label, which is the textarea accessible name', () => {
    // Orphaned for a while: translated in all three bundles, rendered nowhere,
    // leaving the textarea with no accessible name at all.
    for (const bundle of [en, tl, ceb]) {
      expect(bundle.detail.resultLabel.length).toBeGreaterThan(0);
    }
  });
});

describe('<html lang>', () => {
  it('tracks the selected language', () => {
    for (const lng of SUPPORTED_LANGUAGES) {
      changeLanguage(lng);
      expect(document.documentElement.lang).toBe(lng);
    }
  });

  it('persists the choice so a reload keeps it', () => {
    changeLanguage('ceb');
    expect(storedLanguage()).toBe('ceb');
    changeLanguage('en'); // leave the suite on the default
  });
});
