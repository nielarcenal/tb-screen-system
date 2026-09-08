/**
 * verify-0028-bodies.mjs — proves that migration 0028 restated six function
 * bodies verbatim.
 *
 * WHY THIS EXISTS. 0028 fixes a guard clause inside six SECURITY DEFINER
 * functions. CREATE OR REPLACE FUNCTION takes a whole definition, so there is
 * no way to change only a guard — every body had to be copied forward. A silent
 * transcription slip in a copied body would not fail any test in this repo: it
 * would quietly change a reporting number. Reviewing ~250 lines of duplicated
 * SQL by eye is exactly the kind of check a human does badly.
 *
 *   node scripts/verify-0028-bodies.mjs
 *
 * Exit code 0 and "OK" on all six lines means the only differences are the
 * intended ones. Any FAIL is a real discrepancy that must be explained before
 * the migration is applied.
 *
 * WHAT IS EXCLUDED FROM THE COMPARISON — and it is deliberately narrow:
 *   1. SQL comments.
 *   2. The one declaration 0028 introduces or rewrites:
 *        v_role text := public.current_user_role();          (old)
 *        v_role text := public.current_user_active_role();   (new)
 *   3. Guard blocks: balanced `if … end if;` spans containing a RAISE.
 *
 * EVERYTHING else is compared, including every PRE-EXISTING declaration.
 * The first version of this script cut the body from its start through the last
 * guard, which silently excluded dashboard_counts()'s Manila date variables
 * (d_today / d_start / d_next) — so it proved the query tail matched and
 * nothing more, while printing OK. Codex caught that (M28-02). The mutation
 * self-test below now covers a declaration token as well as a query token, so
 * the same blind spot cannot reopen unnoticed.
 *
 * This checks TRANSCRIPTION ONLY. It says nothing about whether the new guards
 * are correct — that is what supabase/tests/0028_role_gate_matrix.sql is for.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const mig = (name) => readFileSync(join(repo, 'supabase', 'migrations', name), 'utf8');

/** Each function, and which migration currently defines it. */
const TARGETS = [
  { fn: 'barangay_report', source: '0027_barangay_report.sql' },
  { fn: 'admin_overview', source: '0026_rename_captain_to_midwife.sql' },
  { fn: 'bhw_activity', source: '0026_rename_captain_to_midwife.sql' },
  { fn: 'dashboard_counts', source: '0018_manila_business_calendar.sql' },
  { fn: 'hotspot_counts', source: '0018_manila_business_calendar.sql' },
  { fn: 'next_facility_patient_code', source: '0025_tbdots_patient_registration.sql' },
];

/**
 * Pull the last `create [or replace] function public.<fn>(...) ... as $tag$
 * BODY $tag$` in a file. The last one matters: 0026 defines admin_overview
 * after dropping an earlier version, and a file may mention a name in a comment
 * first. The dollar-quote tag varies across these files ($$, $fn$, $function$),
 * so it is captured rather than assumed.
 */
function extractBody(sql, fn) {
  const re = new RegExp(
    String.raw`create\s+(?:or\s+replace\s+)?function\s+public\.${fn}\s*\(` +
      String.raw`[\s\S]*?\sas\s+(\$[a-z_]*\$)([\s\S]*?)\1`,
    'gi',
  );
  let last = null;
  for (const m of sql.matchAll(re)) last = m[2];
  if (last === null) throw new Error(`could not find a definition of ${fn}`);
  return last;
}

/**
 * Remove balanced `if … end if;` spans that contain a RAISE — i.e. the guards,
 * including bhw_activity's if/elsif/else chain, whose inner `if` for the
 * missing-barangay case must not terminate the outer span early. A regex cannot
 * count nesting, so this scans.
 *
 * `if` appears nowhere else in these six bodies (no CASE ... IF, no plpgsql
 * conditionals in the queries); if that ever changes, a guard-free `if` block
 * is simply left in place and compared, which fails safe.
 */
