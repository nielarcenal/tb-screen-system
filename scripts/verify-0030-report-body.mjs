/**
 * verify-0030-report-body.mjs — proves that migration 0030 changed only the
 * date predicates of barangay_report().
 *
 * WHY THIS EXISTS. 0030 fixes BASE-04 by moving four date comparisons onto
 * manila_day_start(). To do that it had to restate the whole function body,
 * which 0028 had already verified line for line. The reporting query underneath
 * produces the numbers a health office reads; a stray edit there would change
 * those numbers silently, and no test in this repo would notice.
 *
 *   node scripts/verify-0030-report-body.mjs
 *
 * So this compares 0030's body against 0028's, normalising ONLY the four
 * predicates that were supposed to change:
 *
 *     x.created_at >= from_date        ->  x.created_at >= manila_day_start(from_date)
 *     x.created_at <  (to_date + 1)    ->  x.created_at <  manila_day_start(to_date + 1)
 *
 * for `s.` (screenings) and `r.` (referrals). Everything else — the role gate,
 * the CTEs, every filter, the joins, the ordering, and the deliberately
 * unchanged `mis` date-to-date comparison — is compared character for
 * character.
 *
 * This checks TRANSCRIPTION ONLY. Whether the new bounds behave correctly is
 * what supabase/tests/0030_report_boundary.sql answers, by running the report
 * under two session timezones.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
// CRLF is normalised on read, for the same reason as the other two verifiers:
// line endings are not what this checker is about.
const mig = (name) =>
  readFileSync(join(repo, 'supabase', 'migrations', name), 'utf8').replace(/\r\n/g, '\n');

const PREVIOUS = '0028_null_safe_role_gates.sql';
const CURRENT = '0030_barangay_report_manila_boundaries.sql';

/** Pull the last barangay_report definition out of a migration file. */
function extractBody(sql) {
  const re =
    /create\s+(?:or\s+replace\s+)?function\s+public\.barangay_report\s*\([\s\S]*?\sas\s+(\$[a-z_]*\$)([\s\S]*?)\1/gi;
  let last = null;
  for (const m of sql.matchAll(re)) last = m[2];
  if (last === null) throw new Error('could not find a definition of barangay_report');
  return last;
}

/**
 * Collapse the fixed form back to the broken form, so an unchanged body
 * compares equal. Deliberately narrow: it rewrites `manila_day_start(from_date)`
 * and `manila_day_start(to_date + 1)` and nothing else, so wrapping any OTHER
 * expression in manila_day_start() would still show up as a difference.
 */
function normalize(body) {
  return body
    .replace(/--[^\n]*/g, '')
    .replace(/public\.manila_day_start\(\s*from_date\s*\)/gi, 'from_date')
    .replace(/public\.manila_day_start\(\s*to_date\s*\+\s*1\s*\)/gi, '(to_date + 1)')
    .replace(/\s+/g, ' ')
    .trim();
}

const before = extractBody(mig(PREVIOUS));
const after = extractBody(mig(CURRENT));

let failed = 0;

if (normalize(before) === normalize(after)) {
  console.log(`OK    barangay_report body matches ${PREVIOUS} apart from the date bounds`);
} else {
  failed += 1;
  const a = normalize(before);
  const b = normalize(after);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  console.log(
    `FAIL  barangay_report diverges beyond the date bounds\n` +
      `        at char ${i}\n` +
      `        0028: ...${a.slice(Math.max(0, i - 40), i + 60)}\n` +
      `        0030: ...${b.slice(Math.max(0, i - 40), i + 60)}`,
  );
}

// The change must actually have happened. Without this, deleting the fix
// entirely would make the bodies identical and print OK.
const bounded = (after.match(/public\.manila_day_start\(/gi) ?? []).length;
if (bounded === 4) {
  console.log('OK    all four date bounds go through manila_day_start()');
} else {
  failed += 1;
  console.log(`FAIL  expected 4 manila_day_start() bounds in 0030, found ${bounded}`);
}

// The `mis` CTE must NOT have been "fixed" — scheduled_date is a plain date and
// a date-to-date comparison has no timezone. Wrapping it would be a real bug.
if (/a\.scheduled_date between from_date and to_date/i.test(after)) {
  console.log('OK    the mis CTE still compares scheduled_date as a plain date');
} else {
  failed += 1;
  console.log('FAIL  the mis CTE date-to-date comparison was altered; see 0030 header');
}

// ---------------------------------------------------------------------------
// Self-test: mutate 0030 in memory and assert each change is caught. One in the
// reporting query (which would change published numbers), and one that removes
// a Manila bound (which would silently reopen BASE-04 for that predicate).
// ---------------------------------------------------------------------------
const currentSql = mig(CURRENT);
const MUTATIONS = [
  {
    label: 'reporting query token',
    from: "count(*) filter (where r.presented is true)",
    to: "count(*) filter (where r.presented is false)",
    check: (sql) => normalize(extractBody(sql)) !== normalize(before),
  },
  {
    label: 'removed Manila bound',
    from: 'where r.created_at >= public.manila_day_start(from_date)',
    to: 'where r.created_at >= from_date',
    check: (sql) => (extractBody(sql).match(/public\.manila_day_start\(/gi) ?? []).length !== 4,
  },
];

let selfTestFailed = 0;
for (const mut of MUTATIONS) {
  const mutated = currentSql.replace(mut.from, mut.to);
  if (mutated === currentSql) {
    selfTestFailed += 1;
    console.log(`\nSELFTEST FAIL — mutation text not found: ${mut.label}`);
    continue;
  }
  if (!mut.check(mutated)) {
    selfTestFailed += 1;
    console.log(`\nSELFTEST FAIL — a ${mut.label} change was NOT detected.`);
  }
}

if (selfTestFailed === 0) {
  console.log('\nSelf-test: a reporting-query edit and a removed Manila bound are both caught.');
}

console.log(
  failed === 0 && selfTestFailed === 0
    ? 'barangay_report changed only where BASE-04 required. Transcription verified.'
    : `${failed} mismatch(es), ${selfTestFailed} self-test failure(s). Do not apply 0030.`,
);
process.exit(failed === 0 && selfTestFailed === 0 ? 0 : 1);
