/**
 * manage-bhw — Supabase Edge Function (design-parity batch, 2026-07-07).
 *
 * Barangay-Captain account management: creating, editing, deactivating and
 * reactivating BHW accounts requires the auth admin API (service role), which
 * must never reach the browser — so the portal calls this function instead.
 *
 * Auth: the caller's JWT is verified against public.users — role must be
 * 'captain' and the account active. Every action is scoped to the captain's
 * own facility_id (the captain can only manage BHWs of their facility).
 *
 * Actions (POST JSON { action, ... }):
 *   create     { full_name, barangay_code }
 *                → creates the auth user (auto email firstname.lastname.N@tbscreen.ph,
 *                  temp password), inserts the users row (role bhw, captain's
 *                  facility), returns { email, temp_password }.
 *   update     { user_id, full_name, barangay_code }
 *   deactivate { user_id }  → users.active=false + auth ban (blocks sign-in).
 *   reactivate { user_id }  → users.active=true  + ban lifted.
 *
 * PRIVACY: this function reads/writes ONLY facilities/users/auth — no patient
 * data ever passes through it. Captains have no patient policies at all.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

interface Body {
  action: 'create' | 'update' | 'deactivate' | 'reactivate';
  user_id?: string;
  full_name?: string;
  barangay_code?: string;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** firstname.lastname slug, ASCII letters only (mirrors the design's format). */
function emailSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/)
    .join('.');
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
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, // service role: server-side only
  );

  // --- caller must be an ACTIVE captain; scope = their facility ---
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: caller, error: authErr } = await admin.auth.getUser(jwt);
  if (authErr || !caller?.user) return json(401, { error: 'unauthorized' });

  const { data: captain, error: capErr } = await admin
    .from('users')
    .select('role, facility_id, active')
    .eq('user_id', caller.user.id)
    .maybeSingle();
  if (capErr) return json(500, { error: capErr.message });
  if (!captain || captain.role !== 'captain' || !captain.active) {
    return json(403, { error: 'captain role required' });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(400, { error: 'invalid JSON body' });
  }

  // --- helper: load a target BHW and verify facility scope ---
  const loadTarget = async (userId: string) => {
    const { data: target, error } = await admin
      .from('users')
      .select('user_id, role, facility_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!target || target.role !== 'bhw' || target.facility_id !== captain.facility_id) {
      return null; // not found / not a BHW / not this captain's facility
    }
    return target;
  };

  try {
    switch (body.action) {
      case 'create': {
        const name = (body.full_name ?? '').trim();
        if (!name || !body.barangay_code) {
          return json(400, { error: 'full_name and barangay_code required' });
        }
        // Unique email: firstname.lastname@tbscreen.ph, then .2, .3, … on clash.
        const slug = emailSlug(name);
        if (!slug) return json(400, { error: 'name must contain letters' });
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
              role: 'bhw',
              full_name: name,
              facility_id: captain.facility_id,
              assigned_barangay_code: body.barangay_code,
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
        if (!target) return json(404, { error: 'BHW not found in your facility' });
        const fields: Record<string, unknown> = {};
        if (body.full_name?.trim()) fields.full_name = body.full_name.trim();
        if (body.barangay_code) fields.assigned_barangay_code = body.barangay_code;
        if (Object.keys(fields).length === 0) return json(400, { error: 'nothing to update' });
        const { error } = await admin.from('users').update(fields).eq('user_id', target.user_id);
        if (error) return json(500, { error: error.message });
        return json(200, { ok: true });
      }

      case 'deactivate':
      case 'reactivate': {
        if (!body.user_id) return json(400, { error: 'user_id required' });
        const target = await loadTarget(body.user_id);
        if (!target) return json(404, { error: 'BHW not found in your facility' });
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