function stripGuardBlocks(body) {
  const token = /\b(if|end\s+if)\b/gi;
  let out = '';
  let cursor = 0;
  let m;
  while ((m = token.exec(body)) !== null) {
    if (!/^if$/i.test(m[0])) continue; // only start a span on `if`
    const start = m.index;
    // Walk forward keeping a depth count until this span's own `end if`.
    const inner = /\b(if|end\s+if)\b/gi;
    inner.lastIndex = token.lastIndex;
    let depth = 1;
    let end = -1;
    let im;
    while ((im = inner.exec(body)) !== null) {
      depth += /^if$/i.test(im[0]) ? 1 : -1;
      if (depth === 0) {
        end = inner.lastIndex;
        break;
      }
    }
    if (end === -1) break; // unbalanced; leave the rest alone and fail safe
    const span = body.slice(start, end);
    if (/\braise\b/i.test(span)) {
      out += body.slice(cursor, start);
      cursor = end;
      // Swallow a trailing semicolon left by `end if ;`.
      if (body[cursor] === ';') cursor += 1;
    }
    token.lastIndex = end;
  }
  return out + body.slice(cursor);
}

/**
 * Reduce a body to everything 0028 was NOT allowed to change. See the header
 * for exactly what is dropped and why.
 */
function normalize(body) {
  return stripGuardBlocks(body.replace(/--[^\n]*/g, ''))
    // The single declaration 0028 introduces or rewrites.
    .replace(/\bv_role\s+text\s*:=\s*public\.current_user_(?:active_)?role\(\)\s*;/gi, '')
    // A `declare` that now introduces nothing, because v_role was its only entry.
    .replace(/\bdeclare\s+begin\b/gi, 'begin')
    .replace(/\s+/g, ' ')
    .trim();
}

const target = mig('0028_null_safe_role_gates.sql');
let failed = 0;

for (const { fn, source } of TARGETS) {
  let verdict;
  try {
    const before = normalize(extractBody(mig(source), fn));
    const after = normalize(extractBody(target, fn));
    if (before === after) {
      verdict = `OK    ${fn} (vs ${source})`;
    } else {
      failed += 1;
      // Report the first divergence with a little context, so the discrepancy
      // is actionable rather than just flagged.
      let i = 0;
      while (i < before.length && i < after.length && before[i] === after[i]) i += 1;
      verdict =
        `FAIL  ${fn} (vs ${source})\n` +
        `        diverges at char ${i}\n` +
        `        source: ...${before.slice(Math.max(0, i - 40), i + 60)}\n` +
        `        0028:   ...${after.slice(Math.max(0, i - 40), i + 60)}`;
    }
  } catch (err) {
    failed += 1;
    verdict = `FAIL  ${fn} — ${err.message}`;
  }
  console.log(verdict);
}

// ---------------------------------------------------------------------------
// Self-test: a checker that cannot fail is worth nothing. Mutate the migration
// text in memory — one token in a QUERY and one in a DECLARATION — and assert
// that each is caught. The declaration case is the blind spot Codex found in
// the first version (M28-02), so it is pinned here permanently.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  { label: 'query token', fn: 'barangay_report', from: "r.status = 'tested'", to: "r.status = 'closed'" },
  { label: 'declaration token', fn: 'dashboard_counts', from: 'manila_day_start(d_today + 1)', to: 'manila_day_start(d_today + 2)' },
];

let selfTestFailed = 0;
for (const mut of MUTATIONS) {
  const mutated = target.replace(mut.from, mut.to);
  if (mutated === target) {
    selfTestFailed += 1;
    console.log(`\nSELFTEST FAIL — mutation text not found: ${mut.from}`);
    continue;
  }
  const caught =
    normalize(extractBody(mutated, mut.fn)) !==
    normalize(extractBody(mig(TARGETS.find((t) => t.fn === mut.fn).source), mut.fn));
  if (!caught) {
    selfTestFailed += 1;
    console.log(`\nSELFTEST FAIL — a ${mut.label} change in ${mut.fn}() was NOT detected.`);
  }
}

if (selfTestFailed === 0) {
  console.log('\nSelf-test: a mutated query token and a mutated declaration token are both caught.');
}

console.log(
  failed === 0 && selfTestFailed === 0
    ? 'All six bodies match their source apart from the guard. Transcription verified.'
    : `${failed} body mismatch(es), ${selfTestFailed} self-test failure(s). Do not apply 0028.`,
);
process.exit(failed === 0 && selfTestFailed === 0 ? 0 : 1);
