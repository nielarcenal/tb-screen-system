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
import LoginLayout from './components/LoginLayout';
import AdminDashboard from './components/AdminDashboard';
import BhwManagement from './components/BhwManagement';
import CaptainManagement from './components/CaptainManagement';
import FacilityManagement from './components/FacilityManagement';
import StaffManagement from './components/StaffManagement';
import PasswordField from './components/PasswordField';
import ChangePasswordGate from './components/ChangePasswordGate';

type Page = 'dashboard' | 'captains' | 'bhws' | 'facilities' | 'staff';

export default function AdminApp() {
  const { t } = useTranslation();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [me, setMe] = useState<PortalUser | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [page, setPage] = useState<Page>('dashboard');
  // Bumped when the password gate finishes, to re-read the users row.
  const [meVersion, setMeVersion] = useState(0);

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
      .select('user_id, role, full_name, facility_id, active, must_change_password')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setMe((data ?? null) as PortalUser | null);
        setMeLoaded(true);
      });
  }, [session, meVersion]);

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
      <LoginLayout>
        <div className="login-head">
          <h2>{t('login.signinTitle')}</h2>
          <p>{t('admin.sub')}</p>
        </div>

        {loginError ? (
          <div className="login-err">
            <span className="msym" aria-hidden="true">
              error
            </span>
            <span>{t('login.error', { message: loginError })}</span>
          </div>
        ) : null}

        <form className="login-form" onSubmit={(e) => void signIn(e)}>
          <label htmlFor="adm-email">
            <span>{t('login.email')}</span>
            <input
              id="adm-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              disabled={busy}
              required
            />
          </label>
          <label htmlFor="adm-password">
            <span>{t('login.password')}</span>
            <PasswordField
              id="adm-password"
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

  if (!meLoaded) {
    return <p style={{ padding: 24, textAlign: 'center' }}>{t('common.loading')}</p>;
  }

  if (me?.role !== 'admin') {
    return (
      <div className="loginpage">
        <div className="loginpage-top">
          <LangToggle />
          {/* scope: 'local' — this browser only; see AppShell. */}
          <button
            className="secondary"
            onClick={() => void supabase.auth.signOut({ scope: 'local' })}
          >
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

  // D-06: an admin account provisioned or reset by another admin is gated the
  // same as everyone else. Checked after the role refusal above so a non-admin
  // still gets the "wrong portal" page rather than a password form.
  if (me.must_change_password) {
    return (
      <ChangePasswordGate
        email={session.user.email ?? null}
        onDone={() => setMeVersion((v) => v + 1)}
      />
    );
  }

  const nav: ShellNavItem[] = [
    {
      key: 'dashboard',
      icon: 'space_dashboard',
      label: t('nav.dashboard'),
      active: page === 'dashboard',
      onClick: () => setPage('dashboard'),
    },
    {
      key: 'captains',
      icon: 'badge',
      label: t('nav.captains'),
      active: page === 'captains',
      onClick: () => setPage('captains'),
    },
    {
      key: 'bhws',
      icon: 'diversity_3',
      label: t('nav.bhws'),
      active: page === 'bhws',
      onClick: () => setPage('bhws'),
    },
    {
      key: 'facilities',
      icon: 'local_hospital',
      label: t('facilities.title'),
      active: page === 'facilities',
      onClick: () => setPage('facilities'),
    },
    {
      key: 'staff',
      icon: 'groups',
      label: t('nav.staff'),
      active: page === 'staff',
      onClick: () => setPage('staff'),
    },
  ];

  const headerTitle =
    page === 'dashboard'
      ? t('nav.dashboard')
      : page === 'facilities'
        ? t('facilities.title')
        : page === 'staff'
          ? t('nav.staff')
          : page === 'bhws'
            ? t('nav.bhws')
            : t('nav.captains');
  const headerSub =
    page === 'dashboard'
      ? t('adminDash.headerSub')
      : page === 'facilities'
        ? t('shell.facilitiesSub')
        : page === 'staff'
          ? t('shell.staffSub')
          : page === 'bhws'
            ? t('shell.bhwsSub')
            : t('shell.captainsSub');

  return (
    <AppShell
      portalLabel={t('shell.adminPortal')}
      nav={nav}
      facility={null}
      user={{
        name: me.full_name ?? session.user.email ?? '',
        roleLabel: t('shell.roleAdmin'),
      }}
      headerTitle={headerTitle}
      headerSub={headerSub}
      footnote={t('admin.footnote')}
    >
      {page === 'dashboard' ? (
        <AdminDashboard />
      ) : page === 'facilities' ? (
        <FacilityManagement />
      ) : page === 'staff' ? (
        <StaffManagement />
      ) : page === 'bhws' ? (
        // Same screen the captain gets, unscoped -- see BhwManagement's header.
        <BhwManagement asAdmin />
      ) : (
        <CaptainManagement />
      )}
    </AppShell>
  );
}
