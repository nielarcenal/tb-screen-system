/**
 * Facility portal shell (redesign §3): navy sidebar + content column via
 * <AppShell>. Role comes from the signed-in account's own users row
 * (users_read_same_facility policy):
 *   tb_dots  → Dashboard / Referrals / Barangay hotspots
 *   captain  → BHW management only (no patient data policies exist for them)
 * The inbox renders master-detail: list on the left, detail panel on the right.
 * Deliberately no router library — a handful of views and one id of state (§2).
 * Admin accounts are redirected to the separate developer portal (admin.html).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './lib/supabase';
import { PortalUser } from './lib/types';
import AppShell, { ShellNavItem } from './components/AppShell';
import LangToggle from './components/LangToggle';
import LoginForm from './components/LoginForm';
import Dashboard from './components/Dashboard';
import ReferralInbox from './components/ReferralInbox';
import ReferralDetail from './components/ReferralDetail';
import HotspotView from './components/HotspotView';
import BhwManagement from './components/BhwManagement';

type Page = 'dashboard' | 'inbox' | 'hotspot' | 'bhw';

export default function App() {
  const { t } = useTranslation();
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
  // and the facility name for the sidebar context.
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
        // Admin accounts live in the separate developer portal.
        if (user?.role === 'admin') {
          window.location.replace('/admin.html');
          return;
        }
        setMe(user);
        setPage(user?.role === 'captain' ? 'bhw' : 'dashboard');
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

  // Not signed in: the sidebar shell is hidden; show the login with the
  // language toggle still reachable. (Login redesign proper is §4.)
  if (!sessionLoaded) {
    return <p style={{ padding: 24, textAlign: 'center' }}>{t('common.loading')}</p>;
  }
  if (!session) {
    return (
      <div className="loginpage">
        <div className="loginpage-top">
          <LangToggle />
        </div>
        <LoginForm />
      </div>
    );
  }
  if (!me) {
    return <p style={{ padding: 24, textAlign: 'center' }}>{t('common.loading')}</p>;
  }

  const isCaptain = me.role === 'captain';

  const openPage = (key: Page) => {
    setPage(key);
    setOpenReferralId(null);
  };

  const navItem = (key: Page, icon: string, label: string): ShellNavItem => ({
    key,
    icon,
    label,
    active: page === key,
    onClick: () => openPage(key),
  });

  const nav: ShellNavItem[] = isCaptain
    ? [navItem('bhw', 'groups', t('nav.bhw'))]
    : [
        navItem('dashboard', 'space_dashboard', t('nav.dashboard')),
        navItem('inbox', 'move_to_inbox', t('nav.inbox')),
        navItem('hotspot', 'map', t('nav.hotspot')),
      ];

  const headers: Record<Page, { title: string; sub: string }> = {
    dashboard: { title: t('nav.dashboard'), sub: t('shell.dashboardSub') },
    inbox: { title: t('nav.inbox'), sub: t('shell.referralsSub') },
    hotspot: { title: t('nav.hotspot'), sub: t('shell.hotspotsSub') },
    bhw: { title: t('nav.bhw'), sub: t('shell.bhwSub') },
  };

  return (
    <AppShell
      portalLabel={isCaptain ? t('shell.captainPortal') : t('shell.facilityPortal')}
      nav={nav}
      facility={!isCaptain && facilityName ? { name: facilityName } : null}
      user={{
        name: me.full_name ?? session.user.email ?? '',
        roleLabel: isCaptain ? t('login.roleCaptain') : t('login.roleStaff'),
      }}
      headerTitle={headers[page].title}
      headerSub={headers[page].sub}
    >
      {isCaptain ? (
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
              <ReferralDetail referralId={openReferralId} onBack={() => setOpenReferralId(null)} />
            ) : (
              <div className="rd-empty">
                <div className="badge">
                  <span className="msym" aria-hidden="true">
                    move_to_inbox
                  </span>
                </div>
                <div className="rd-emptytitle">{t('detail.selectTitle')}</div>
                <div className="rd-emptybody">{t('detail.selectBody')}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
