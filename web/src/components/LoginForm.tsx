/**
 * Facility portal sign-in (redesign §4): the two-panel brand + form shell with
 * the staff/captain role toggle and a pill CTA that shows a spinner while
 * signing in. The toggle mirrors the design; the account's users row is what
 * actually decides which portal opens after sign-in (a captain lands on their
 * dashboard regardless of the pill picked here). Accounts are provisioned by
 * the admin (see supabase/seed.sql) — there is deliberately no self-registration.
 */
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import LoginLayout from './LoginLayout';
import PasswordField from './PasswordField';

export default function LoginForm() {
  const { t } = useTranslation();
  const [role, setRole] = useState<'staff' | 'captain'>('staff');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message);
    setBusy(false); // on success the auth listener in App swaps the view
  };

  return (
    <LoginLayout>
      <div className="login-head">
        <h2>{t('login.signinTitle')}</h2>
        <p>{t('login.signinSub')}</p>
      </div>

      <div className="login-roles" role="group" aria-label={t('login.sub')}>
        <button
          type="button"
          className={role === 'staff' ? 'on' : ''}
          aria-pressed={role === 'staff'}
          onClick={() => setRole('staff')}
        >
          {t('login.roleStaff')}
        </button>
        <button
          type="button"
          className={role === 'captain' ? 'on' : ''}
          aria-pressed={role === 'captain'}
          onClick={() => setRole('captain')}
        >
          {t('login.roleCaptain')}
        </button>
      </div>

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
    </LoginLayout>
  );
}
