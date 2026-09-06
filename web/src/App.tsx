/**
 * Facility portal shell (redesign §3): navy sidebar + content column via
 * <AppShell>. Role comes from the signed-in account's own users row
 * (users_read_same_facility policy):
 *   tb_dots  → Dashboard / Referrals / Register patient / Barangay hotspots
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
import LoginForm from './components/LoginForm';
import Dashboard from './components/Dashboard';
import CaptainDashboard from './components/CaptainDashboard';
import ReferralInbox from './components/ReferralInbox';
import ReferralDetail from './components/ReferralDetail';
import HotspotView from './components/HotspotView';
import RegisterPatient from './components/RegisterPatient';
import BhwManagement from './components/BhwManagement';
import ChangePasswordGate from './components/ChangePasswordGate';
import AccountStateGate, { AccountState } from './components/AccountStateGate';

type Page = 'dashboard' | 'inbox' | 'register' | 'hotspot' | 'bhw';

export default function App() {
  const { t } = useTranslation();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [me, setMe] = useState<PortalUser | null>(null);
  const [facilityName, setFacilityName] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('dashboard');
  const [openReferralId, setOpenReferralId] = useState<string | null>(null);
  // Bumped when the password gate finishes, to re-read the users row (and with
  // it the now-cleared must_change_password) without disturbing the session.
  const [meVersion, setMeVersion] = useState(0);
  // D-12: why `me` is null. 'loading' is the only state that may render a
  // spinner; the other two are terminal and must offer a way out. Kept beside
  // `me` rather than derived from it, because "no row" and "lookup failed" are
  // indistinguishable once both have collapsed into null.
  const [meState, setMeState] = useState<'loading' | 'ready' | AccountState>('loading');

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
  // and the facility name for the sidebar context. Keyed on the user id (not the
  // whole session): token refreshes / tab-visibility re-emit a new session object
  // for the SAME signed-in user, and we must not reload — nor snap the view back
  // to the dashboard — on those. Only a genuine identity change should reset here.
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) {
      setMe(null);
      setFacilityName(null);
      setMeState('loading');
      return;
    }
    setMeState('loading');
    void supabase
      .from('users')
      .select('user_id, role, full_name, facility_id, active, must_change_password')
      .eq('user_id', userId)
      .maybeSingle()
      .then(async ({ data, error }) => {
        // D-12: `error` used to be dropped on the floor here. A failed lookup
        // and an absent row both left `me` null, and null rendered a spinner
        // that nothing would ever clear. Read it, and keep the two apart.
        if (error) {
          setMe(null);
          setMeState('error');
          return;
        }
        const user = (data ?? null) as PortalUser | null;
        // Admin accounts live in the separate developer portal.
        if (user?.role === 'admin') {
          window.location.replace('/admin.html');
          return;
        }
        if (!user) {
          setMe(null);
          setMeState('missing');
          return;
        }
        // D-12: `active` was already being selected and never read. The portal
        // half of the mobile access gate — see AccountStateGate's header for
        // why a banned account never reaches this branch on a fresh sign-in.
        if (!user.active) {
          setMe(null);
          setMeState('inactive');
          return;
        }
        setMe(user);
        setMeState('ready');
        setPage('dashboard');
        const { data: fac } = await supabase
          .from('facilities')
          .select('name')
          .eq('facility_id', user.facility_id)
          .maybeSingle();
        setFacilityName((fac as { name: string } | null)?.name ?? null);
      });
  }, [userId, meVersion]);

  // Not signed in: the sidebar shell is hidden; the two-panel sign-in (§4)
  // carries its own brand panel and language toggle.
  if (!sessionLoaded) {
    return <p style={{ padding: 24, textAlign: 'center' }}>{t('common.loading')}</p>;
  }
  if (!session) {
    return <LoginForm />;
  }
  // D-12: three terminal states get a gate with a sign-out; only a genuinely
  // in-flight lookup is allowed to show a spinner, and that one does resolve.
  if (meState !== 'loading' && meState !== 'ready') {
    return (
      <AccountStateGate
        state={meState}
        email={session.user.email ?? null}
        onRetry={() => setMeVersion((v) => v + 1)}
      />
    );
  }
  if (!me) {
    return <p style={{ padding: 24, textAlign: 'center' }}>{t('common.loading')}</p>;
  }

  // D-06: the account is still on the password whoever provisioned it chose,
  // and that person can sign in as them until it is replaced. Nothing else
  // opens until it is. Placed after the admin redirect above, so an admin is
  // gated in their own portal rather than this one.
  if (me.must_change_password) {
    return (
      <ChangePasswordGate
        email={session.user.email ?? null}
        onDone={() => setMeVersion((v) => v + 1)}
      />
    );
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
    ? [
        navItem('dashboard', 'space_dashboard', t('nav.dashboard')),
        navItem('bhw', 'groups', t('nav.bhw')),
      ]
    : [
        navItem('dashboard', 'space_dashboard', t('nav.dashboard')),
        navItem('inbox', 'move_to_inbox', t('nav.inbox')),
        // Walk-ins and self-referrals (0025) — the second way a patient reaches
        // this facility, and until now the one the registry could not describe.
        navItem('register', 'person_add', t('nav.register')),
        navItem('hotspot', 'map', t('nav.hotspot')),
      ];

  const headers: Record<Page, { title: string; sub: string }> = {
    dashboard: {
      title: t('nav.dashboard'),
      sub: isCaptain ? t('shell.captainDashSub') : t('shell.dashboardSub'),
    },
    inbox: { title: t('nav.inbox'), sub: t('shell.referralsSub') },
    register: { title: t('nav.register'), sub: t('shell.registerSub') },
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
        page === 'bhw' ? (
          <BhwManagement />
        ) : (
          <CaptainDashboard />
        )
      ) : page === 'dashboard' ? (
        <Dashboard />
      ) : page === 'hotspot' ? (
        <HotspotView />
      ) : page === 'register' ? (
        <RegisterPatient
          me={me}
          onOpenReferral={(id) => {
            setPage('inbox');
            setOpenReferralId(id);
          }}
        />
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
