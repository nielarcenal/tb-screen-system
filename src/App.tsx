/**
 * Portal shell: session gate + role-aware view switching. The role comes from
 * the signed-in account's own users row (users_read_same_facility policy):
 *   tb_dots  → Dashboard / Referral inbox / Barangay hotspots
 *   captain  → BHW management only (no patient data policies exist for them)
 * Deliberately no router library — a handful of views and one id of state (§2).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './lib/supabase';
import { PortalUser } from './lib/types';
import { AppLanguage, changeLanguage, SUPPORTED_LANGUAGES } from './i18n';
import LoginForm from './components/LoginForm';
import Dashboard from './components/Dashboard';
import ReferralInbox from './components/ReferralInbox';
import ReferralDetail from './components/ReferralDetail';
import HotspotView from './components/HotspotView';
import BhwManagement from './components/BhwManagement';

type Page = 'dashboard' | 'inbox' | 'hotspot' | 'bhw';

export default function App() {
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [me, setMe] = useState<PortalUser | null>(null);
  const [page, setPage] = useState<Page>('dashboard');
  const [openReferralId, setOpenReferralId] = useState<string | null>(null);

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

  // Load the account's own users row — its role decides which portal shows.
  useEffect(() => {
    if (!session) {
      setMe(null);
      return;
    }
    void supabase
      .from('users')
      .select('user_id, role, full_name, facility_id, active')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        const user = (data ?? null) as PortalUser | null;
        setMe(user);
        setPage(user?.role === 'captain' ? 'bhw' : 'dashboard');
      });
  }, [session]);

  const isCaptain = me?.role === 'captain';

  const staffTab = (key: Page, label: string) => (
    <button
      className={page === key ? '' : 'secondary'}
      onClick={() => {
        setPage(key);
        setOpenReferralId(null);
      }}
    >
      {label}
    </button>
  );

  return (
    <>
      <header className="topbar">
        <h1>{t('common.appName')}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
          <p>{t('common.loading')}</p>
        ) : !session ? (
          <LoginForm />
        ) : (
          <>
            <nav className="tabs">
              {isCaptain ? (
                staffTab('bhw', t('nav.bhw'))
              ) : (
                <>
                  {staffTab('dashboard', t('nav.dashboard'))}
                  {staffTab('inbox', t('nav.inbox'))}
                  {staffTab('hotspot', t('nav.hotspot'))}
                </>
              )}
            </nav>
            {isCaptain ? (
              <BhwManagement />
            ) : page === 'dashboard' ? (
              <Dashboard />
            ) : page === 'hotspot' ? (
              <HotspotView />
            ) : openReferralId ? (
              <ReferralDetail
                referralId={openReferralId}
                onBack={() => setOpenReferralId(null)}
              />
            ) : (
              <ReferralInbox onOpen={setOpenReferralId} />
            )}
          </>
        )}
      </main>

      {/* Standing positioning note (§1). */}
      <div className="footnote">{t('common.nonDiagnostic')}</div>
    </>
  );
}
