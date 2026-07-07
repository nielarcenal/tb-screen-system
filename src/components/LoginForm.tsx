/**
 * Email/password sign-in for TB-DOTS staff. Accounts are provisioned by the
 * admin (see supabase/seed.sql) — there is deliberately no self-registration.
 */
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';

export default function LoginForm() {
  const { t } = useTranslation();
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
    <div className="card login">
      <div className="loginhead">
        <span className="mark">+</span>
        <div>
          <h2>{t('login.title')}</h2>
          <div className="sub">{t('login.intro')}</div>
        </div>
      </div>
      <form onSubmit={(e) => void submit(e)}>
        <label htmlFor="email">{t('login.email')}</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />
        <label htmlFor="password">{t('login.password')}</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error ? <p className="error">{t('login.error', { message: error })}</p> : null}
        <button type="submit" disabled={busy}>
          {t('login.cta')}
        </button>
      </form>
    </div>
  );
}
