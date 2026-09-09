/**
 * old-client-upsert-check.mjs — the mandatory implementation gate for 0031.
 *
 *   node scripts/old-client-upsert-check.mjs
 *   node scripts/old-client-upsert-check.mjs --email bhw.arcenal@tbscreen.ph --password '...'
 *
 * WHAT IS BEING TESTED, and why no SQL test can stand in for it.
 *
 * Migration 0031 gives `appointments` three ownership columns and leaves them
 * nullable, because mobile builds older than the ownership release keep
 * inserting and re-pushing rows that do not mention them. The whole
 * compatibility window of Task 1.3 §3.4 rests on one claim:
 *
 *     PostgREST builds `ON CONFLICT DO UPDATE SET` from the KEYS PRESENT IN
 *     THE PAYLOAD, so a column the client never sends is left alone.
 *
 * If that is false — if PostgREST assigns every column of the table — then an
 * old phone re-pushing a queued appointment would silently NULL that row's
 * facility_id and hand it back to the patient-wide visibility BASE-02 is about.
 * That is an authorization regression delivered by a client that is behaving
 * correctly, which is the worst shape a regression can have.
 *
 * The claim is about what PostgREST GENERATES, not about what PostgreSQL
 * ENFORCES, so it cannot be checked from inside the database. It was read from
 * the code and never executed, and every gate since has carried it forward as
 * an open item. This script executes it.
 *
 * HOW IT IS TESTED BEFORE 0031 IS APPLIED. Today the server's `appointments`
 * columns are exactly the seven the mobile push already sends, so there is no
 * omitted column to observe. The script therefore runs in two stages:
 *
 *   Stage 1 (always) — MECHANISM. Upsert a row while omitting `attended_date`
 *     from the payload, over a server row that has it set. PostgREST's SQL
 *     generation does not care WHICH column is absent, so this is the same
 *     question asked with the columns that exist right now.
 *   Stage 2 (only once 0031 is applied) — THE REAL THING. Upsert the exact
 *     pre-ownership mobile payload over rows that already carry ownership, and
 *     assert it survives. TWO fixtures, because one cannot answer for the
 *     other: a REFERRAL-LINKED appointment (facility_id + referral_id set,
 *     tb_case_id null) and a CASE-LINKED one (facility_id + tb_case_id set).
 *     The first version had only the referral-linked fixture, so its
 *     "tb_case_id survives" assertion compared null to null and could not have
 *     failed — a green line that tested nothing (M31-06). The script detects
 *     the columns and skips this stage with a clear message if they are absent.
 *
 * Stage 2 is the one the gate asks for. Stage 1 passing is evidence, not proof,
 * and the script says so in its own output rather than letting a green line be
 * mistaken for the gate being closed.
 *
 * IDENTITY. It signs in as a real account so the request travels the same path
 * the phone does, including the column grants 0031 adds. If sign-in fails it
 * falls back to the service_role key and says so loudly — service_role still
 * answers the PostgREST question, but it bypasses RLS and column privileges,
 * so it is a weaker result and must not be reported as the full gate.
 *
 * IT WRITES TO THE LIVE DATABASE. One appointment row, created and deleted by
 * this script, against an existing patient. It cleans up in a finally block
 * and prints the row id so a failed cleanup can be finished by hand.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Config.
// ---------------------------------------------------------------------------
function loadEnv() {
  const out = {};
  for (const line of readFileSync(join(repo, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const env = loadEnv();
const URL_BASE = env.SUPABASE_URL?.replace(/\/$/, '');
const ANON = env.SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !ANON || !SERVICE) {
  console.error('ERROR: .env must define SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const EMAIL = arg('email', 'bhw.arcenal@tbscreen.ph');
const PASSWORD = arg('password', process.env.TBSCREEN_TEST_PASSWORD ?? env.TBSCREEN_TEST_PASSWORD);

if (!PASSWORD) {
  console.error(
    'ERROR: provide TBSCREEN_TEST_PASSWORD in the environment/.env or pass --password explicitly',
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Thin REST helpers. Deliberately not supabase-js: the point is to control the
// exact request body, and a client library is free to reshape it.
// ---------------------------------------------------------------------------
async function rest(path, { method = 'GET', token, apikey, body, prefer } = {}) {
  const headers = {
    apikey: apikey ?? ANON,
    Authorization: `Bearer ${token ?? apikey ?? ANON}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error bodies exist; keep the text */
  }
  return { status: res.status, ok: res.ok, body: json, text };
}

const asService = (path, opts = {}) => rest(path, { ...opts, apikey: SERVICE });

