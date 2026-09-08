/**
 * build-preflight.mjs — assemble the transactional pre-apply check for a
 * migration that ships with a database test.
 *
 *   node scripts/build-preflight.mjs 0028
 *   node scripts/build-preflight.mjs 0029
 *
 * WHY THIS EXISTS. A database test has to exercise definitions that only exist
 * after its migration runs, so it cannot verify that migration "before
 * application" unless both run in the same transaction. This concatenates them:
 *
 *     begin;
 *       <supabase/migrations/NNNN_*.sql>
 *       <supabase/tests/NNNN_*.sql>        -- ends by raising on any FAIL
 *     rollback;
 *
 * into supabase/tests/NNNN_preflight.generated.sql, which is safe to run
 * against the live project: it always rolls back, so it changes nothing, and a
 * single FAIL row aborts it. Only after it reports all PASS should the
 * migration be applied for real.
 *
 * The output is GENERATED and gitignored — regenerate it, never edit it. That
 * is the point: a hand-maintained copy of the migration would drift from the
 * migration it is supposed to be verifying, and would then be verifying the
 * wrong thing while looking fine.
 *
 * (This replaced build-0028-preflight.mjs, which did the same for one hard-coded
 * migration. 0029 needed the identical harness, and two near-identical copies
 * of a verification tool is exactly the drift this script exists to prevent.)
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(repo, 'supabase', 'migrations');
const testsDir = join(repo, 'supabase', 'tests');

const id = process.argv[2];
if (!/^\d{4}$/.test(id ?? '')) {
  console.error('usage: node scripts/build-preflight.mjs <NNNN>   e.g. 0029');
  process.exit(2);
}

/** Exactly one file in `dir` may start with the migration id. */
function soleFile(dir, label) {
  const hits = readdirSync(dir).filter(
    (f) => f.startsWith(`${id}_`) && f.endsWith('.sql') && !f.endsWith('.generated.sql'),
  );
  if (hits.length === 0) {
    console.error(`ERROR: no ${label} found for ${id} in ${dir}`);
    process.exit(1);
  }
  if (hits.length > 1) {
    console.error(`ERROR: ${hits.length} ${label} files match ${id}: ${hits.join(', ')}`);
    process.exit(1);
  }
  return join(dir, hits[0]);
}

const migrationPath = soleFile(migrationsDir, 'migration');
const testPath = soleFile(testsDir, 'test');
const out = join(testsDir, `${id}_preflight.generated.sql`);

const migrationSql = readFileSync(migrationPath, 'utf8');
const testSql = readFileSync(testPath, 'utf8');

// A stray `begin;` or `commit;` in either input would break the single
// enclosing transaction. Both files deliberately have none; this asserts it
// stays that way rather than trusting a comment.
for (const [label, sql] of [
  [migrationPath, migrationSql],
  [testPath, testSql],
]) {
  const stray = sql.match(/^\s*(begin|commit|rollback)\s*;/gim);
  if (stray) {
    console.error(
      `ERROR: ${label} contains its own transaction control (${stray.join(', ').trim()}).\n` +
        'The preflight needs one enclosing transaction it can always roll back.',
    );
    process.exit(1);
  }
}

const rel = (p) => p.slice(repo.length + 1).replace(/\\/g, '/');

const banner = `-- ============================================================================
-- ${id}_preflight.generated.sql — GENERATED. DO NOT EDIT.
--
-- Regenerate with:  node scripts/build-preflight.mjs ${id}
-- Generated from:   ${rel(migrationPath)}
--                   ${rel(testPath)}
--
-- Run this whole file in the SQL editor BEFORE applying the migration. It
-- installs the migration's definitions, runs its database test against them,
-- prints the results, and then rolls everything back. It changes nothing: on
-- success the explicit ROLLBACK undoes it, and on failure the raised exception
-- ends the transaction anyway.
--
-- All rows in the printed matrix must read PASS. Then, and only then, apply
-- ${rel(migrationPath)} inside begin; … commit;
-- ============================================================================

begin;

`;

const joiner = `

-- ============================================================================
-- ^ migration definitions installed (uncommitted). Now the database test.
-- ============================================================================

`;

const footer = `

-- ============================================================================
-- Undo everything. Reached only when every check passed — the test raises
-- otherwise, which ends the transaction on its own.
-- ============================================================================
rollback;
`;

writeFileSync(out, banner + migrationSql + joiner + testSql + footer, 'utf8');

console.log(`wrote ${rel(out)}`);
console.log('Run it in the SQL editor. Every row must read PASS before applying the migration.');
