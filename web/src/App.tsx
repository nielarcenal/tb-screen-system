/**
 * Clinical portal shell (redesign §3): navy sidebar + content column via
 * <AppShell>. Serves the two clinical roles, which have a PAGE EACH:
 *   tb_dots  → index.html   Dashboard / Referrals / Register patient / Hotspots
 *   midwife  → midwife.html BHW management only (they hold no patient policies)
 * One component, two entry points (main.tsx / midwife-main.tsx) differing only
 * in the `portal` prop — the views below are unchanged, so nothing about either
 * role's screens depends on which file booted them.
 *
 * WHY A PAGE EACH rather than one page that branches. The two roles share no
 * views, no data and no vocabulary, and a midwife arriving at a page headed
 * "Facility Portal" had to be told the software would sort it out. Separate
 * URLs also mean each role has a link to hand out, which is what the public
 * site now lists.
 *
 * Sign-in itself is still role-agnostic — see LoginForm's header for why that
 * matters — so any role can authenticate on either page. `homeFor` below is
 * what puts them right afterwards, once the role is actually known.
 *
 * The inbox renders master-detail: list on the left, detail panel on the right.
 * Deliberately no router library — a handful of views and one id of state (§2).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './lib/supabase';
import { manilaToday, PortalUser, reportTabVisible, UserRole } from './lib/types';
import AppShell, { ShellNavItem } from './components/AppShell';
import LoginForm, { PortalKind } from './components/LoginForm';
import Dashboard from './components/Dashboard';
import MidwifeDashboard from './components/MidwifeDashboard';
import ReferralInbox from './components/ReferralInbox';
import ReferralDetail from './components/ReferralDetail';
import BarangayReport from './components/BarangayReport';
import HotspotView from './components/HotspotView';
import RegisterPatient from './components/RegisterPatient';
import BhwManagement from './components/BhwManagement';
import ChangePasswordGate from './components/ChangePasswordGate';
import AccountStateGate, { AccountState } from './components/AccountStateGate';
import CaseRegistry from './components/CaseRegistry';

type Page = 'dashboard' | 'inbox' | 'cases' | 'register' | 'hotspot' | 'report' | 'bhw';

/** The page a role signs in to. Null means "wherever they are is fine": 'bhw'
 *  is the mobile app's role and has no portal of its own, so a BHW who signs in
 *  here is left where they landed rather than bounced between two pages that
 *  are equally not theirs. */
function homeFor(role: UserRole | undefined): string | null {
  if (role === 'admin') return '/admin.html';
  if (role === 'midwife') return '/midwife.html';
  if (role === 'tb_dots') return '/';
  return null;
}

