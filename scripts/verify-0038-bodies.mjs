/**
 * verify-0038-bodies.mjs — proves that migration 0038 removed six statements
 * from five applied functions and changed nothing else.
 *
 * WHY THIS EXISTS. 0038 makes the appointments trigger the single writer of
 * appointment audit events (C41-02). To stop the five case-registry RPCs
 * double-logging, it had to restate 471 lines of applied plpgsql in order to
 * delete six `perform app_private.write_audit('appointments', ...)` calls.
 *
 * Those functions are the entire mutation surface for cases, visits and
 * appointment ownership. A stray edit inside one — a dropped `for update`, a
 * loosened denial, an inverted predicate — would be an authorization or
 * concurrency defect sitting in the middle of a diff that a reviewer is reading
 * as "audit plumbing", which is exactly the kind of change that gets waved
 * through.
 *
 *   node scripts/verify-0038-bodies.mjs
 *
 * So this takes 0031's text, applies THE SAME mechanical removal 0038 claims to
 * have applied, and requires the result to equal 0038's text character for
 * character after whitespace collapsing. It also asserts the removal actually
 * happened, so deleting the fix entirely cannot print OK.
 *
 * This checks TRANSCRIPTION ONLY. Whether the trigger emits the right events is
 * what supabase/tests/0038_appointment_audit_matrix.sql answers, by writing rows.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const mig = (name) =>
  readFileSync(join(repo, 'supabase', 'migrations', name), 'utf8').replace(/\r\n/g, '\n');

const PREVIOUS = '0031_case_registry_and_followups.sql';
const CURRENT = '0038_appointment_audit_trail.sql';

/** How many appointment audit calls each function is expected to lose. */
const EXPECTED = {
  set_tb_case_status: 1,
  claim_unassigned_appointment: 1,
  assign_appointment_to_case: 1,
  record_visit: 2,
  correct_followup_visit_date: 1,
};

function extract(sql, name) {
  const re = new RegExp(
    'create\\s+or\\s+replace\\s+function\\s+public\\.' + name +
      '\\s*\\([\\s\\S]*?\\sas\\s+(\\$[a-z_]*\\$)[\\s\\S]*?\\1;',
    'gi',
  );
  const m = [...sql.matchAll(re)];
  if (m.length !== 1) throw new Error(`${name}: found ${m.length} definitions`);
  return m[0][0];
}

/**
 * Delete every `perform app_private.write_audit(` whose first argument is
 * 'appointments', through the line that closes the statement, plus the blank
 * line after it and the comment block immediately above it.
 *
 * This is the ONLY transformation permitted between 0031 and 0038. If 0038
 * differs from its output in any other way, the comparison below fails.
 */
