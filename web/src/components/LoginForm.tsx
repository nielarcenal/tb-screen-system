/**
 * Sign-in for the two clinical portals (redesign §4): the two-panel brand +
 * form shell, named for whichever portal is being entered. Accounts are
 * provisioned by the admin (see supabase/seed.sql) — there is deliberately no
 * self-registration.
 *
 * WHY THERE IS NO LONGER A ROLE TOGGLE (was D-11). One page used to serve both
 * clinical roles, with a staff/midwife pill pair whose only job was to swap the
 * explanatory note underneath. Facility and midwife now have their own pages
 * (index.html and midwife.html), so the page itself says which role it is for
 * and the pills have nothing left to select. The note they used to switch is
 * now simply the note for this portal.
 *
 * WHAT HAS NOT CHANGED, and must not: sign-in stays entirely role-agnostic.
 * `signInWithPassword` is given an email and a password — never `portal` — and
 * the account's own users row decides where it lands, so a midwife who opens
 * the facility page still signs in successfully and is then redirected to the
 * midwife portal. The reasons are the same two that killed the toggle's
 * ambitions in D-11:
 *
 *   1. Refusing correct credentials because someone opened the wrong bookmark
 *      is a worse failure than sending them to the right page.
 *   2. A login that accepted one role and rejected another would answer, for
 *      any anonymous visitor, the question "which role does this email hold?".
 *      Sign-in must not be a role probe.
 *
 * So `portal` chooses the words on this page and nothing else. The redirect
 * happens after authentication, in App, where the role is actually known.
 */
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import LoginLayout from './LoginLayout';
import PasswordField from './PasswordField';

export type PortalKind = 'facility' | 'midwife';

export default function LoginForm({ portal }: { portal: PortalKind }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isMidwife = portal === 'midwife';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Credentials only — see the header. `portal` is deliberately absent here.
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message);
    setBusy(false); // on success the auth listener in App swaps the view
  };

  return (
    <LoginLayout>
      <div className="login-head">
        <h2>{t('login.signinTitle')}</h2>
        <p>{isMidwife ? t('shell.midwifePortal') : t('shell.facilityPortal')}</p>
      </div>

      <p className="login-rolenote">
        {t(isMidwife ? 'login.noteMidwife' : 'login.noteStaff')}
      </p>

      {error ? (
        <div className="login-err">
          <span className="msym" aria-hidden="true">
            error
          </span>
          <span>{t('login.error', { message: error })}</span>
        </div>
      ) : null}

      <form className="login-form" onSubmit={(e) => void submit(e)}>
        <label htmlFor="email">
          <span>{t('login.email')}</span>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            disabled={busy}
            required
          />
        </label>
        <label htmlFor="password">
          <span>{t('login.password')}</span>
          <PasswordField
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={busy}
            required
          />
        </label>
        <button type="submit" className="login-cta" disabled={busy}>
          {busy ? <span className="login-spinner" aria-hidden="true" /> : null}
          <span>{t('login.cta')}</span>
        </button>
      </form>

      {/* The other clinical portal, for anyone who opened the wrong bookmark.
          Signing in here would also work — this just saves the redirect. */}
      <p className="login-otherportal">
        <a href={isMidwife ? '/' : '/midwife.html'}>
          {isMidwife ? t('login.goFacility') : t('login.goMidwife')}
        </a>
      </p>
    </LoginLayout>
  );
}
