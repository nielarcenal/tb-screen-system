/**
 * manage-bhw — Supabase Edge Function (account management).
 *
 * Two caller roles, one function (auth admin API needs the service role,
 * which must never reach the browser):
 *
 *   captain → manages BHW accounts of THEIR OWN ASSIGNED BARANGAY only
 *             (0008: captains from other barangays cannot touch BHWs outside
 *             their area; new BHWs are always assigned the captain's barangay).
 *   admin   → manages CAPTAIN accounts (default) or TB-DOTS STAFF accounts
 *             (body.target_role = 'tb_dots'): staff belong to a facility and
 *             have no barangay; captains get a barangay and derive their
 *             facility from it.
 *
 * Actions (POST JSON { action, ... }):
 *   create         captain: { first_name, last_name }
 *                  admin:   { first_name, last_name, barangay_code } — the
 *                  facility is derived from the barangay's LGU default DOTS
 *                  center (ref_cities.default_facility_id, 0009); an explicit
 *                  facility_id in the body overrides it.
 *                  → creates the auth user (auto email firstname.lastname@tbscreen.ph,
 *                    .2/.3… suffix on clash; temp password), inserts the users
 *                    row, returns { email, temp_password }.
 *   update         { user_id, first_name, last_name } (admin may also send
 *                  barangay_code to reassign a captain)
 *   deactivate     { user_id } → users.active=false + auth ban (blocks sign-in).
 *   reactivate     { user_id } → users.active=true  + ban lifted.
 *   reset_password { user_id } → sets a fresh temp password and returns it
 *                  (passwords are hashed — they can never be viewed, only reset).
 *
 * Browser calls: supabase.functions.invoke sends a CORS preflight — every
 * response (including OPTIONS) must carry the CORS headers.
 *
 * PRIVACY: this function reads/writes ONLY facilities/users/auth — no patient
 * data ever passes through it. Captains and admins have no patient policies.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

interface Body {
  action: 'create' | 'update' | 'deactivate' | 'reactivate' | 'reset_password';
  /** Admin callers only: which account type they are managing (default captain). */
  target_role?: 'captain' | 'tb_dots';
  user_id?: string;
  first_name?: string;
  last_name?: string;
  barangay_code?: string;
  facility_id?: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

