/**
 * verify-0035-whitelist.mjs — proves that migration 0035 changed only what it
 * claims inside enforce_audit_changes_whitelist().
 *
 * WHY THIS EXISTS. 0035 had to restate the whole of 0031's whitelist function
 * to add a 'referrals' arm and close the NULL hole. That function is the only
 * thing standing between audit_logs and clinical free text, and audit_logs is
 * readable by `admin` — a role with no clinical read policy at all. A stray
 * edit to one of the three EXISTING arms would widen what an admin can learn
 * about a patient, and no test in this repo counts the keys of a table it is
 * not looking at.
 *
 *   node scripts/verify-0035-whitelist.mjs
 *
 * So this compares 0035's function against 0031's, asserting:
 *
 *   1. the tb_cases, treatment_followups and appointments arms are IDENTICAL;
 *   2. the referrals arm exists and contains exactly the five approved keys;
 *   3. neither `result` nor `result_outcome` appears anywhere in the function;
 *   4. the `allowed is null` guard is present, because without it the arm
 *      added in (2) would be unenforced for the very table 0035 admits.
 *
 * This checks TRANSCRIPTION ONLY. Whether the guard actually fires is what
 * supabase/tests/0035_referral_audit_matrix.sql §4 answers, by writing rows.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
// CRLF is normalised on read, for the same reason as the other verifiers:
// line endings are not what this checker is about.
const mig = (name) =>
  readFileSync(join(repo, 'supabase', 'migrations', name), 'utf8').replace(/\r\n/g, '\n');

const PREVIOUS = '0031_case_registry_and_followups.sql';
const CURRENT = '0035_referral_audit_trail.sql';

/** Pull the last enforce_audit_changes_whitelist definition out of a file. */
function extractBody(sql) {
  const re =
    /create\s+(?:or\s+replace\s+)?function\s+public\.enforce_audit_changes_whitelist\s*\([\s\S]*?\sas\s+(\$[a-z_]*\$)([\s\S]*?)\1/gi;
  let last = null;
  for (const m of sql.matchAll(re)) last = m[2];
  if (last === null) throw new Error('could not find a definition of enforce_audit_changes_whitelist');
  return last;
}

/** Strip comments and collapse whitespace. Comments are not the subject here. */
const norm = (s) =>
  s
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The `when '<table>' then array[...]` arm for one entity_table, normalised.
 * Returns null when the arm is absent, which is itself a finding.
 */
function extractArm(body, table) {
  const re = new RegExp(`when\\s+'${table}'\\s+then\\s+array\\s*\\[([\\s\\S]*?)\\]`, 'i');
  const m = norm(body).match(re);
  return m ? norm(m[1]) : null;
}

const before = extractBody(mig(PREVIOUS));
const after = extractBody(mig(CURRENT));

let failed = 0;
const fail = (msg) => {
  failed += 1;
  console.log(`FAIL  ${msg}`);
};

// --- 1. The three pre-existing arms must be untouched. ----------------------
for (const table of ['tb_cases', 'treatment_followups', 'appointments']) {
  const a = extractArm(before, table);
  const b = extractArm(after, table);
  if (a === null) {
    fail(`could not find the ${table} arm in ${PREVIOUS}`);
  } else if (a === b) {
    console.log(`OK    the ${table} arm is unchanged from 0031`);
  } else {
    fail(`the ${table} arm CHANGED\n        0031: ${a}\n        0035: ${b}`);
  }
}

// --- 2. The referrals arm holds exactly the approved keys. -----------------
const APPROVED = ['status', 'presented', 'result_date', 'facility_id', 'lab_sample_id'];
const refArm = extractArm(after, 'referrals');
if (refArm === null) {
  fail('0035 adds no referrals arm, so the widened CHECK would be unguarded');
} else {
  const keys = refArm
    .split(',')
    .map((k) => k.trim().replace(/^'|'$/g, ''))
    .filter(Boolean)
    .sort();
  const want = [...APPROVED].sort();
  if (JSON.stringify(keys) === JSON.stringify(want)) {
    console.log(`OK    the referrals arm is exactly [${want.join(', ')}]`);
  } else {
    fail(`the referrals arm is [${keys.join(', ')}], expected [${want.join(', ')}]`);
  }
}

// --- 3. No clinical finding may appear anywhere in the function. -----------
// Checked over the WHOLE body, not just the referrals arm: a key smuggled into
// another arm reaches the same admin-readable table.
for (const banned of ['result_outcome', "'result'"]) {
  if (norm(after).includes(banned)) {
    fail(`${banned} appears in the whitelist function — audit_logs is admin-readable`);
  } else {
    console.log(`OK    ${banned} appears nowhere in the whitelist`);
  }
}

// --- 4. The NULL guard exists. --------------------------------------------
// This is the whole reason 0035 could not simply add an arm: without the guard,
// an unlisted entity_table leaves `allowed` NULL, every membership test is NULL,
// and the loop raises nothing.
if (/if\s+allowed\s+is\s+null\s+then\s+raise/i.test(norm(after))) {
  console.log('OK    an unrecognised entity_table raises instead of passing');
} else {
  fail('the `allowed is null` guard is missing; the whitelist would accept any key');
}

// ---------------------------------------------------------------------------
// Self-test: mutate 0035 in memory and assert each change is caught.
// ---------------------------------------------------------------------------
const currentSql = mig(CURRENT);
const MUTATIONS = [
  {
    label: 'widened existing arm',
    from: "'visit_date','voided_at','void_reason'",
    to: "'visit_date','voided_at','void_reason','notes'",
    check: (sql) => extractArm(extractBody(sql), 'treatment_followups') !== extractArm(before, 'treatment_followups'),
  },
  {
    label: 'clinical finding added to referrals',
    from: "'status','presented','result_date','facility_id','lab_sample_id'",
    to: "'status','presented','result_date','facility_id','lab_sample_id','result_outcome'",
    check: (sql) => norm(extractBody(sql)).includes('result_outcome'),
  },
  {
    label: 'removed NULL guard',
    from: 'if allowed is null then',
    to: 'if false then',
    check: (sql) => !/if\s+allowed\s+is\s+null\s+then\s+raise/i.test(norm(extractBody(sql))),
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
  console.log(
    '\nSelf-test: a widened existing arm, a smuggled clinical key and a removed NULL guard are all caught.',
  );
}

console.log(
  failed === 0 && selfTestFailed === 0
    ? 'The whitelist gained a referrals arm and a NULL guard, and nothing else. Transcription verified.'
    : `${failed} mismatch(es), ${selfTestFailed} self-test failure(s). Do not apply 0035.`,
);
process.exit(failed === 0 && selfTestFailed === 0 ? 0 : 1);
