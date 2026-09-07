/**
 * Shared sign-in shell (redesign §4): a navy brand panel (logo, headline, the
 * three programme points) beside a centered form column carrying the language
 * pills and the standing "access is provisioned by your administrator" note.
 * The brand panel collapses below 880px, replaced by a compact top brand above
 * the form. The form itself — title, error, fields — is supplied as children,
 * so the facility (staff/midwife) and admin logins share one shell.
 */
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import LangToggle from './LangToggle';

export default function LoginLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const points = [
    { icon: 'encrypted', label: t('login.pSecure') },
    { icon: 'groups', label: t('login.pRoles') },
    { icon: 'public', label: t('login.pProgram') },
  ];

  return (
    <div className="loginview">
      <aside className="brandpanel">
        <div className="glow1" />
        <div className="glow2" />
        <span className="bgmark msym" aria-hidden="true">
          pulmonology
        </span>

        <div className="brand">
          <img src="/assets/tb-screen-logo.png" alt="" width={44} height={44} />
          <div>
            <span className="name">TB&#8209;Screen</span>
            <span className="tag">{t('login.brandTag')}</span>
          </div>
        </div>

        <div className="brandmid">
          <h1>{t('login.brandHead')}</h1>
          <p className="brandsub">{t('login.brandSub')}</p>
          <div className="points">
            {points.map((p) => (
              <div className="point" key={p.icon}>
                <span className="ic">
                  <span className="msym" aria-hidden="true">
                    {p.icon}
                  </span>
                </span>
                <span className="lbl">{p.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="copyright">
          <span className="msym" aria-hidden="true">
            verified_user
          </span>
          <span>{t('login.copyright')}</span>
        </div>
      </aside>

      <div className="formwrap">
        <div className="formwrap-lang">
          <LangToggle />
        </div>
        <div className="formcard">
          <div className="topbrand">
            <img src="/assets/tb-screen-logo.png" alt="" width={40} height={40} />
            <div>
              <span className="name">TB&#8209;Screen</span>
              <span className="tag">{t('login.brandTag')}</span>
            </div>
          </div>

          {children}

          <div className="access-help">
            <span className="msym" aria-hidden="true">
              lock
            </span>
            <span>{t('login.accessHelp')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
