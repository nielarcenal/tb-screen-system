/**
 * Locale hygiene for the mobile bundle — the portal's key scans, ported.
 *
 * The portal grew these guards after two defects the type system could not
 * see, and both classes exist here too. `Translation` makes tl and ceb carry
 * every KEY en does, so a missing string is a compile error — but nothing
 * checks that a key the app ASKS for exists, or that a key the bundle DEFINES
 * is ever rendered. t() takes a string; TypeScript never compares it to the
 * bundle.
 *
 * When the same scans were first run against the portal they found 1 missing
 * key and 61 orphans, so this is not a formality. The mobile bundle has never
 * been scanned at all.
 *
 * TWO DIFFERENCES FROM THE PORTAL VERSION, both deliberate:
 *
 *  1. The source lives in two trees. Mobile keeps its screens in `app/`
 *     (Expo Router) and everything else in `src/`, and most t() calls are in
 *     `app/`. Globbing only `../**` would scan `src/` alone, miss the majority
 *     of call sites, and report most of the bundle as orphaned. Both trees are
 *     globbed and merged.
 *
 *  2. Test files are excluded from the scanned source. This file names
 *     runtime-built keys as string literals in RUNTIME_BUILT below; if it
 *     scanned itself, those literals would mark their own keys as "referenced"
 *     and the allowlist would silently stop being load-bearing. Excluding tests
 *     is what makes emptying RUNTIME_BUILT actually fail.
 *
 * There is no <html lang> suite here — that is a DOM concern and this runner is
 * `environment: 'node'`, per mobile/vitest.config.mts.
 */
import { describe, expect, it } from 'vitest';

import { en } from './locales/en';

/**
 * import.meta.glob is Vite's, supplied at runtime by Vitest. Its types ship in
 * `vite/client`, which the portal references from web/src/vite-env.d.ts — but
 * that is a BROWSER type package, and referencing it here would hand this React
 * Native project DOM globals it must never see. The portal can afford it
 * because the portal is a browser app; this scope cannot. So declare only the
 * single member this file uses.
 */
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

/**
 * Read with Vite's import.meta.glob rather than node:fs, matching the portal:
 * the files are wanted as text, not as modules, and `?raw` never evaluates
 * them — which matters here because almost everything under `app/` imports
 * React Native and could not be loaded by this runner at all.
 */
const srcModules = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const appModules = import.meta.glob('../../app/**/*.{ts,tsx}', {
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
 * Comments are stripped before scanning, so a key named only in prose is not
 * mistaken for a key the app asks for — without this the guards fail on their
 * own documentation. Block comments go entirely; line comments go only when
 * they start the line, so a trailing comment quoting a t() call is still read
 * as code.
 */
function stripComments(code: string): string {
  const NL = String.fromCharCode(10);
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(NL)
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join(NL);
}

/** Any quoted string shaped like a translation key — see the orphan test. */
const KEY_LIKE_STRING = /['"`]([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)['"`]/g;

/**
 * The key prefixes the twenty template-literal call sites build at runtime:
 * t(`status.${st}`), t(`screening.symptoms.${k}`), t(`sex.${patient.sex}`) and
 * so on. Keys under these are reachable without any literal of the full key
 * existing in source, so the orphan check must not claim them.
 *
 * Narrowed wherever the dynamic part is a closed set rather than a whole
 * namespace: `address.` is NOT allowlisted because only the four cascade
 * levels are built dynamically (t(`address.${openLevel}`)) while `sitio` and
 * `search` are ordinary literal call sites, and blanket-allowing the namespace
 * would hide a genuine orphan among them. Same reasoning for `common.`, where
 * only the three screening answers are dynamic.
 */
const RUNTIME_BUILT = [
  'status.',
  'sex.',
  'home.tiles.',
  'patientDetail.appt.',
  'screening.symptoms.',
  'screening.pgisOptions.',
  'address.region',
  'address.province',
  'address.city',
  'address.barangay',
  'common.yes',
  'common.no',
  'common.unsure',
];

// The bundles DEFINE keys and ask for none, so they are excluded. Tests are
// excluded for the reason in the header: otherwise RUNTIME_BUILT feeds itself.
const files = [...Object.entries(srcModules), ...Object.entries(appModules)].filter(
  ([p]) => !p.includes('/locales/') && !p.includes('.test.'),
);
const source = files.map(([, code]) => stripComments(code)).join(String.fromCharCode(10));

describe('translation keys used in source', () => {
  it('finds both source trees to scan', () => {
    // A broken path would make every assertion below vacuously pass. Both trees
    // are asserted separately: globbing only src/ still yields plenty of files
    // while missing nearly every t() call, which is the failure that would hurt.
    expect(Object.keys(srcModules).length).toBeGreaterThan(10);
    expect(Object.keys(appModules).length).toBeGreaterThan(5);
    expect(source).toContain("t('home.title')");
    expect(source).toContain('t(`status.${');
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
    // and pins the string to English in every language — which is exactly how
    // the portal shipped its language switcher announcing "Language" to Tagalog
    // and Cebuano screen-reader users. There is no legitimate use for it: en IS
    // the fallback bundle. The interpolation form t('key', { ... }) is not this
    // and is not matched.
    const DEFAULTED = /(?<![A-Za-z0-9_$.])t\(\s*'[^'${}]+\.[^'${}]+'\s*,\s*'/g;
    expect([...source.matchAll(DEFAULTED)].map((m) => m[0])).toEqual([]);
  });

  /**
   * Nothing may be translated into all three bundles and then rendered nowhere.
   *
   * Dead weight is not merely untidy: every orphan is a string a native speaker
   * has to read and sign off during the tl/ceb review, and that review is the
   * expensive step this project is still waiting on.
   *
   * The reverse defect is real and this guard does NOT distinguish it: a key can
   * be orphaned because a render was DROPPED rather than replaced. In the portal
   * that happened to detail.resultLabel, which left a textarea with no
   * accessible name. When this fails, decide which of the two it is before
   * deleting anything.
   *
   * Matches keys as bare quoted strings, not only inside t(), because
   * components also hold keys in lookup tables and render them indirectly.
   */
  it('renders every key it defines', () => {
    const referenced = new Set([...source.matchAll(KEY_LIKE_STRING)].map((m) => m[1]));
    const orphans = Object.keys(flatten(en)).filter((key) => {
      const base = key.replace(/_(one|other)$/, '');
      if (referenced.has(key) || referenced.has(base)) return false;
      return !RUNTIME_BUILT.some((prefix) => key.startsWith(prefix));
    });
    expect(orphans).toEqual([]);
  });
});