async function signIn() {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) return null;
  const j = await res.json();
  return j.access_token ?? null;
}

// ---------------------------------------------------------------------------
// Result bookkeeping.
// ---------------------------------------------------------------------------
const results = [];
const check = (stage, subject, pass, detail) =>
  results.push({ stage, subject, verdict: pass ? 'PASS' : 'FAIL', detail: detail ?? '' });

function report() {
  const width = Math.max(...results.map((r) => r.subject.length), 20);
  console.log('');
  for (const r of results) {
    console.log(
      `${r.verdict === 'PASS' ? '  ok  ' : ' FAIL '} ${r.stage}  ${r.subject.padEnd(width)}  ${r.detail}`,
    );
  }
  const failed = results.filter((r) => r.verdict === 'FAIL').length;
  const closedGate = results.some(
    (r) => r.stage === 'stage2' && r.subject.includes('tb_case_id survives') && r.verdict === 'PASS',
  );
  console.log('');
  console.log(
    closedGate
      ? 'GATE: CLOSED — an old-client payload preserved facility_id, referral_id and tb_case_id.'
      : 'GATE: NOT CLOSED — the tb_case_id assertion has not run against a case-linked row.',
  );
  console.log('');
  if (failed) {
    console.log(`${failed} of ${results.length} checks FAILED.`);
    console.log(
      'If an ownership column was nulled by an old-client payload, the compatibility\n' +
        'window in Task 1.3 §3.4 is NOT optional: the rejecting BEFORE INSERT trigger and\n' +
        'the minimum-supported-build gate must ship BEFORE any client relies on ownership.',
    );
  } else {
    console.log(`all ${results.length} checks passed.`);
  }
  return failed;
}

// ---------------------------------------------------------------------------
// Main.
//
// Everything this script creates is registered here as it is created, and torn
// down in reverse in the finally block. Reverse order matters: appointments
// reference tb_cases with ON DELETE RESTRICT, so the case can only go once its
// appointment has.
// ---------------------------------------------------------------------------
const created = { appointments: [], cases: [] };

