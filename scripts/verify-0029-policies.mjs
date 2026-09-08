/**
 * verify-0029-policies.mjs — proves that migration 0029 restated 28 RLS
 * policies verbatim apart from the intended helper changes.
 *
 * WHY THIS EXISTS. 0029 fixes BASE-06 by swapping one helper call inside every
 * clinical policy. CREATE POLICY takes a whole expression, so each of the 28
 * had to be copied forward. A slip in a copied predicate would not fail a
 * single test in this repo — it would quietly widen or narrow who can see
 * patient rows, which is the worst possible thing to get wrong silently and
 * the hardest to spot by eye across ~450 lines of near-identical SQL.
 *
 *   node scripts/verify-0029-policies.mjs
 *
 * The intended differences, and the ONLY ones normalised away:
 *   1. public.current_user_role()        -> public.current_user_active_role()
 *   2. public.<enumerating helper>()     -> app_private.<same helper>()
 *   3. SQL comments and whitespace.
 *
 * Everything else in every USING and WITH CHECK expression is compared
 * character for character. Two policies are expected to differ beyond that —
 * they gain a predicate rather than swapping one — and they are declared below
 * with the reason, so "expected to differ" can never be a silent default.
 *
 * This checks TRANSCRIPTION ONLY. Whether the new policies BEHAVE correctly is
 * what supabase/tests/0029_rls_row_matrix.sql answers.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
// CRLF is normalised on read. Without this, a file saved with Windows line
// endings stops matching the multi-line mutation strings below, and the script
// reports a self-test failure that looks like a code defect rather than a
// newline difference. Line endings are not what this checker is about.
const mig = (name) =>
  readFileSync(join(repo, 'supabase', 'migrations', name), 'utf8').replace(/\r\n/g, '\n');

/**
 * Each policy, and the migration that currently defines it — the LAST create
 * wins, so these are the effective definitions, not the first appearance.
 */
const POLICIES = [
  // users
  ['users_tbdots_read_bhws', 'users', '0007_bhw_barangay_scope.sql'],
  ['users_admin_read', 'users', '0008_admin_role_captain_barangay.sql'],
  // facilities
  ['facilities_admin_insert', 'facilities', '0013_facilities_admin_write.sql'],
  ['facilities_admin_update', 'facilities', '0013_facilities_admin_write.sql'],
  // patients
  ['patients_bhw_read', 'patients', '0007_bhw_barangay_scope.sql'],
  ['patients_bhw_insert', 'patients', '0002_rls_policies.sql'],
  ['patients_bhw_update', 'patients', '0007_bhw_barangay_scope.sql'],
  ['patients_tbdots_read', 'patients', '0025_tbdots_patient_registration.sql'],
  ['patients_tbdots_insert', 'patients', '0025_tbdots_patient_registration.sql'],
  // screenings
  ['screenings_bhw_read', 'screenings', '0007_bhw_barangay_scope.sql'],
  ['screenings_bhw_insert', 'screenings', '0007_bhw_barangay_scope.sql'],
  ['screenings_bhw_update', 'screenings', '0007_bhw_barangay_scope.sql'],
  ['screenings_tbdots_read', 'screenings', '0025_tbdots_patient_registration.sql'],
  ['screenings_tbdots_insert', 'screenings', '0025_tbdots_patient_registration.sql'],
  // referrals
  ['referrals_bhw_read', 'referrals', '0007_bhw_barangay_scope.sql'],
  ['referrals_bhw_insert', 'referrals', '0007_bhw_barangay_scope.sql'],
  ['referrals_bhw_update', 'referrals', '0017_rls_hardening_users_referrals.sql'],
  ['referrals_tbdots_read', 'referrals', '0002_rls_policies.sql'],
  ['referrals_tbdots_update', 'referrals', '0002_rls_policies.sql'],
  ['referrals_tbdots_insert', 'referrals', '0025_tbdots_patient_registration.sql'],
  // appointments
  ['appointments_bhw_read', 'appointments', '0007_bhw_barangay_scope.sql'],
  ['appointments_bhw_insert', 'appointments', '0007_bhw_barangay_scope.sql'],
  ['appointments_bhw_update', 'appointments', '0007_bhw_barangay_scope.sql'],
  ['appointments_tbdots_read', 'appointments', '0005_fix_rls_recursion.sql'],
  ['appointments_tbdots_update', 'appointments', '0005_fix_rls_recursion.sql'],
  ['appointments_tbdots_insert', 'appointments', '0011_appointments_tbdots_insert.sql'],
];

/**
 * The two policies that legitimately change shape rather than swapping a
 * helper. Declared explicitly so that "it differs" is a decision recorded here,
 * never a silent pass. Both are on users, and both are explained at length in
 * 0029's header.
 */
const EXPECTED_TO_DIFFER = [
  [
    'users_read_same_facility',
    'users',
    '0002_rls_policies.sql',
    'Gains an active check on the colleague arm ONLY. The `user_id = auth.uid()` ' +
      'self-read stays ungated on purpose: both clients learn they were deactivated ' +
      'by reading this row, and RLS filters rather than raising, so hiding it would ' +
      'read as "no account" and stop mobile recording the denial at all.',
  ],
  [
    'users_update_self',
    'users',
    '0002_rls_policies.sql',
    'Gains an active check in both USING and WITH CHECK. It had no role predicate ' +
      'at all, so there was nothing to swap.',
  ],
];