/** One name part → lowercase ASCII letters, inner spaces dropped ("Dela Cruz" → "delacruz"). */
function slugPart(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

/** Random temp password like TBS-4829-kfmq (letters avoid ambiguous chars). */
function tempPassword(): string {
  const digits = Math.floor(1000 + Math.random() * 9000);
  const letters = Array.from(
    { length: 4 },
    () => 'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random() * 23)],
  ).join('');
  return `TBS-${digits}-${letters}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, // service role: server-side only
  );

  // --- caller must be an ACTIVE captain (manages BHWs) or admin (captains) ---
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: callerAuth, error: authErr } = await admin.auth.getUser(jwt);
  if (authErr || !callerAuth?.user) return json(401, { error: 'unauthorized' });

  const { data: caller, error: callerErr } = await admin
    .from('users')
    .select('role, facility_id, assigned_barangay_code, active')
    .eq('user_id', callerAuth.user.id)
    .maybeSingle();
  if (callerErr) return json(500, { error: callerErr.message });
  if (!caller || !caller.active || (caller.role !== 'captain' && caller.role !== 'admin')) {
    return json(403, { error: 'captain or admin role required' });
  }
  const isAdmin = caller.role === 'admin';
  if (!isAdmin && !caller.assigned_barangay_code) {
    return json(403, { error: 'captain has no assigned barangay' });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(400, { error: 'invalid JSON body' });
  }

  // Admins choose what they manage (captains by default, or tb_dots staff);
  // captains always manage BHWs.
  const managedRole = isAdmin ? (body.target_role === 'tb_dots' ? 'tb_dots' : 'captain') : 'bhw';

  // --- helper: load a target account and verify role + scope ---
  const loadTarget = async (userId: string) => {
    const { data: target, error } = await admin
      .from('users')
      .select('user_id, role, assigned_barangay_code')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!target || target.role !== managedRole) return null;
    // Captains only reach BHWs of their own barangay (0008).
    if (!isAdmin && target.assigned_barangay_code !== caller.assigned_barangay_code) {
      return null;
    }
    return target;
  };
  const notFound = () =>
    json(404, {
      error: isAdmin ? `${managedRole} account not found` : 'BHW not found in your barangay',
    });

  try {
    switch (body.action) {
      case 'create': {
        const first = (body.first_name ?? '').trim();
        const last = (body.last_name ?? '').trim();
        if (!first || !last) {
          return json(400, { error: 'first_name and last_name required' });
        }
        // TB-DOTS staff (admin only): a facility, no barangay.
        if (managedRole === 'tb_dots') {
          if (!body.facility_id) return json(400, { error: 'facility_id required' });
          const name = `${first} ${last}`;
          const slug = `${slugPart(first)}.${slugPart(last)}`;
          if (slug === '.') return json(400, { error: 'name must contain letters' });
          let email = `${slug}@tbscreen.ph`;
          const password = tempPassword();
          for (let n = 2; n < 50; n++) {
            const { data: created, error: createErr } = await admin.auth.admin.createUser({
              email,
              password,
              email_confirm: true,
            });
            if (!createErr && created?.user) {
              const { error: rowErr } = await admin.from('users').insert({
                user_id: created.user.id,
                role: 'tb_dots',
                full_name: name,
                facility_id: body.facility_id,
                assigned_barangay_code: null,
              });
              if (rowErr) {
                await admin.auth.admin.deleteUser(created.user.id);
                return json(500, { error: rowErr.message });
              }
              return json(200, { email, temp_password: password });
            }
            email = `${slug}.${n}@tbscreen.ph`;
          }
          return json(409, { error: 'could not allocate a unique email' });
        }

        // Scope: captains always create into their own barangay/facility;
        // admins say which barangay the new captain gets.
        const barangay = isAdmin ? body.barangay_code : caller.assigned_barangay_code;
        if (!barangay) return json(400, { error: 'barangay_code required' });
        let facility = isAdmin ? body.facility_id : caller.facility_id;
        if (isAdmin && !facility) {
          // Derive from the barangay's LGU: its nearest DOTS center (0009).
          const { data: mapped, error: mapErr } = await admin
            .from('ref_barangays')
            .select('ref_cities(default_facility_id)')
            .eq('barangay_code', barangay)
            .maybeSingle();
          if (mapErr) return json(500, { error: mapErr.message });
          facility =
            (mapped as { ref_cities: { default_facility_id: string | null } | null } | null)
              ?.ref_cities?.default_facility_id ?? undefined;
        }
        if (!facility) {
          return json(400, {
            error: 'no default facility mapped for this barangay (apply migration 0009)',
          });
        }
        const name = `${first} ${last}`;
        // Unique email: firstname.lastname@tbscreen.ph, then .2, .3, … on clash.
        const slug = `${slugPart(first)}.${slugPart(last)}`;
        if (slug === '.') return json(400, { error: 'name must contain letters' });
        let email = `${slug}@tbscreen.ph`;
        const password = tempPassword();
        for (let n = 2; n < 50; n++) {
          const { data: created, error: createErr } = await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
          });
          if (!createErr && created?.user) {
            const { error: rowErr } = await admin.from('users').insert({
              user_id: created.user.id,
              role: managedRole,
              full_name: name,
              facility_id: facility,
              assigned_barangay_code: barangay,
            });
            if (rowErr) {
              // Roll back the orphan auth account so a retry can reuse the email.
              await admin.auth.admin.deleteUser(created.user.id);
              return json(500, { error: rowErr.message });
            }
            return json(200, { email, temp_password: password });
          }
          // email already taken → try the next suffix
          email = `${slug}.${n}@tbscreen.ph`;
        }
        return json(409, { error: 'could not allocate a unique email' });
      }

      case 'update': {
        if (!body.user_id) return json(400, { error: 'user_id required' });
        const target = await loadTarget(body.user_id);
        if (!target) return notFound();
        const fields: Record<string, unknown> = {};
        const first = (body.first_name ?? '').trim();
        const last = (body.last_name ?? '').trim();
        if (first && last) fields.full_name = `${first} ${last}`;
        // Only admins may move an account between barangays; a captain's BHWs
        // stay in the captain's barangay by definition.
        if (isAdmin && managedRole !== 'tb_dots' && body.barangay_code) {
          fields.assigned_barangay_code = body.barangay_code;
        }
        // Staff can be moved between facilities.
        if (isAdmin && managedRole === 'tb_dots' && body.facility_id) {
          fields.facility_id = body.facility_id;
        }
        if (Object.keys(fields).length === 0) return json(400, { error: 'nothing to update' });
        const { error } = await admin.from('users').update(fields).eq('user_id', target.user_id);
        if (error) return json(500, { error: error.message });
        return json(200, { ok: true });
      }

      case 'reset_password': {
        if (!body.user_id) return json(400, { error: 'user_id required' });
        const target = await loadTarget(body.user_id);
        if (!target) return notFound();
        const password = tempPassword();
        const { data: authUser, error: pwErr } = await admin.auth.admin.updateUserById(
          target.user_id,
          { password },
        );
        if (pwErr) return json(500, { error: pwErr.message });
        return json(200, { email: authUser?.user?.email ?? null, temp_password: password });
      }

      case 'deactivate':
      case 'reactivate': {
        if (!body.user_id) return json(400, { error: 'user_id required' });
        const target = await loadTarget(body.user_id);
        if (!target) return notFound();
        const activate = body.action === 'reactivate';
        // Auth ban is what actually blocks sign-in; users.active drives the UI.
        const { error: banErr } = await admin.auth.admin.updateUserById(target.user_id, {
          ban_duration: activate ? 'none' : '87600h', // ~10 years
        });
        if (banErr) return json(500, { error: banErr.message });
        const { error } = await admin
          .from('users')
          .update({ active: activate })
          .eq('user_id', target.user_id);
        if (error) return json(500, { error: error.message });
        return json(200, { ok: true });
      }

      default:
        return json(400, { error: `unknown action` });
    }
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
