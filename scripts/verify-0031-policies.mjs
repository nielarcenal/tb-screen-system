/**
 * verify-0031-policies.mjs — prove that 0031 only changed what it says it did.
 *
 *   node scripts/verify-0031-policies.mjs
 *
 * WHY. `CREATE POLICY` takes a whole expression, so replacing one policy means
 * retyping all of it, and a retyped policy is a chance to silently change an
 * unrelated clause. 0028 had this problem with function bodies and 0029 with
 * 28 policies; both shipped a script that compares the new text against its
 * source and self-tests by mutating its own input. This is the same tool for
 * 0031's much smaller transcription surface.
 *
 * 0031 replaces six policies on `appointments`. Four are genuinely new
 * (BASE-02 ownership) and are not transcriptions of anything. TWO are
 * transcriptions — `appointments_bhw_read` and `appointments_bhw_update` are
 * carried over from 0029 unchanged, because BHW visibility is barangay-scoped
 * and deliberately does NOT depend on facility_id. Those two are what this
 * checks, plus the two structural rules that cost review rounds:
 *
 *   * R3-04 — every policy and helper 0031 introduces must call
 *     current_user_active_role(), never current_user_role(). The finding was
 *     literally "a NEW policy written with the old helper", which reproduces
 *     BASE-06 inside freshly written authorization.
 *   * R3-05 — no policy may reach an enumerating helper through `public`.
 *     In `public` those are RPCs that hand out other people's row ids with no
 *     policy in the way.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = join(repo, 'supabase', 'migrations');

const SRC_0029 = join(migrations, '0029_active_aware_rls.sql');
const SRC_0031 = join(migrations, '0031_case_registry_and_followups.sql');

/** Whitespace is not meaning; everything else is. */
const normalize = (s) => s.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Pull every `create policy` statement out of a migration, keyed by name.
 * Statements end at the first `;` that is not inside a quoted string — none of
 * these policies contain one, and the parser asserts that rather than assuming
 * it.
 */
function policies(sql) {
  const out = new Map();
  const re = /create\s+policy\s+(\w+)\s+on\s+([\w.]+)([\s\S]*?);/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const [, name, table, body] = m;
    if (/'[^']*;/.test(body)) {
      throw new Error(`policy ${name} contains a semicolon inside a literal; the parser is too naive for it`);
    }
    out.set(name, { table, text: normalize(body) });
  }
  return out;
}

const results = [];
const record = (subject, ok, detail = '') =>
  results.push({ subject, verdict: ok ? 'OK' : 'MISMATCH', detail });

