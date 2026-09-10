# Day 6 — security review of the audit surface

Author: Claude Code. Reviewer: Codex.
**2026-09-10.** Covers migration **0038** and the portal audit viewer. Codex subsequently
strengthened the matrix to 36/36, closed the BHW navigation/cursor/stale-response gaps,
approved the migration, and applied it atomically. See `CODEX_REVIEW.md`.
Scope: what Day 6 adds. It is not Task 6.6, which is Codex's whole-system audit.

---

## 1. What changed, from a security point of view

| Change | Direction |
| --- | --- |
| Appointment writes now emit audit rows on every path, not just the RPC ones | **Adds recorded data** |
| Five RPCs stop writing appointment audit rows themselves | Neutral — the trigger replaces them one for one |
| `facility_audit_events()` — a new read function over `audit_logs` | **Adds a read path** |
| A portal nav item and view for TB-DOTS accounts | Surfaces the read path |
| SMS `sent` relabelled | Display only; no stored value, selection or retry changed |

Two of those are worth real scrutiny: a table that previously received few rows now
receives one per appointment write, and a table that had no client-facing reader now has
one.

---

## 2. The read path

**`facility_audit_events()` is `SECURITY INVOKER`.** It contains no role check and no
facility predicate, deliberately. `audit_logs` carries RLS from 0031 — a TB-DOTS account
sees rows whose `facility_id` is its own, an admin sees all, and no other role has a
policy — and an invoker function inherits exactly that.

This is the strongest available property: the function *cannot* widen the boundary, even
if its own SQL were wrong, because the boundary is not expressed in its SQL. Compare the
alternative that was not taken: a `SECURITY DEFINER` reader restating `facility_id =
current_user_facility()`, which is one careless edit away from M31-03 — the 0031 policy
that was rewritten in passing and let a facility name any patient uuid.

Verified in the matrix, each as its own check:

- `viewer: own facility` — a TB-DOTS account sees its facility's rows.
- `viewer: cross-facility` — and none of the other facility's, **which has rows of its
  own**, so this is isolation rather than an empty table.
- `viewer: bhw denied`, `viewer: midwife denied` — zero rows, from RLS alone.
- `viewer: deactivated account denied` — zero rows. `current_user_active_role()` returns
  null for an inactive account (0028/0029), so BASE-06 does not reappear here.
- `viewer: anon denied` — EXECUTE is granted to `authenticated` only.
- `posture: viewer ACL` — `anon` and `service_role` both revoked **by name**, because
  Supabase's default privileges grant EXECUTE to both (M28-01). `service_role` matters
  more than usual here: it bypasses RLS, so holding this function would turn it into an
  unscoped read of every facility's audit trail.

**The admin question, answered rather than deferred.** The brief says: if an admin view is
considered, prove every exposed key is non-clinical, or ship facility-only and state the
deferral. No admin view is shipped, and the portal adds the nav item for TB-DOTS only.
`audit_logs_admin_read` already exists from 0031 and is untouched — an admin could reach
these rows through PostgREST directly, as they always could. That is the pre-existing
boundary 0035 §4 examined and left in place, and 0038 adds no clinical key to it: the six
appointment keys are a status, three dates and two link uuids.

---

## 3. What the trail can now contain

The trigger emits only the six keys 0031 already approved for appointments. Asserted three
ways, because "no unexpected keys" is the kind of check that passes when a writer emits
nothing at all:

- `keys: nothing outside the whitelist` — no key outside the six.
- `keys: forbidden keys absent` — `patient_id`, `notes`, `contact_number` and
  `result_outcome` asked for **by name**.
- `keys: positive control` — at least four distinct keys were actually seen, so the two
  checks above are not vacuous.

`enforce_audit_changes_whitelist()` is unchanged by this migration and remains fail-closed
after C35-01: an `entity_table` with no arm raises rather than accepting everything.
`verify-0035-whitelist.mjs` still prints 7 OK with its three mutation self-tests catching,
re-run after 0038 as the brief requires.

