/**
 * Facility portal sign-in (redesign §4): the two-panel brand + form shell with
 * the staff/midwife role toggle and a pill CTA that shows a spinner while
 * signing in. Accounts are provisioned by the admin (see supabase/seed.sql) —
 * there is deliberately no self-registration.
 *
 * WHAT THE ROLE TOGGLE DOES, and what it must never do (D-11): it selects the
 * explanatory note under the pills, and nothing else. Sign-in stays entirely
 * role-agnostic — `signInWithPassword` is given an email and a password, and
 * the account's own users row decides which portal opens, so a midwife who
 * picked "TB-DOTS staff" still lands on the midwife dashboard.
 *
 * That is deliberate. Gating sign-in on the pill would refuse correct
 * credentials over a cosmetic mis-tap, and would also turn the control into a
 * probe telling an anonymous visitor which role an email belongs to. But the
 * pills carry `aria-pressed`, which promises a screen-reader user that they
 * select SOMETHING — so before this fix, when `role` was set and never read,
 * the control was announcing a state that had no effect anywhere. Either the
 * promise or the control had to go; the note is what makes the promise true.
 */
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import LoginLayout from './LoginLayout';
import PasswordField from './PasswordField';

export default function LoginForm() {
  const { t } = useTranslation();
  const [role, setRole] = useState<'staff' | 'midwife'>('staff');
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
          className={role === 'midwife' ? 'on' : ''}
          aria-pressed={role === 'midwife'}
          onClick={() => setRole('midwife')}
        >
          {t('login.roleMidwife')}
        </button>
      </div>

      {/* D-11: the visible effect of the pills. `aria-live` so a screen-reader
          user who toggles hears the note change rather than only the pressed
          state flipping on a control with no consequence. */}
      <p className="login-rolenote" aria-live="polite">
        {t(role === 'staff' ? 'login.noteStaff' : 'login.noteMidwife')}
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
    </LoginLayout>
  );
}
