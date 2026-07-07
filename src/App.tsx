/**
 * Portal shell: session gate + view switching (inbox ⇄ referral detail).
 * Deliberately no router library — two views and one id of state (§2 minimal).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './lib/supabase';
import { AppLanguage, changeLanguage, SUPPORTED_LANGUAGES } from './i18n';
import LoginForm from './components/LoginForm';
import ReferralInbox from './components/ReferralInbox';
import ReferralDetail from './components/ReferralDetail';
import HotspotView from './components/HotspotView';

type Page = 'inbox' | 'hotspot';

export default function App() {
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [page, setPage] = useState<Page>('inbox');
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
              <span className="who">{session.user.email}</span>
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
              <button
                className={page === 'inbox' ? '' : 'secondary'}
                onClick={() => {
                  setPage('inbox');
                  setOpenReferralId(null);
                }}
              >
                {t('nav.inbox')}
              </button>
              <button
                className={page === 'hotspot' ? '' : 'secondary'}
                onClick={() => setPage('hotspot')}
              >
                {t('nav.hotspot')}
              </button>
            </nav>
            {page === 'hotspot' ? (
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
