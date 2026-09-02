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

  it('agrees in number on the two counted labels', () => {
    // Both call sites pass { count }, which makes i18next look for _one/_other
    // and ignore a bare key. With only the plural spelling defined, the BHW
    // list read "1 results" and the inbox would read "1 referrals".
    //
    // en is the only bundle that inflects. fil (which tl resolves to) and ceb
    // put EVERY count in the 'one' category -- 0, 1, 2 and 5 all select _one --
    // so their _one carries the general text and _other is there for key parity.
    expect(en.bhw.resultsCount_one).not.toBe(en.bhw.resultsCount_other);
    expect(en.inbox.count_one).not.toBe(en.inbox.count_other);
    expect(en.bhw.resultsCount_one).not.toMatch(/results/);
    expect(en.inbox.count_one).not.toMatch(/referrals/);

    for (const [name, bundle] of [['tl', tl], ['ceb', ceb]] as const) {
      // The rendered form for every count, so it must not be a singular-only
      // phrasing -- and it must still interpolate.
      expect(bundle.bhw.resultsCount_one, `${name}.bhw`).toContain('{{count}}');
      expect(bundle.inbox.count_one, `${name}.inbox`).toContain('{{count}}');
    }
  });

  it('selects the one/other category the runtime actually asks for', () => {
    // Guards the assumption above rather than the strings: if a runtime ever
    // stopped resolving tl -> fil, _one would silently stop being the form
    // that renders in Tagalog.
    expect(new Intl.PluralRules('en').select(1)).toBe('one');
    expect(new Intl.PluralRules('en').select(4)).toBe('other');
    for (const lng of ['tl', 'ceb'] as const) {
      for (const n of [0, 1, 2, 5]) {
        expect(new Intl.PluralRules(lng).select(n), `${lng} ${n}`).toBe('one');
      }
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

/**
 * Every key the portal actually asks for must exist in en.
 *
 * i18next renders a missing key as the key itself, which is loud and gets
 * caught the moment anyone opens the screen -- EXCEPT when the call site
 * passes a default value, which renders plausible English instead and so is
 * invisible in every language. That is exactly how the language switcher
 * shipped announcing "Language" to Tagalog and Cebuano screen-reader users:
 * t('languages.label', 'Language'), with no bundle defining the key.
 *
 * Scans source rather than trusting the types, because t() takes a string and
 * TypeScript never checks it against the bundle. Only single-quoted literal
 * keys are collected; the template-literal call sites build their keys at
 * runtime (`status.${...}`, `symptoms.${...}` and four more prefixes) and
 * cannot be checked this way.
 */
describe('translation keys used in source', () => {
  /**
   * Read with Vite's import.meta.glob rather than node:fs: the portal's tsconfig
   * is deliberately browser-only (lib ES2022 + DOM, no @types/node), and pulling
   * Node's types in for one test would hand the whole app `process` and Node
   * timer types it must never see.
   */
  const modules = import.meta.glob('../**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  function flatten(value: unknown, prefix = ''): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object') Object.assign(out, flatten(v, key));
      else out[key] = String(v);
    }
    return out;
  }

  /**
   * Comments are stripped before scanning. Both guards below describe the
   * defect they exist for by quoting the offending call, and a key named only
   * in prose is not a key the portal asks for -- without this the guards fail
   * on their own documentation. Block comments go entirely; line comments go
   * only when they start the line, so a trailing comment quoting a t() call
   * would still be read as code.
   */
  function stripComments(code: string): string {
    const NL = String.fromCharCode(10);
    return code
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split(NL)
      .map((line) => (line.trimStart().startsWith('//') ? '' : line))
      .join(NL);
  }

  // The bundles themselves are excluded: they DEFINE keys, they do not ask for any.
  const files = Object.entries(modules).filter(([p]) => !p.includes('/locales/'));
  const source = files.map(([, code]) => stripComments(code)).join(String.fromCharCode(10));

  it('finds the source to scan', () => {
    // A broken path would make every assertion below vacuously pass.
    expect(files.length).toBeGreaterThan(20);
    expect(source).toContain("t('languages.label')");
  });

  it('defines every key the source asks for', () => {
    const defined = flatten(en);
    const missing = [...source.matchAll(/(?<![A-Za-z0-9_$.])t\(\s*'([^'${}]+\.[^'${}]+)'/g)]
      .map((m) => m[1])
      // A counted key is stored as key_one / key_other, never bare.
      .filter((k) => defined[k] === undefined && defined[`${k}_one`] === undefined);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('never hides a missing key behind a default value', () => {
    // t('some.key', 'Some English') silences the check above at the call site
    // and pins the string to English for every language. There is no legitimate
    // use for it here: en IS the fallback bundle.
    const DEFAULTED = /(?<![A-Za-z0-9_$.])t\(\s*'[^'${}]+\.[^'${}]+'\s*,\s*'/g;
    const withDefault = [...source.matchAll(DEFAULTED)].map((m) => m[0]);
    expect(withDefault).toEqual([]);
  });

  it('translates the group label on the language switcher', () => {
    // The pills read EN/TL/CEB in every language, so this aria-label is the
    // only thing a screen reader can announce for the control.
    for (const [name, bundle] of [['tl', tl], ['ceb', ceb]] as const) {
      expect(bundle.languages.label, `${name}.languages.label`).not.toBe(en.languages.label);
      expect(bundle.languages.label.length, `${name}.languages.label`).toBeGreaterThan(0);
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