/** The whole check, as a function so the self-test can run it on mutated input. */
function run(sql0029, sql0031) {
  const local = [];
  const say = (subject, ok, detail = '') =>
    local.push({ subject, verdict: ok ? 'OK' : 'MISMATCH', detail });

  const a = policies(sql0029);
  const b = policies(sql0031);

  // 1. The two transcribed BHW policies, verbatim.
  for (const name of ['appointments_bhw_read', 'appointments_bhw_update']) {
    const from = a.get(name);
    const to = b.get(name);
    if (!from || !to) {
      say(name, false, `missing in ${!from ? '0029' : '0031'}`);
      continue;
    }
    say(name, from.text === to.text, from.text === to.text ? 'verbatim from 0029' : 'text differs');
  }

  // 2. appointments_bhw_insert is a DECLARED exception: it must differ, and it
  //    must differ by gaining the ownership arms. A test that only allowed
  //    differences would pass on any rewrite at all.
  const insFrom = a.get('appointments_bhw_insert');
  const insTo = b.get('appointments_bhw_insert');
  say('appointments_bhw_insert differs', Boolean(insFrom && insTo && insFrom.text !== insTo.text),
    'declared exception: it gains the referral/facility arms');
  say('appointments_bhw_insert keeps the 0029 predicate',
    Boolean(insTo && insTo.text.includes("public.current_user_active_role() = 'bhw'")
      && insTo.text.includes('app_private.bhw_visible_patient_ids()')),
    'barangay scope unchanged');
  say('appointments_bhw_insert forbids a case link',
    Boolean(insTo && insTo.text.includes('tb_case_id is null')),
    'a BHW never creates a case-linked appointment');
  say('appointments_bhw_insert keeps the legacy arm',
    Boolean(insTo && insTo.text.includes('referral_id is null and facility_id is null')),
    'old mobile builds must still be able to insert (§3.4)');

  // 3. R3-04 — no policy in 0031 uses the non-active-aware helper.
  const stale = [...b.entries()].filter(([, p]) => /(?<!active_)current_user_role\s*\(/.test(p.text));
  say('no policy calls current_user_role()', stale.length === 0,
    stale.length ? stale.map(([n]) => n).join(', ') : `${b.size} policies checked`);

  // 4. R3-05 — no policy reaches an enumerating helper through `public`.
  const enumerating = /public\.(referred_patient_ids|referred_screening_ids|bhw_visible_patient_ids|own_enrolled_patient_ids|own_facility_case_ids)/;
  const leaked = [...b.entries()].filter(([, p]) => enumerating.test(p.text));
  say('no policy reaches an enumerating helper via public', leaked.length === 0,
    leaked.length ? leaked.map(([n]) => n).join(', ') : 'all go through app_private');

  // 5. The helper 0031 introduces must itself be active-aware. It is not a
  //    policy, so the scan above cannot see it.
  const helper = /create or replace function public\.caller_owns_unassigned_appointment[\s\S]*?\$fn\$;/i.exec(sql0031);
  say('caller_owns_unassigned_appointment is active-aware',
    Boolean(helper && /current_user_active_role\(\)/.test(helper[0])
      && !/(?<!active_)current_user_role\s*\(/.test(helper[0])),
    'R2-06/R3-04');

  return local;
}

// ---------------------------------------------------------------------------
// The real run.
// ---------------------------------------------------------------------------
// This repository is CRLF. The self-test anchors below are written with plain
// newlines, so line endings are normalised on the way in rather than doubled in
// every pattern — a mutation that silently matches nothing is a self-test that
// reports OK while having tested nothing.
const read = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n');
const sql0029 = read(SRC_0029);
const sql0031 = read(SRC_0031);
results.push(...run(sql0029, sql0031));

// ---------------------------------------------------------------------------
// Self-tests. A verifier nobody has seen fail is a verifier nobody has tested.
// Each mutation targets a DIFFERENT check, so a hole in one is not covered by
// another catching the same edit.
// ---------------------------------------------------------------------------
const mutations = [
  {
    label: 'transcription: a changed BHW read predicate',
    apply: (s) => s.replace(
      "public.current_user_active_role() = 'bhw'\n    and patient_id in (select app_private.bhw_visible_patient_ids())\n  );\n\ndrop policy if exists appointments_bhw_update",
      "public.current_user_active_role() = 'bhw'\n  );\n\ndrop policy if exists appointments_bhw_update",
    ),
  },
  {
    label: 'R3-04: a policy reverted to current_user_role()',
    apply: (s) => s.replace(
      "public.current_user_active_role() = 'tb_dots'\n    and facility_id = public.current_user_facility()",
      "public.current_user_role() = 'tb_dots'\n    and facility_id = public.current_user_facility()",
    ),
  },
  {
    label: 'R3-05: a policy reaching an enumerating helper via public',
    apply: (s) => s.replace(
      'select app_private.own_facility_case_ids()',
      'select public.own_facility_case_ids()',
    ),
  },
  {
    label: '§3.4: the legacy insert arm removed',
    apply: (s) => s.replace(
      '(referral_id is null and facility_id is null)',
      '(referral_id is not null)',
    ),
  },
];

let selfTestFailures = 0;
for (const m of mutations) {
  const mutated = m.apply(sql0031);
  if (mutated === sql0031) {
    console.error(`SELF-TEST BROKEN: "${m.label}" changed nothing — the anchor text has moved.`);
    selfTestFailures += 1;
    continue;
  }
  const caught = run(sql0029, mutated).some((r) => r.verdict === 'MISMATCH');
  record(`self-test — ${m.label}`, caught, caught ? 'caught' : 'NOT CAUGHT');
  if (!caught) selfTestFailures += 1;
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
const width = Math.max(...results.map((r) => r.subject.length));
for (const r of results) {
  console.log(`${r.verdict === 'OK' ? '  ok  ' : ' FAIL '} ${r.subject.padEnd(width)}  ${r.detail}`);
}

const failures = results.filter((r) => r.verdict === 'MISMATCH').length;
console.log('');
if (failures || selfTestFailures) {
  console.log(`${failures} check(s) failed; ${selfTestFailures} self-test problem(s).`);
  process.exit(1);
}
console.log(`all ${results.length} checks OK (${mutations.length} self-tests caught their mutation).`);