An appointment row holds no name, no contact number, no clinical note and no result. That
is why this table is safe to audit densely and `referrals` is not — 0035 excludes
`result_outcome` for precisely the opposite reason.

---

## 4. Integrity of the trail itself

- `audit_logs` has **SELECT policies only**; there is no INSERT, UPDATE or DELETE policy
  for any client role. Asserted as `posture: audit_logs is select-only`, which fails on any
  `polcmd` other than `r`.
- `app_private.write_audit()` remains revoked from `public`, `anon`, `authenticated` and
  `service_role`.
- `audit_appointment_change()` is revoked from all four as well
  (`posture: trigger fn not client-callable`), so nothing can forge an event by calling the
  trigger body directly as an ordinary function.
- Both new functions pin `search_path` (`posture:` checks read `proconfig` from the
  catalogue rather than trusting the source).
- A rejected write records nothing: `patch: rejected write logs nothing` performs a
  cross-facility UPDATE that RLS matches to zero rows, and asserts no event appears.

**One event per change, proved in both directions.** This is the migration's central risk —
zero would mean the restatement went too far, two would mean the trigger is stacked on a
surviving call — so every RPC path is counted individually: `record_visit` attendance,
`record_visit` next appointment, closure cancellation, claim, and case assignment. Plus
`multi-row: one event each`, where one statement changing two rows produces two events and
an already-`missed` row that the predicate did not match produces none.

---

## 5. Findings

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| D6-01 | MEDIUM | The trail's volume goes from "RPC writes only" to "every appointment write". At current scale that is small, but nothing prunes `audit_logs` — unlike `rpc_requests`, which 0031 purges on a cron at 7 days. An audit trail should not be purged on the same reflex, but it should have a stated retention decision rather than growing silently forever | **Accepted for the release candidate after review:** no automatic purge. A health-office-approved retention/archive and capacity policy is required before real production use |
| D6-02 | LOW | `facility_audit_events()` returns `patient_id`. The viewer does not render it, but the RPC exposes it to any TB-DOTS caller who reads the raw response. That caller can already read the patient through `patients` RLS if the row is theirs — so this discloses nothing new — but it is a column the UI does not need | **Open.** Left because removing it forecloses linking an event to a patient record later, which is the obvious next feature. Flagged so the choice is explicit |
| D6-03 | LOW | `actor_name` comes from a LEFT JOIN through `users` RLS, so the same event can render a name for one reader and a role for another. That is correct behaviour, not a leak — but it means two staff comparing screens may see different text for one event | Accepted. The viewer falls back to role, then to a system label; tested |
| D6-04 | INFO | A support write from a direct database session records `actor_user_id = null`. The viewer shows "System or support action", which is honest but indistinguishable from an Edge Function write | Accepted. Distinguishing them needs a provenance column and its own migration |
| C41-02 | — | Closed by migration 0038; approved and applied after review | Was open since 0035 |

No CRITICAL or HIGH findings. Nothing in this unit widens a read boundary, weakens a
policy, or adds a write path to `audit_logs`.

---

## 6. What this unit deliberately did not do

- **No delivery callbacks, no retry changes, no new SMS states.** Task 6.5 stays deferred
  per `CODEX_TASK_6.4_SMS_FEASIBILITY.md`. The only change is the `sent` label, in three
  languages; the stored value, the selection query and the retry caps are untouched, so
  idempotency and follow-up behaviour are unchanged.
- **No mobile edits.** The appointment audit contract is entirely server-side — the trigger
  fires on the same PATCH the app already sends — so no client had to change and
  `mobile/AGENTS.md`'s Expo requirement was not engaged. Mobile holds no `sms_log` display,
  so the wording change did not reach it either.
- **No admin audit view.** §2.
- **No retention policy.** D6-01.
