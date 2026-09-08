/**
 * build-0028-preflight.mjs — assemble the transactional pre-apply check for
 * migration 0028.
 *
 * WHY THIS EXISTS. The denial matrix has to exercise definitions that only
 * exist after 0028 runs, so it cannot verify 0028 "before application" unless
 * both run in the same transaction. This script concatenates them:
 *
 *     begin;
 *       <0028_null_safe_role_gates.sql>
 *       <0028_role_gate_matrix.sql>       -- ends by raising on any FAIL
 *     rollback;
 *
 * into supabase/tests/0028_preflight.generated.sql, which is safe to run
 * against the live project: it always rolls back, so it changes nothing, and a
 * single FAIL row aborts it. Only after it reports all PASS should 0028 be
 * applied for real.
 *
 * The output is GENERATED and gitignored-by-convention — regenerate it, never
 * edit it. That is the point: a hand-maintained copy of the migration would
 * drift from the migration it is supposed to be verifying, and would then be
 * verifying the wrong thing while looking fine.
 *
 *   node scripts/build-0028-preflight.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const migration = join(repo, 'supabase', 'migrations', '0028_null_safe_role_gates.sql');
const matrix = join(repo, 'supabase', 'tests', '0028_role_gate_matrix.sql');
const out = join(repo, 'supabase', 'tests', '0028_preflight.generated.sql');

const migrationSql = readFileSync(migration, 'utf8');
const matrixSql = readFileSync(matrix, 'utf8');

// A stray `begin;` or `commit;` in either input would break the single
// enclosing transaction — 0028 deliberately has neither, and this asserts it
// stays that way rather than trusting a comment.
for (const [label, sql] of [['0028', migrationSql], ['matrix', matrixSql]]) {
  const stray = sql.match(/^\s*(begin|commit|rollback)\s*;/gim);
  if (stray) {
    console.error(
      `ERROR: ${label} contains its own transaction control (${stray.join(', ').trim()}).\n` +
        'The preflight needs one enclosing transaction it can always roll back.',
    );
    process.exit(1);
  }
}

const banner = `-- ============================================================================
-- 0028_preflight.generated.sql — GENERATED. DO NOT EDIT.
--
-- Regenerate with:  node scripts/build-0028-preflight.mjs
-- Generated from:   supabase/migrations/0028_null_safe_role_gates.sql
--                   supabase/tests/0028_role_gate_matrix.sql
--
-- Run this whole file in the SQL editor BEFORE applying 0028. It installs the
-- migration's definitions, runs the denial matrix against them, prints the
-- matrix, and then rolls everything back. It changes nothing: on success the
-- explicit ROLLBACK undoes it, and on failure the raised exception ends the
-- transaction anyway.
--
-- The one thing rollback cannot undo is a handful of consumed PAT-DOTS-####
-- sequence values (sequences are non-transactional). Harmless.
--
-- All rows in the printed matrix must read PASS. Then, and only then, apply
-- supabase/migrations/0028_null_safe_role_gates.sql inside begin; … commit;
-- ============================================================================

begin;

`;

const joiner = `

-- ============================================================================
-- ^ migration definitions installed (uncommitted). Now the denial matrix.
-- ============================================================================

`;

const footer = `

-- ============================================================================
-- Undo everything. Reached only when every check passed — the matrix raises
-- otherwise, which ends the transaction on its own.
-- ============================================================================
rollback;
`;

writeFileSync(out, banner + migrationSql + joiner + matrixSql + footer, 'utf8');

console.log(`wrote ${out.replace(repo + '\\', '').replace(repo + '/', '')}`);
console.log('Run it in the SQL editor. Every row must read PASS before 0028 is applied.');
