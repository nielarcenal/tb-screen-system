/**
 * Portal account-state gate (D-12) — what shows instead of the portal when the
 * signed-in session cannot be turned into a usable account.
 *
 * WHY IT EXISTS: App.tsx used to render a bare `common.loading` paragraph
 * whenever `me` was null, and `me` is null for three quite different reasons:
 * the users row is still loading, the lookup FAILED, or there is no row to
 * find. The last two never resolve, so the portal sat on "Loading…" forever
 * with no control on screen — not even a sign-out — and the only way out was
 * clearing site data. A dead end reached by a network blip is a support call.
 *
 * THE THREE TERMINAL STATES, and why they are not one:
 *   error    — the request itself failed (offline, 5xx, RLS refusing). Nothing
 *              is known about the account, so this is RETRYABLE and says so.
 *   missing  — the request succeeded and returned no row. The session is real
 *              but no users row backs it; retrying cannot invent one, so the
 *              only exit is signing out. Provisioning is the actual fix.
 *   inactive — the row says `active = false`. This is the portal's half of the
 *              mobile access gate (D-07): the app checks role and active on
 *              the phone, the portal never read `active` at all even though it
 *              was already being selected.
 *
 * WHAT THIS IS NOT: enforcement. Every one of these states is a client-side
 * courtesy — RLS is what actually stops a deactivated account reading rows.
 * Deactivation through the portal also bans the auth user, so a fresh sign-in
 * is refused by Supabase before this component is ever reached; `inactive` is
 * for the session that was ALREADY open when the row flipped.
 *
 * It reuses LoginLayout for the same reason ChangePasswordGate does: a blocked
 * account should land on the brand panel and language pills it just signed in
 * through, not a bare sentence on white.
 */
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import LoginLayout from './LoginLayout';

export type AccountState = 'error' | 'missing' | 'inactive';

/** Icon + message keys per state. Spelled out rather than composed from the
 *  state name, so every key in this file can be grepped in the locale bundles. */
const COPY: Record<AccountState, { icon: string; title: string; body: string }> = {
  error: { icon: 'cloud_off', title: 'account.errorTitle', body: 'account.errorBody' },
  missing: { icon: 'person_off', title: 'account.missingTitle', body: 'account.missingBody' },
  inactive: { icon: 'lock', title: 'account.inactiveTitle', body: 'account.inactiveBody' },
};

interface Props {
  state: AccountState;
  /** Supplied only for `error` — the other two states cannot be retried. */
  onRetry?: () => void;
  /** The signed-in email, so the user can see which account is stuck. */
  email: string | null;
}

export default function AccountStateGate({ state, onRetry, email }: Props) {
  const { t } = useTranslation();
  const copy = COPY[state];

  return (
    <LoginLayout>
      <div className="dstate">
        <div className="badge">
          <span className="msym" aria-hidden="true">
            {copy.icon}
          </span>
        </div>
        <div className="st-title">{t(copy.title)}</div>
        <div className="st-body">{t(copy.body)}</div>
        {email ? <div className="st-who">{email}</div> : null}

        {state === 'error' && onRetry ? (
          <button className="retry" onClick={onRetry}>
            <span className="msym" aria-hidden="true">
              refresh
            </span>
            {t('common.refresh')}
          </button>
        ) : null}

        {/* Always present. This control is the whole point of the component:
            every terminal state must offer a way back to the sign-in screen.
            scope:'local' matches AppShell — it clears this browser only. */}
        <button
          className="altaction"
          onClick={() => void supabase.auth.signOut({ scope: 'local' })}
        >
          <span className="msym" aria-hidden="true">
            logout
          </span>
          {t('common.signOut')}
        </button>
      </div>
    </LoginLayout>
  );
}
