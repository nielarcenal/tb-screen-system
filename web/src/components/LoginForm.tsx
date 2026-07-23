/**
 * Portal sign-in (design 1b): app mark + "TB-Screen Portal / TB-DOTS facility
 * staff" header, the staff/captain role toggle, email + password, pill CTA.
 * The toggle mirrors the design; the account's users row is what actually
 * decides which portal opens after sign-in (a captain lands on BHW management
 * regardless of the pill picked here). Accounts are provisioned by the admin
 * (see supabase/seed.sql) — there is deliberately no self-registration.
 */
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';

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
    <div className="card login">
      <div className="loginhead">
        <span className="mark msym">health_and_safety</span>
        <div>
          <h2>{t('common.appName')}</h2>
          <div className="sub">{t('login.sub')}</div>
        </div>
      </div>

      <div className="rolepair">
        <button
          type="button"
          className={role === 'staff' ? '' : 'secondary'}
          onClick={() => setRole('staff')}
        >
          {t('login.roleStaff')}
        </button>
        <button
          type="button"
          className={role === 'captain' ? '' : 'secondary'}
          onClick={() => setRole('captain')}
        >
          {t('login.roleCaptain')}
        </button>
      </div>

      <form onSubmit={(e) => void submit(e)}>
        <label htmlFor="email">{t('login.email')}</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={role === 'captain' ? 'captain@barangay.ph' : 'staff@rhu.ph'}
          autoComplete="username"
          required
        />
        <label htmlFor="password">{t('login.password')}</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
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
