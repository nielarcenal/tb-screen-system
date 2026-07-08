/**
 * Portal shell (design 1b): white top bar carrying the app mark, facility
 * label, pill tabs, and the account chip. Role comes from the signed-in
 * account's own users row (users_read_same_facility policy):
 *   tb_dots  → Dashboard / Referral inbox / Barangay hotspots
 *   captain  → BHW management only (no patient data policies exist for them)
 * The inbox renders master-detail: list on the left, detail panel on the
 * right. Deliberately no router library — a handful of views and one id of
 * state (§2).
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
import CaptainManagement from './components/CaptainManagement';

type Page = 'dashboard' | 'inbox' | 'hotspot' | 'bhw' | 'captains';

/** Up to two initials for the account chip. */
function initials(name: string | null | undefined): string {
  if (!name) return '·';
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [me, setMe] = useState<PortalUser | null>(null);
  const [facilityName, setFacilityName] = useState<string | null>(null);
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

  // Load the account's own users row — its role decides which portal shows —
  // and the facility name for the top-bar label.
  useEffect(() => {
    if (!session) {
      setMe(null);
      setFacilityName(null);
      return;
    }
    void supabase
      .from('users')
      .select('user_id, role, full_name, facility_id, active')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(async ({ data }) => {
        const user = (data ?? null) as PortalUser | null;
        setMe(user);
        setPage(
          user?.role === 'captain' ? 'bhw' : user?.role === 'admin' ? 'captains' : 'dashboard',
        );
        if (user) {
          const { data: fac } = await supabase
            .from('facilities')
            .select('name')
            .eq('facility_id', user.facility_id)
            .maybeSingle();
          setFacilityName((fac as { name: string } | null)?.name ?? null);
        }
      });
  }, [session]);

  const isCaptain = me?.role === 'captain';
  const isAdmin = me?.role === 'admin';

  const tab = (key: Page, label: string) => (
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
        <h1>
          {t('common.appName')}
          {facilityName ? <span className="org">{facilityName}</span> : null}
        </h1>

        {session && me ? (
          <nav className="tabs">
            {isAdmin ? (
              tab('captains', t('nav.captains'))
            ) : isCaptain ? (
              tab('bhw', t('nav.bhw'))
            ) : (
              <>
                {tab('dashboard', t('nav.dashboard'))}
                {tab('inbox', t('nav.inbox'))}
                {tab('hotspot', t('nav.hotspot'))}
              </>
            )}
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
              <span className="avatar">{initials(me?.full_name ?? session.user.email)}</span>
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
        ) : isAdmin ? (
          <CaptainManagement />
        ) : isCaptain ? (
          <BhwManagement />
        ) : page === 'dashboard' ? (
          <Dashboard />
        ) : page === 'hotspot' ? (
          <HotspotView />
        ) : (
          /* Inbox: master-detail split (design 1b). */
          <div className="split">
            <div className="master">
              <ReferralInbox onOpen={setOpenReferralId} selectedId={openReferralId} />
            </div>
            <div className="detailpanel">
              {openReferralId ? (
                <ReferralDetail
                  referralId={openReferralId}
                  onBack={() => setOpenReferralId(null)}
                />
              ) : (
                <div className="placeholder">{t('inbox.selectPrompt')}</div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Standing positioning note (§1). */}
      <div className="footnote">{t('common.nonDiagnostic')}</div>
    </>
  );
}
