-- ============================================================================
-- TB-Screen — 0019_password_change_gate.sql
-- D-06: make users.must_change_password actually do something.
--
-- 0014 added the column and documented its intent ("drives the forced-change
-- flow on the sign-in surfaces"). manage-bhw has set it true ever since — on
-- account creation and on reset_password — but NOTHING has ever read it. Every
-- provisioned account therefore keeps the TBS-####-abcd temp password forever,
-- and the captain or admin who provisioned it knows that password, so they can
-- sign in as that BHW indefinitely. The clients now gate on the flag; this
-- migration gives them the one thing they cannot otherwise do — clear it.
--
-- WHY A FUNCTION AND NOT A COLUMN GRANT: 0017 (D-01) revoked UPDATE on
-- public.users from `authenticated` and granted back exactly one column,
-- assigned_barangay_code, because a broad update grant was the
-- privilege-escalation hole. Adding must_change_password to that grant would
-- widen the very surface D-01 narrowed, and column grants cannot express "only
-- ever to false". A SECURITY DEFINER function can: it is one statement, it
-- always writes false, and it can only ever touch the caller's own row.
--
-- SCOPE — this is a WORKFLOW GATE, NOT AN ENFORCEMENT BOUNDARY. The database
-- cannot tell whether the caller really changed their password first; the
-- clients call auth.updateUser() and then this function. A user who bypassed
-- the app could clear their own flag without changing anything — but that only
-- skips their OWN prompt, and the account it protects is theirs. What the gate
-- does close is the real finding: a password chosen by somebody else, never
-- retired. Do not describe it as server-enforced (same posture as D-05).
--
-- POSITIONING (§1) unchanged: account plumbing only — no patient data, nothing
-- computed, scored or diagnostic.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- clear_password_change_flag()
--
-- SECURITY DEFINER so it runs as the owner and bypasses both the 0017 column
-- grant and RLS. The `where user_id = auth.uid()` IS the entire guard, so it
-- has to be right: for an anonymous caller auth.uid() is null and the update
-- matches no row (null = null is never true), which is the safe outcome.
--
-- `set search_path` is not optional on a SECURITY DEFINER function: without it
-- the caller's search_path decides what `public.users` resolves to, and a
-- caller who can create objects could point it somewhere else.
-- ---------------------------------------------------------------------------
create or replace function public.clear_password_change_flag()
returns void
language sql
security definer
set search_path = public
as $$
  update public.users
     set must_change_password = false
   where user_id = auth.uid();
$$;

comment on function public.clear_password_change_flag() is
  'Clears must_change_password on the CALLING user''s own row, after the client '
  'has changed the account password via auth.updateUser(). SECURITY DEFINER '
  'because 0017 leaves clients no UPDATE grant on this column. A workflow gate, '
  'not an enforcement boundary — the database cannot verify the password '
  'actually changed (D-06).';

-- Functions are executable by PUBLIC by default; take that back and hand it to
-- signed-in callers only. `anon` never needs it — an anonymous caller has no
-- row to clear.
revoke all on function public.clear_password_change_flag() from public;
grant execute on function public.clear_password_change_flag() to authenticated;

-- ---------------------------------------------------------------------------
-- Post-check (run separately — the SQL editor returns only the LAST result):
--
--   select proname, prosecdef, proconfig,
--          pg_get_userbyid(proowner) as owner
--     from pg_proc
--    where proname = 'clear_password_change_flag';
--   -- expect: prosecdef = true, proconfig = {search_path=public}
--
--   select grantee, privilege_type
--     from information_schema.routine_privileges
--    where routine_name = 'clear_password_change_flag';
--   -- expect: authenticated / EXECUTE, and NOT PUBLIC
--
-- No backfill is needed. Every account on the live project currently has
-- must_change_password = false (checked before writing this), so turning the
-- gate on locks nobody out; it starts applying at the next provision or reset.
-- ---------------------------------------------------------------------------
