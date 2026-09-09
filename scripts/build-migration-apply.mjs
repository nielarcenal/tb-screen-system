/**
 * Wrap one migration in an explicit transaction for Management API apply.
 *
 *   node scripts/build-migration-apply.mjs 0032
 *
 * Output is gitignored (`supabase/tests/*.generated.sql`). The source migration
 * remains transaction-free so build-preflight.mjs can compose and roll it back.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(repo, 'supabase', 'migrations');
const testsDir = join(repo, 'supabase', 'tests');
const id = process.argv[2];

if (!/^\d{4}$/.test(id ?? '')) {
  console.error('usage: node scripts/build-migration-apply.mjs <NNNN>');
  process.exit(2);
}

const hits = readdirSync(migrationsDir).filter(
  (file) => file.startsWith(`${id}_`) && file.endsWith('.sql'),
);
if (hits.length !== 1) {
  console.error(`ERROR: expected one migration for ${id}, found ${hits.length}`);
  process.exit(1);
}

const source = join(migrationsDir, hits[0]);
const sql = readFileSync(source, 'utf8');
if (/^\s*(begin|commit|rollback)\s*;/im.test(sql)) {
  console.error(`ERROR: ${hits[0]} already contains transaction control`);
  process.exit(1);
}

const output = join(testsDir, `${id}_apply.generated.sql`);
writeFileSync(
  output,
  `-- GENERATED from supabase/migrations/${hits[0]}; do not edit.\nbegin;\n\n${sql}\n\ncommit;\n`,
  'utf8',
);
console.log(`wrote supabase/tests/${id}_apply.generated.sql`);
