/**
 * Developer portal (admin.html) — deliberately SEPARATE from the facility
 * portal: its own login and only the provisioning views (Captain management /
 * Staff management). Any signed-in account whose users row is not role 'admin'
 * is shown a polite refusal with a link back to the facility portal. Admins
 * have no patient-data policies at all — nothing clinical can render here even
 * by accident, so the shell's standing note is the provisioning note, not the
 * clinical one.
 */
import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './lib/supabase';
import { PortalUser } from './lib/types';
import AppShell, { ShellNavItem } from './components/AppShell';
import LangToggle from './components/LangToggle';
import CaptainManagement from './components/CaptainManagement';
import StaffManagement from './components/StaffManagement';
import PasswordField from './components/PasswordField';

type Page = 'captains' | 'staff';

export default function AdminApp() {
  const { t } = useTranslation();
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

  if (!sessionLoaded) {
    return <p style={{ padding: 24, textAlign: 'center' }}>{t('common.loading')}</p>;
  }

  if (!session) {
    return (
      <div className="loginpage">
        <div className="loginpage-top">
          <LangToggle />
        </div>
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
            <PasswordField
              id="adm-password"
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
      </div>
    );
  }

  if (!meLoaded) {
    return <p style={{ padding: 24, textAlign: 'center' }}>{t('common.loading')}</p>;
  }

  if (me?.role !== 'admin') {
    return (
      <div className="loginpage">
        <div className="loginpage-top">
          <LangToggle />
          <button className="secondary" onClick={() => void supabase.auth.signOut()}>
            {t('common.signOut')}
          </button>
        </div>
        <div className="card centered" style={{ maxWidth: 420, margin: '60px auto', textAlign: 'center' }}>
          <p>{t('admin.notAdmin')}</p>
          <p>
            <a href="/">{t('admin.goMain')}</a>
          </p>
        </div>
      </div>
    );
  }

  const nav: ShellNavItem[] = [
    {
      key: 'captains',
      icon: 'badge',
      label: t('nav.captains'),
      active: page === 'captains',
      onClick: () => setPage('captains'),
    },
    {
      key: 'staff',
      icon: 'groups',
      label: t('nav.staff'),
      active: page === 'staff',
      onClick: () => setPage('staff'),
    },
  ];

  return (
    <AppShell
      portalLabel={t('shell.adminPortal')}
      nav={nav}
      facility={null}
      user={{
        name: me.full_name ?? session.user.email ?? '',
        roleLabel: t('shell.roleAdmin'),
      }}
      headerTitle={page === 'staff' ? t('nav.staff') : t('nav.captains')}
      headerSub={page === 'staff' ? t('shell.staffSub') : t('shell.captainsSub')}
      footnote={t('admin.footnote')}
    >
      {page === 'staff' ? <StaffManagement /> : <CaptainManagement />}
    </AppShell>
  );
}