async function main() {
  // Which identity is asking. A real account travels the same path as the
  // phone; service_role does not, and the difference has to be visible in the
  // output rather than buried here.
  const token = await signIn();
  const identity = token ? `${EMAIL} (authenticated)` : 'service_role (FALLBACK)';
  const callerToken = token ?? SERVICE;
  const callerKey = token ? ANON : SERVICE;

  console.log(`project : ${URL_BASE}`);
  console.log(`identity: ${identity}`);
  if (!token) {
    console.log(
      'WARNING : sign-in failed, so this run used service_role. It still answers the\n' +
        '          PostgREST question, but it bypasses RLS and column privileges, so it is\n' +
        '          NOT the full gate. Re-run with --password to close it properly.',
    );
  }

  // Does the server already have the ownership columns?
  const probe = await asService('appointments?select=facility_id,referral_id,tb_case_id&limit=1');
  const hasOwnership = probe.ok;
  console.log(`0031    : ${hasOwnership ? 'applied (ownership columns present)' : 'NOT applied'}`);

  // A patient to hang the fixture on — chosen AS THE CALLER, not as
  // service_role. RLS decides whether the upsert is even attempted, so a
  // fixture the caller cannot see makes the whole run vacuous: the write is
  // refused, nothing changes, and "the omitted column survived" is true for
  // the wrong reason. The first version of this script had exactly that bug.
  const pat = await rest('patients?select=patient_id&limit=1', {
    token: callerToken,
    apikey: callerKey,
  });
  if (!pat.ok || !pat.body?.length) {
    throw new Error(
      `the caller can see no patient row to test with: ${pat.status} ${pat.text}`,
    );
  }
  const patientId = pat.body[0].patient_id;

  // A referral and facility for the same patient, so stage 2 can set real
  // ownership rather than an arbitrary uuid the FK would reject.
  let ref = null;
  if (hasOwnership) {
    const r = await rest(
      `referrals?select=referral_id,facility_id&patient_id=eq.${patientId}&limit=1`,
      { token: callerToken, apikey: callerKey },
    );
    if (r.ok && r.body?.length) ref = r.body[0];
  }

  const today = new Date().toISOString().slice(0, 10);

  /** Insert one appointment as service_role and remember it for teardown. */
  async function makeAppointment(row) {
    const res = await asService('appointments', {
      method: 'POST',
      body: row,
      prefer: 'return=representation',
    });
    if (!res.ok) throw new Error(`fixture insert failed: ${res.status} ${res.text}`);
    created.appointments.push(row.appointment_id);
    return res.body[0];
  }

  const fixtureId = crypto.randomUUID();
  const fixture = {
    appointment_id: fixtureId,
    patient_id: patientId,
    scheduled_date: today,
    attended_date: today,
    status: 'attended',
  };
  if (hasOwnership && ref) {
    fixture.facility_id = ref.facility_id;
    fixture.referral_id = ref.referral_id;
  }
  const before = await makeAppointment(fixture);

  // -------------------------------------------------------------------------
  // Stage 1 — the mechanism, with the columns that exist today.
  //
  // The payload deliberately OMITS attended_date. If PostgREST assigns every
  // column of the table on conflict, attended_date comes back null.
  // -------------------------------------------------------------------------
  const stage1Payload = {
    appointment_id: fixtureId,
    patient_id: patientId,
    scheduled_date: today,
    status: 'attended',
  };

  const up1 = await rest('appointments', {
    method: 'POST',
    token: callerToken,
    apikey: callerKey,
    body: stage1Payload,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  check('stage1', 'upsert accepted', up1.ok, `${up1.status} ${up1.ok ? '' : up1.text}`);

  const after1 = (await asService(`appointments?select=*&appointment_id=eq.${fixtureId}`)).body?.[0];
  // Gated on the upsert actually happening. An unchanged column proves nothing
  // if no write reached the row.
  check(
    'stage1',
    'omitted column survives',
    up1.ok && after1?.attended_date === before.attended_date,
    up1.ok
      ? `attended_date ${before.attended_date} -> ${after1?.attended_date ?? 'null'}`
      : 'not evaluated — the upsert above was refused',
  );

  // -------------------------------------------------------------------------
  // Stage 2 — the gate itself.
  // -------------------------------------------------------------------------
  if (!hasOwnership) {
    console.log(
      '\nSTAGE 2 SKIPPED: appointments has no ownership columns yet, so the gate is not\n' +
        'closed. Apply migration 0031, then run this script again. Stage 1 shows the\n' +
        'mechanism holds for a column PostgREST was not told about, which is the same\n' +
        'question — but the gate asks it about facility_id, referral_id and tb_case_id.',
    );
    return;
  }
  if (!ref) {
    console.log(
      '\nSTAGE 2 SKIPPED: the chosen patient has no referral, so there was no valid\n' +
        'facility/referral pair to set on the fixture. Re-run against a patient that has\n' +
        'one; the composite FK rejects an invented pair, correctly.',
    );
    return;
  }

  /**
   * Send the EXACT payload a pre-ownership mobile build sends — syncEngine.ts's
   * toServerPayload() over LocalAppointmentRow, which strips only sync_status —
   * and assert that each ownership column the row started with is still there.
   *
   * `expect` names the columns that must be NON-NULL both before and after. A
   * column that was null to begin with is not evidence of anything, so it is
   * asserted as unchanged but reported as vacuous rather than as a pass.
   */
  async function oldClientProbe(label, row, expect) {
    const payload = {
      appointment_id: row.appointment_id,
      patient_id: row.patient_id,
      scheduled_date: row.scheduled_date,
      attended_date: row.attended_date,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    const res = await rest('appointments', {
      method: 'POST',
      token: callerToken,
      apikey: callerKey,
      body: payload,
      prefer: 'resolution=merge-duplicates,return=representation',
    });
    check('stage2', `${label}: old-client upsert accepted`, res.ok,
      `${res.status} ${res.ok ? '' : res.text}`);

    const after = (
      await asService(`appointments?select=*&appointment_id=eq.${row.appointment_id}`)
    ).body?.[0];

    for (const col of expect) {
      const wasSet = row[col] !== null && row[col] !== undefined;
      check(
        'stage2',
        `${label}: ${col} survives`,
        res.ok && wasSet && after?.[col] === row[col],
        wasSet
          ? `${row[col]} -> ${after?.[col] ?? 'null'}`
          : `VACUOUS — ${col} was already null on the fixture, so this proves nothing`,
      );
    }
    return after;
  }

  // Fixture A — referral-linked. tb_case_id is null here by construction
  // (appointments_one_owner), so this fixture can only speak for two columns.
  await oldClientProbe('referral-linked', before, ['facility_id', 'referral_id']);

  // Fixture B — case-linked, which is the one M31-06 is about. Built directly
  // as service_role rather than through create_tb_case(), because this script
  // signs in as the mobile role and case creation is a TB-DOTS operation; what
  // is under test is PostgREST's upsert, not the RPC.
  const caseFixture = await buildCaseLinkedFixture();
  if (caseFixture) {
    await oldClientProbe('case-linked', caseFixture, ['facility_id', 'tb_case_id']);
  } else {
    // Recorded as a failure on purpose. The gate asks specifically about
    // tb_case_id, and a run that could not ask must not exit 0 and read as
    // "closed" — that is the shape of M31-06 itself, one level up.
    check('stage2', 'case-linked fixture available', false,
      'the tb_case_id assertion did not run; the gate is NOT closed');
  }

  // The other half of the same window: a NEW client re-sending the ownership
  // columns unchanged must also be accepted, or the retry path is stranded the
  // other way round. This is the ownership trigger's "identical re-send" branch,
  // asked over real PostgREST rather than in SQL.
  const newClientPayload = {
    appointment_id: fixtureId,
    patient_id: patientId,
    scheduled_date: today,
    attended_date: today,
    status: 'attended',
    facility_id: before.facility_id,
    referral_id: before.referral_id,
  };
  const up3 = await rest('appointments', {
    method: 'POST',
    token: callerToken,
    apikey: callerKey,
    body: newClientPayload,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  check('stage2', 'new-client identical re-send accepted', up3.ok,
    `${up3.status} ${up3.ok ? '' : up3.text}`);

  /**
   * A case-linked appointment for a patient the CALLER can see. Returns null,
   * with a printed reason, if the live data cannot supply one — never a
   * silently skipped assertion.
   */
  async function buildCaseLinkedFixture() {
    // The patient needs no OPEN case of their own: tb_cases_one_active_per_patient
    // is global, so a second one would be refused.
    const visible = await rest('patients?select=patient_id&limit=25', {
      token: callerToken,
      apikey: callerKey,
    });
    const openCases = await asService(
      'tb_cases?select=patient_id&case_status=in.(registered,on_treatment,interrupted)',
    );
    const taken = new Set((openCases.body ?? []).map((c) => c.patient_id));

    let chosen = null;
    for (const p of visible.body ?? []) {
      if (taken.has(p.patient_id)) continue;
      const r = await asService(
        `referrals?select=referral_id,facility_id&patient_id=eq.${p.patient_id}&limit=1`,
      );
      if (r.ok && r.body?.length) {
        chosen = { patientId: p.patient_id, facilityId: r.body[0].facility_id };
        break;
      }
    }
    if (!chosen) {
      console.log(
        '\nFIXTURE B SKIPPED: no caller-visible patient without an open case and with a\n' +
          'referral. The case-linked assertion did not run; the gate is not fully closed.',
      );
      return null;
    }

    const staff = await asService(
      `users?select=user_id&role=eq.tb_dots&facility_id=eq.${chosen.facilityId}&limit=1`,
    );
    if (!staff.ok || !staff.body?.length) {
      console.log(
        '\nFIXTURE B SKIPPED: no TB-DOTS user at that facility to own the case row.',
      );
      return null;
    }

    const caseId = crypto.randomUUID();
    const mk = await asService('tb_cases', {
      method: 'POST',
      body: {
        case_id: caseId,
        patient_id: chosen.patientId,
        facility_id: chosen.facilityId,
        case_number: `TBC-CHK-${caseId.slice(0, 8)}`,
        registration_date: today,
        case_status: 'registered',
        created_by: staff.body[0].user_id,
      },
      prefer: 'return=representation',
    });
    if (!mk.ok) {
      console.log(`\nFIXTURE B SKIPPED: could not create a case row (${mk.status} ${mk.text})`);
      return null;
    }
    created.cases.push(caseId);

    return await makeAppointment({
      appointment_id: crypto.randomUUID(),
      patient_id: chosen.patientId,
      scheduled_date: today,
      attended_date: today,
      status: 'attended',
      facility_id: chosen.facilityId,
      tb_case_id: caseId,
    });
  }
}

try {
  await main();
} catch (err) {
  check('harness', 'ran to completion', false, String(err?.message ?? err));
} finally {
  // Reverse order: an appointment references its case with ON DELETE RESTRICT.
  for (const id of created.appointments) {
    const del = await asService(`appointments?appointment_id=eq.${id}`, { method: 'DELETE' });
    if (!del.ok) {
      console.error(`\nCLEANUP FAILED for appointment ${id} (${del.status}). Delete it by hand.`);
    }
  }
  for (const id of created.cases) {
    const del = await asService(`tb_cases?case_id=eq.${id}`, { method: 'DELETE' });
    if (!del.ok) {
      console.error(`\nCLEANUP FAILED for tb_case ${id} (${del.status}). Delete it by hand.`);
    }
  }
}

process.exit(report() > 0 ? 1 : 0);