/**
 * Pull the last `create policy <name> on public.<table> … ;` in a file.
 * Statement ends at the first semicolon that is not inside a quoted string —
 * these expressions contain `'bhw'`, `'submitted'` and so on, but no semicolon
 * inside quotes, so a simple quote-aware scan is enough and is safer than a
 * lazy regex that would stop at the wrong place if one were ever added.
 */
function extractPolicy(sql, name, table) {
  const head = new RegExp(
    String.raw`create\s+policy\s+${name}\s+on\s+public\.${table}\b`,
    'gi',
  );
  let start = -1;
  let m;
  while ((m = head.exec(sql)) !== null) start = m.index;
  if (start === -1) throw new Error(`could not find policy ${name} on ${table}`);

  let i = start;
  let quoted = false;
  for (; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") quoted = !quoted;
    else if (ch === ';' && !quoted) break;
  }
  if (i >= sql.length) throw new Error(`unterminated policy ${name}`);
  return sql.slice(start, i);
}

/** Normalise away exactly the three intended differences, and nothing else. */
function normalize(text) {
  return text
    .replace(/--[^\n]*/g, '')
    .replace(/public\.current_user_active_role\(\)/gi, 'public.current_user_role()')
    .replace(
      /\bapp_private\.(referred_patient_ids|referred_screening_ids|bhw_visible_patient_ids|own_enrolled_patient_ids)\b/gi,
      'public.$1',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

const target = mig('0029_active_aware_rls.sql');
let failed = 0;

for (const [name, table, source] of POLICIES) {
  try {
    const before = normalize(extractPolicy(mig(source), name, table));
    const after = normalize(extractPolicy(target, name, table));
    if (before === after) {
      console.log(`OK    ${name} (vs ${source})`);
    } else {
      failed += 1;
      let i = 0;
      while (i < before.length && i < after.length && before[i] === after[i]) i += 1;
      console.log(
        `FAIL  ${name} (vs ${source})\n` +
          `        diverges at char ${i}\n` +
          `        source: ...${before.slice(Math.max(0, i - 40), i + 60)}\n` +
          `        0029:   ...${after.slice(Math.max(0, i - 40), i + 60)}`,
      );
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${name} — ${err.message}`);
  }
}

// The declared exceptions must (a) still exist in 0029 and (b) actually differ.
// If one stops differing, the intended predicate was dropped — which for
// users_update_self would silently reopen BASE-06 for that policy.
for (const [name, table, source, why] of EXPECTED_TO_DIFFER) {
  try {
    const before = normalize(extractPolicy(mig(source), name, table));
    const after = normalize(extractPolicy(target, name, table));
    if (before === after) {
      failed += 1;
      console.log(`FAIL  ${name} — expected to differ but is unchanged. ${why}`);
    } else {
      console.log(`DIFF  ${name} (expected) — ${why}`);
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${name} — ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Self-test. A checker that cannot fail is worth nothing. Mutate 0029 in memory
// and assert each change is caught: a swapped role literal (which would hand a
// facility's data to BHWs), and a dropped clause from the referral retry
// policy (which would let a BHW rewrite a referral the facility has acted on).
// ---------------------------------------------------------------------------
const MUTATIONS = [
  {
    label: 'role literal',
    name: 'patients_tbdots_read',
    table: 'patients',
    source: '0025_tbdots_patient_registration.sql',
    from: "public.current_user_active_role() = 'tb_dots'\n    and (\n      patient_id in (select app_private.referred_patient_ids())",
    to: "public.current_user_active_role() = 'bhw'\n    and (\n      patient_id in (select app_private.referred_patient_ids())",
  },
  {
    label: 'dropped predicate',
    name: 'referrals_bhw_update',
    table: 'referrals',
    source: '0017_rls_hardening_users_referrals.sql',
    from: "    and status = 'submitted'\n    and result is null\n    and result_date is null\n    and presented is null\n  )\n  with check (",
    to: "    and result is null\n    and result_date is null\n    and presented is null\n  )\n  with check (",
  },
];

let selfTestFailed = 0;
for (const mut of MUTATIONS) {
  const mutated = target.replace(mut.from, mut.to);
  if (mutated === target) {
    selfTestFailed += 1;
    console.log(`\nSELFTEST FAIL — mutation text not found for ${mut.label}`);
    continue;
  }
  const caught =
    normalize(extractPolicy(mutated, mut.name, mut.table)) !==
    normalize(extractPolicy(mig(mut.source), mut.name, mut.table));
  if (!caught) {
    selfTestFailed += 1;
    console.log(`\nSELFTEST FAIL — a ${mut.label} change in ${mut.name} was NOT detected.`);
  }
}

if (selfTestFailed === 0) {
  console.log('\nSelf-test: a swapped role literal and a dropped predicate are both caught.');
}

console.log(
  failed === 0 && selfTestFailed === 0
    ? `All ${POLICIES.length} policies match their source apart from the helper rename, ` +
        `plus ${EXPECTED_TO_DIFFER.length} declared exceptions. Transcription verified.`
    : `${failed} policy mismatch(es), ${selfTestFailed} self-test failure(s). Do not apply 0029.`,
);
process.exit(failed === 0 && selfTestFailed === 0 ? 0 : 1);