function stripApptAudit(def) {
  const lines = def.split('\n');
  const out = [];
  let removed = 0;
  for (let i = 0; i < lines.length; i++) {
    const isCall =
      /perform app_private\.write_audit\($/.test(lines[i].trim()) &&
      /^'appointments',/.test((lines[i + 1] ?? '').trim());
    if (!isCall) {
      out.push(lines[i]);
      continue;
    }
    let depth = 0;
    let j = i;
    for (; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
      }
      if (depth === 0 && lines[j].trimEnd().endsWith(';')) break;
    }
    let end = j;
    if ((lines[end + 1] ?? '').trim() === '') end += 1;
    while (out.length && out[out.length - 1].trim().startsWith('--')) out.pop();
    if (out.length && out[out.length - 1].trim() === '') out.pop();
    i = end;
    removed++;
  }
  return { text: out.join('\n'), removed };
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

const beforeSql = mig(PREVIOUS);
const afterSql = mig(CURRENT);

let failed = 0;
const fail = (msg) => {
  failed += 1;
  console.log(`FAIL  ${msg}`);
};

for (const [name, expected] of Object.entries(EXPECTED)) {
  const before = extract(beforeSql, name);
  const after = extract(afterSql, name);
  const { text, removed } = stripApptAudit(before);

  if (removed !== expected) {
    fail(`${name}: 0031 holds ${removed} appointment audit call(s), expected ${expected}`);
    continue;
  }

  if (norm(text) === norm(after)) {
    console.log(`OK    ${name} is 0031's body minus ${removed} appointment audit call(s)`);
  } else {
    const a = norm(text);
    const b = norm(after);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    fail(
      `${name} diverges beyond the removed audit call(s)\n` +
        `        at char ${i}\n` +
        `        expected: ...${a.slice(Math.max(0, i - 50), i + 70)}\n` +
        `        0038:     ...${b.slice(Math.max(0, i - 50), i + 70)}`,
    );
  }
}

// The removal must actually have happened. Without this, a 0038 that simply
// copied 0031 verbatim would still be compared against a stripped version and
// fail — but a 0038 that copied 0031 AND a verifier that stripped nothing would
// both agree and print OK. Assert the end state directly.
for (const name of Object.keys(EXPECTED)) {
  const after = extract(afterSql, name);
  const left = (stripApptAudit(after).removed);
  if (left === 0) {
    console.log(`OK    ${name} audits no appointment itself`);
  } else {
    fail(`${name} still contains ${left} appointment audit call(s) — the RPC would double-log`);
  }
}

// Exactly one function in 0038 may write an appointment audit event.
const writers = [...afterSql.matchAll(/create or replace function public\.(\w+)/gi)]
  .map((m) => m[1])
  .filter((n) => {
    const def = extract(afterSql, n);
    return /write_audit\(\s*\n?\s*'appointments'/.test(def) || /'appointments', new\.appointment_id/.test(def);
  });
if (writers.length === 1 && writers[0] === 'audit_appointment_change') {
  console.log('OK    audit_appointment_change is the only appointment audit writer');
} else {
  fail(`expected audit_appointment_change to be the sole writer, found [${writers.join(', ')}]`);
}

// ---------------------------------------------------------------------------
// Self-test: mutate 0038 in memory and assert each change is caught. The second
// is the one that matters — it is the failure this whole file exists to prevent.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  {
    label: 'a dropped row lock in a restated body',
    from: `select * into v_appt_old from public.appointments
     where appointment_id = p_appointment_id
       and facility_id = v_caller.caller_facility_id
       and tb_case_id  = p_case_id
       for update;`,
    to: `select * into v_appt_old from public.appointments
     where appointment_id = p_appointment_id
       and facility_id = v_caller.caller_facility_id
       and tb_case_id  = p_case_id;`,
    check: (sql) => norm(stripApptAudit(extract(beforeSql, 'record_visit')).text) !== norm(extract(sql, 'record_visit')),
  },
  {
    label: 'an appointment audit call left in an RPC',
    from: `  update public.appointments
       set status = 'attended', attended_date = v_visit
     where appointment_id = p_appointment_id
    returning * into v_appt;`,
    to: `  update public.appointments
       set status = 'attended', attended_date = v_visit
     where appointment_id = p_appointment_id
    returning * into v_appt;

    perform app_private.write_audit(
      'appointments', v_appt.appointment_id, 'updated',
      v_appt.patient_id, v_appt.facility_id,
      jsonb_build_object('status', jsonb_build_object('from', 'x', 'to', 'attended')));`,
    check: (sql) => stripApptAudit(extract(sql, 'record_visit')).removed > 0,
  },
  {
    label: 'a loosened denial in a restated body',
    from: `  if not public.caller_owns_unassigned_appointment(v_appt.patient_id) then
    perform app_private.deny();
  end if;`,
    to: `  if false then
    perform app_private.deny();
  end if;`,
    check: (sql) =>
      norm(stripApptAudit(extract(beforeSql, 'claim_unassigned_appointment')).text) !==
      norm(extract(sql, 'claim_unassigned_appointment')),
  },
];

let selfTestFailed = 0;
for (const mut of MUTATIONS) {
  const mutated = afterSql.replace(mut.from, mut.to);
  if (mutated === afterSql) {
    selfTestFailed += 1;
    console.log(`\nSELFTEST FAIL — mutation text not found: ${mut.label}`);
    continue;
  }
  let caught = false;
  try {
    caught = mut.check(mutated);
  } catch {
    caught = true; // an extraction failure is also a detection
  }
  if (!caught) {
    selfTestFailed += 1;
    console.log(`\nSELFTEST FAIL — ${mut.label} was NOT detected.`);
  }
}

if (selfTestFailed === 0) {
  console.log(
    '\nSelf-test: a dropped row lock, a left-in audit call and a loosened denial are all caught.',
  );
}

console.log(
  failed === 0 && selfTestFailed === 0
    ? 'The five RPCs lost six appointment audit calls and nothing else. Transcription verified.'
    : `${failed} mismatch(es), ${selfTestFailed} self-test failure(s). Do not apply 0038.`,
);
process.exit(failed === 0 && selfTestFailed === 0 ? 0 : 1);
