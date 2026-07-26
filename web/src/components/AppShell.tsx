/**
 * Shared portal shell (redesign §3): persistent navy left sidebar — brand mark
 * on top, role nav, and the facility/user context pinned at the bottom — beside
 * a content column with a page header (title + subtitle) and the language
 * toggle. Replaces the old white top bar. Reused by the facility and captain
 * spaces; the standing non-diagnostic note (§1) sits under every content area.
 *
 * Presentation only — the nav items, context, and children are supplied by the
 * caller, whose role (from its users row) decides what it passes.
 */
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import LangToggle from './LangToggle';

export interface ShellNavItem {
  key: string;
  label: string;
  icon: string; // Material Symbols name
  active: boolean;
  onClick: () => void;
}

interface Props {
  portalLabel: string;
  nav: ShellNavItem[];
  facility?: { name: string; region?: string | null } | null;
  user: { name: string; roleLabel: string };
  headerTitle: string;
  headerSub?: string;
  children: ReactNode;
}

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

export default function AppShell({
  portalLabel,
  nav,
  facility,
  user,
  headerTitle,
  headerSub,
  children,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/assets/tb-screen-logo.png" alt="" width={40} height={40} />
          <div className="brandtext">
            <span className="name">TB&#8209;Screen</span>
            <span className="portal">{portalLabel}</span>
          </div>
        </div>

        <nav className="side-nav">
          {nav.map((n) => (
            <button
              key={n.key}
              type="button"
              className={n.active ? 'active' : ''}
              aria-current={n.active ? 'page' : undefined}
              onClick={n.onClick}
            >
              <span className="msym" aria-hidden="true">
                {n.icon}
              </span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>

        <div className="side-spacer" />

        <div className="side-foot">
          {facility ? (
            <div className="ctx">
              <span className="msym" aria-hidden="true">
                local_hospital
              </span>
              <div className="ctx-text">
                <div className="ctx-name">{facility.name}</div>
                {facility.region ? <div className="ctx-sub">{facility.region}</div> : null}
              </div>
            </div>
          ) : null}

          <div className="ctx">
            <span className="avatar">{initials(user.name)}</span>
            <div className="ctx-text">
              <div className="ctx-name">{user.name}</div>
              <div className="ctx-sub">{user.roleLabel}</div>
            </div>
          </div>

          <button className="signout" type="button" onClick={() => void supabase.auth.signOut()}>
            <span className="msym" aria-hidden="true">
              logout
            </span>
            <span>{t('common.signOut')}</span>
          </button>
        </div>
      </aside>

      <div className="content">
        <header className="content-head">
          <div className="head-title">
            <h1>{headerTitle}</h1>
            {headerSub ? <p>{headerSub}</p> : null}
          </div>
          <LangToggle />
        </header>

        <main className="content-main">{children}</main>

        {/* Standing positioning note (§1) — visible under every space. */}
        <div className="footnote">{t('common.nonDiagnostic')}</div>
      </div>
    </div>
  );
}