export default function App({ portal }: { portal: PortalKind }) {
  const { t } = useTranslation();
  const portalPath = portal === 'midwife' ? '/midwife.html' : '/';
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [me, setMe] = useState<PortalUser | null>(null);
  const [facilityName, setFacilityName] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('dashboard');
  const [openReferralId, setOpenReferralId] = useState<string | null>(null);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  // Bumped when the password gate finishes, to re-read the users row (and with
  // it the now-cleared must_change_password) without disturbing the session.
  const [meVersion, setMeVersion] = useState(0);
  // D-12: why `me` is null. 'loading' is the only state that may render a
  // spinner; the other two are terminal and must offer a way out. Kept beside
  // `me` rather than derived from it, because "no row" and "lookup failed" are
  // indistinguishable once both have collapsed into null.
  const [meState, setMeState] = useState<'loading' | 'ready' | AccountState>('loading');

  // Is the Barangay Report's backing function actually there? 0027 ships in the
  // same commit as the view, but its migration is applied BY HAND, so a
  // deployed portal can run ahead of its own database — which it did for a
  // while today, leaving a tab whose every load failed. A tab that always
  // errors is worse than no tab.
  //
  // Starts false and is only turned on by a successful probe, so the tab never
  // flickers in before we know. Hidden ONLY on PGRST202 ("function not found"):
  // a network blip or a permission error leaves it VISIBLE, so the view itself
  // can say what went wrong rather than a feature quietly disappearing.
  const [reportReady, setReportReady] = useState(false);

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
        // Correct credentials on the wrong portal page are REDIRECTED, never
        // refused — the sign-in form has no idea which role it just let in, by
        // design (LoginForm's header). Admins leave for the developer portal
        // here exactly as they always did; the midwife/facility split is the
        // same rule, generalised.
        const home = homeFor(user?.role);
        if (home && home !== portalPath) {
          window.location.replace(home);
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
  }, [userId, meVersion, portalPath]);

  // Cheapest honest probe: ask for a single day. The answer we care about is
  // the error code, not the rows. Midwives never see this tab, so skip it.
  const role = me?.role;
  useEffect(() => {
    if (!role || role === 'midwife') return;
    let cancelled = false;
    const today = manilaToday();
    void supabase
      .rpc('barangay_report', { from_date: today, to_date: today })
      .then(({ error }) => {
        if (!cancelled) setReportReady(reportTabVisible(error));
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  // Not signed in: the sidebar shell is hidden; the two-panel sign-in (§4)
  // carries its own brand panel and language toggle.
  if (!sessionLoaded) {
    return <p style={{ padding: 24, textAlign: 'center' }}>{t('common.loading')}</p>;
  }
  if (!session) {
    return <LoginForm portal={portal} />;
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

  const isMidwife = me.role === 'midwife';

  // If the report tab is not available, never sit on it — the nav item would be
  // absent while the content column still rendered it. Unreachable in practice
  // (you cannot click a hidden tab); cheap insurance against a probe that flips
  // to false underneath us.
  const activePage: Page = page === 'report' && !reportReady ? 'dashboard' : page;

  const openPage = (key: Page) => {
    setPage(key);
    setOpenReferralId(null);
    setOpenCaseId(null);
  };

  const navItem = (key: Page, icon: string, label: string): ShellNavItem => ({
    key,
    icon,
    label,
    active: activePage === key,
    onClick: () => openPage(key),
  });

  const nav: ShellNavItem[] = isMidwife
    ? [
        navItem('dashboard', 'space_dashboard', t('nav.dashboard')),
        navItem('bhw', 'groups', t('nav.bhw')),
      ]
    : [
        navItem('dashboard', 'space_dashboard', t('nav.dashboard')),
        navItem('inbox', 'move_to_inbox', t('nav.inbox')),
        navItem('cases', 'clinical_notes', t('nav.cases')),
        // Walk-ins and self-referrals (0025) — the second way a patient reaches
        // this facility, and until now the one the registry could not describe.
        navItem('register', 'person_add', t('nav.register')),
        navItem('hotspot', 'map', t('nav.hotspot')),
        // The per-barangay counts the health office compiles by hand (0027).
        // Only once its function answers — see reportReady.
        ...(reportReady ? [navItem('report', 'summarize', t('nav.report'))] : []),
      ];

  const headers: Record<Page, { title: string; sub: string }> = {
    dashboard: {
      title: t('nav.dashboard'),
      sub: isMidwife ? t('shell.midwifeDashSub') : t('shell.dashboardSub'),
    },
    inbox: { title: t('nav.inbox'), sub: t('shell.referralsSub') },
    cases: { title: t('nav.cases'), sub: t('shell.casesSub') },
    register: { title: t('nav.register'), sub: t('shell.registerSub') },
    hotspot: { title: t('nav.hotspot'), sub: t('shell.hotspotsSub') },
    report: { title: t('nav.report'), sub: t('shell.reportSub') },
    bhw: { title: t('nav.bhw'), sub: t('shell.bhwSub') },
  };

  return (
    <AppShell
      portalLabel={isMidwife ? t('shell.midwifePortal') : t('shell.facilityPortal')}
      nav={nav}
      facility={!isMidwife && facilityName ? { name: facilityName } : null}
      user={{
        name: me.full_name ?? session.user.email ?? '',
        roleLabel: isMidwife ? t('login.roleMidwife') : t('login.roleStaff'),
      }}
      headerTitle={headers[activePage].title}
      headerSub={headers[activePage].sub}
    >
      {isMidwife ? (
        activePage === 'bhw' ? (
          <BhwManagement />
        ) : (
          <MidwifeDashboard />
        )
      ) : activePage === 'dashboard' ? (
        <Dashboard />
      ) : activePage === 'hotspot' ? (
        <HotspotView />
      ) : activePage === 'report' ? (
        <BarangayReport />
      ) : activePage === 'register' ? (
        <RegisterPatient
          me={me}
          onOpenReferral={(id) => {
            setPage('inbox');
            setOpenReferralId(id);
          }}
        />
      ) : activePage === 'cases' ? (
        <CaseRegistry initialCaseId={openCaseId} />
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
                onOpenCase={(caseId) => {
                  setOpenCaseId(caseId);
                  setPage('cases');
                }}
              />
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
