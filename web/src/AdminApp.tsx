/**
 * Developer portal (admin.html) — deliberately SEPARATE from the facility
 * portal: its own login, its own top bar, and only the provisioning views
 * (Captain management / Staff management). Any signed-in account whose users
 * row is not role 'admin' is shown a polite refusal with a link back to the
 * facility portal. Admins have no patient-data policies at all — nothing
 * clinical can render here even by accident.
 */
import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './lib/supabase';
import { PortalUser } from './lib/types';
import { AppLanguage, changeLanguage, SUPPORTED_LANGUAGES } from './i18n';
import CaptainManagement from './components/CaptainManagement';
import StaffManagement from './components/StaffManagement';

type Page = 'captains' | 'staff';

export default function AdminApp() {
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [me, setMe] = useState<PortalUser | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [page, setPage] = useState<Page>('captains');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setMe(null);
      setMeLoaded(false);
      return;
    }
    void supabase
      .from('users')
      .select('user_id, role, full_name, facility_id, active')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setMe((data ?? null) as PortalUser | null);
        setMeLoaded(true);
      });
  }, [session]);

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setLoginError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setLoginError(error.message);
    setBusy(false);
  };

  const isAdmin = me?.role === 'admin';

  return (
    <>
      <header className="topbar">
        <h1>{t('admin.portalTitle')}</h1>
        {session && isAdmin ? (
          <nav className="tabs">
            <button
              className={page === 'captains' ? '' : 'secondary'}
              onClick={() => setPage('captains')}
            >
              {t('nav.captains')}
            </button>
            <button
              className={page === 'staff' ? '' : 'secondary'}
              onClick={() => setPage('staff')}
            >
              {t('nav.staff')}
            </button>
          </nav>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            value={i18n.language}
            onChange={(e) => changeLanguage(e.target.value as AppLanguage)}
            aria-label="Language"
          >
            {SUPPORTED_LANGUAGES.map((lng) => (
              <option key={lng} value={lng}>
                {t(`languages.${lng}`)}
              </option>
            ))}
          </select>
          {session ? (
            <>
              <span className="who">{me?.full_name ?? session.user.email}</span>
              <button className="secondary" onClick={() => void supabase.auth.signOut()}>
                {t('common.signOut')}
              </button>
            </>
          ) : null}
        </div>
      </header>

      <main>
        {!sessionLoaded ? (
          <p style={{ textAlign: 'center' }}>{t('common.loading')}</p>
        ) : !session ? (
          <div className="card login">
            <div className="loginhead">
              <span className="mark msym">terminal</span>
              <div>
                <h2>{t('admin.portalTitle')}</h2>
                <div className="sub">{t('admin.sub')}</div>
              </div>
            </div>
            <form onSubmit={(e) => void signIn(e)}>
              <label htmlFor="adm-email">{t('login.email')}</label>
              <input
                id="adm-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
              <label htmlFor="adm-password">{t('login.password')}</label>
              <input
                id="adm-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              {loginError ? (
                <p className="error">{t('login.error', { message: loginError })}</p>
              ) : null}
              <button type="submit" disabled={busy}>
                {t('login.cta')}
              </button>
            </form>
          </div>
        ) : !meLoaded ? (
          <p style={{ textAlign: 'center' }}>{t('common.loading')}</p>
        ) : !isAdmin ? (
          <div className="card centered" style={{ maxWidth: 420, textAlign: 'center' }}>
            <p>{t('admin.notAdmin')}</p>
            <p>
              <a href="/">{t('admin.goMain')}</a>
            </p>
          </div>
        ) : page === 'staff' ? (
          <StaffManagement />
        ) : (
          <CaptainManagement />
        )}
      </main>

      <div className="footnote" style={{ textAlign: 'center' }}>
        {t('admin.footnote')}
      </div>
    </>
  );
}
