/**
 * BHW ACCOUNTS (v2 redesign): a persistent list
 * with search + status filter, and a right-hand slide-in DRAWER for create/edit.
 * Rows carry 30-day activity counts (bhw_activity() RPC, captain role required
 * server-side, 0014 adds name parts / coverage / email / joined date).
 *
 * ACCOUNT MODEL: passwords are system-generated. Create and "Reset password" both
 * return a one-time temp credential shown on the credentials modal (email + temp
 * password) — the captain relays it in person. Every provisioned/reset account is
 * flagged must_change_password (0014) and set its own password on first sign-in.
 *
 * PRIVACY (§1): captains read no patient data. RLS gates patients/screenings/
 * referrals on role in ('bhw','tb_dots'); the email here is the BHW's OWN account
 * email. All account WRITES go through the manage-bhw Edge Function (the auth
 * admin API needs the service role, which never reaches the browser).
 *
 * TWO CALLERS, ONE COMPONENT (0023). The captain's view is the default. Passing
 * asAdmin renders the same screen for an admin, who is UNSCOPED: bhw_activity()
 * returns every BHW, and every write carries target_role: 'bhw' so manage-bhw
 * knows an admin means BHWs rather than captains.
 *
 * The differences an admin needs are all consequences of having no barangay of
 * their own:
 *   - Create must ASK for the barangay (AddressCascadeWeb, the same picker
 *     CaptainManagement uses) instead of inheriting the caller's.
 *   - The drawer subtitle cannot name "the" barangay, because the list spans
 *     all of them.
 *   - The handoff successor list must be narrowed to the departing BHW's own
 *     barangay. That filter is applied for BOTH callers: it is a no-op for a
 *     captain, whose rows all share one barangay, and writing it once avoids a
 *     second code path that only the admin exercises.
 *   - The list is GROUPED BY BARANGAY, with a barangay filter beside the status
 *     one. A captain's list is deliberately left flat: every row shares their
 *     one barangay, so a single group header would be pure furniture. The
 *     admin's list spans all 464, where a flat roster of names is unreadable
 *     the moment a barangay has more than a couple of workers.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import { BhwActivityRow } from '../lib/types';
import AddressCascadeWeb from './AddressCascadeWeb';

type Mode = 'closed' | 'new' | 'edit';

/** One-time credential surfaced after create / reset_password. */
interface Creds {
  email: string;
  tempPassword: string;
  name: string;
  reset: boolean;
}

const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '·';

/** ASCII slug of one name part — mirrors the edge function's slugPart(). */
const slugPart = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');

/** Name parts for the form: prefer the stored parts (0014), else split full_name. */
function partsOf(row: BhwActivityRow): { first: string; middle: string; last: string } {
  if (row.first_name || row.last_name) {
    return {
      first: row.first_name ?? '',
      middle: row.middle_name ?? '',
      last: row.last_name ?? '',
    };
  }
  const toks = row.full_name.trim().split(/\s+/);
  return {
    first: toks[0] ?? '',
    last: toks.length > 1 ? toks[toks.length - 1] : '',
    middle: toks.length > 2 ? toks.slice(1, -1).join(' ') : '',
  };
}

export default function BhwManagement({ asAdmin = false }: { asAdmin?: boolean } = {}) {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<BhwActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drawer + modals.
  const [mode, setMode] = useState<Mode>('closed');
  const [selId, setSelId] = useState<string | null>(null);
  const [creds, setCreds] = useState<Creds | null>(null);
  const [handoff, setHandoff] = useState<BhwActivityRow | null>(null);
  const [reassignTo, setReassignTo] = useState('');

  // Drawer form fields.
  const [first, setFirst] = useState('');
  const [middle, setMiddle] = useState('');
  const [last, setLast] = useState('');
  const [purok, setPurok] = useState('');
  /** Admin only: which barangay a new BHW joins. Captains inherit their own. */
  const [formBrgy, setFormBrgy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // List tools.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  // Admin only — a captain has exactly one barangay and nothing to choose.
  const [barangayFilter, setBarangayFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('bhw_activity', { days_back: 30 });
    if (err) setError(err.message);
    else setRows((data ?? []) as BhwActivityRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Call the manage-bhw Edge Function; returns the parsed body or throws. */
  const invoke = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    // An admin's default target is captains, so BHW writes must say so.
    const payload = asAdmin ? { ...body, target_role: 'bhw' } : body;
    const { data, error: err } = await supabase.functions.invoke('manage-bhw', { body: payload });
    if (err) throw new Error(err.message);
    const parsed = (data ?? {}) as Record<string, unknown>;
    if (parsed.error) throw new Error(String(parsed.error));
    return parsed;
  };

  const selected = mode === 'edit' && selId ? rows.find((r) => r.user_id === selId) ?? null : null;
  // All the captain's BHWs share the captain's barangay, so any row names it.
  // An admin's rows span every barangay, so there is no single one to name.
  const barangayName = asAdmin ? '' : rows.find((r) => r.barangay_name)?.barangay_name ?? '';

  const resetForm = () => {
    setFirst('');
    setMiddle('');
    setLast('');
    setPurok('');
    setFormBrgy(null);
    setSaved(false);
    setError(null);
  };

  const openNew = () => {
    resetForm();
    setSelId(null);
    setMode('new');
  };

  const openEdit = (row: BhwActivityRow) => {
    const p = partsOf(row);
    setFirst(p.first);
    setMiddle(p.middle);
    setLast(p.last);
    setPurok(row.purok ?? '');
    setFormBrgy(row.barangay_code ?? null);
    setSaved(false);
    setError(null);
    setSelId(row.user_id);
    setMode('edit');
  };

  const closeDrawer = () => {
    setMode('closed');
    setSelId(null);
    setSaved(false);
  };

  const valid =
    first.trim() !== '' &&
    last.trim() !== '' &&
    purok.trim() !== '' &&
    // manage-bhw rejects an admin create with no barangay; block it here so the
    // failure is a disabled button rather than a round trip and an error toast.
    (!asAdmin || !!formBrgy);

  const createBhw = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await invoke({
        action: 'create',
        first_name: first,
        middle_name: middle,
        last_name: last,
        purok,
        ...(asAdmin && formBrgy ? { barangay_code: formBrgy } : {}),
      });
      closeDrawer();
      setCreds({
        email: String(res.email ?? ''),
        tempPassword: String(res.temp_password ?? ''),
        name: [first, middle, last].map((s) => s.trim()).filter(Boolean).join(' '),
        reset: false,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveBhw = async () => {
    if (!selId || !valid) return;
    setBusy(true);
    setError(null);
    try {
      await invoke({
        action: 'update',
        user_id: selId,
        first_name: first,
        middle_name: middle,
        last_name: last,
        purok,
      });
      await load();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Passwords are hashed — never viewable, only replaceable. */
  const resetPassword = async (row: BhwActivityRow) => {
    setBusy(true);
    setError(null);
    try {
      const res = await invoke({ action: 'reset_password', user_id: row.user_id });
      setCreds({
        email: String(res.email ?? row.email ?? ''),
        tempPassword: String(res.temp_password ?? ''),
        name: row.full_name,
        reset: true,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (row: BhwActivityRow, active: boolean, successorId?: string) => {
    setBusy(true);
    setError(null);
    try {
      await invoke({
        action: active ? 'reactivate' : 'deactivate',
        user_id: row.user_id,
        ...(successorId ? { reassign_to: successorId } : {}),
      });
      setHandoff(null);
      closeDrawer();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ---- derived list ----
  /** The label a row is grouped and filtered under. Falls back to the PSGC code
   *  when the join produced no name, and to an explicit "unassigned" bucket
   *  when the BHW has no barangay at all — those rows must stay visible, since
   *  an unassigned BHW is exactly the one an admin needs to find and fix. */
  const groupOf = (r: BhwActivityRow): string =>
    r.barangay_name ?? r.barangay_code ?? '';

  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (statusFilter === 'active' && !r.active) return false;
    if (statusFilter === 'inactive' && r.active) return false;
    if (barangayFilter !== 'all' && groupOf(r) !== barangayFilter) return false;
    if (!q) return true;
    return (
      r.full_name.toLowerCase().includes(q) ||
      (r.purok ?? '').toLowerCase().includes(q) ||
      (r.email ?? '').toLowerCase().includes(q) ||
      // Searching a barangay by name is the obvious thing to try on a
      // province-wide list, and it did not work before.
      groupOf(r).toLowerCase().includes(q)
    );
  });

  /** Every barangay present in the data, for the filter — built from `rows`
   *  rather than `visible`, so choosing one does not empty the menu behind it. */
  const barangayOptions = [...new Set(rows.map(groupOf))].sort((a, b) =>
    a.localeCompare(b),
  );

  /**
   * `visible`, bucketed by barangay and sorted — barangays alphabetically, and
   * people by name within each. Only the admin renders these; the captain maps
   * `visible` directly.
   */
  const groups: { name: string; rows: BhwActivityRow[] }[] = (() => {
    const by = new Map<string, BhwActivityRow[]>();
    for (const r of visible) {
      const k = groupOf(r);
      const list = by.get(k);
      if (list) list.push(r);
      else by.set(k, [r]);
    }
    return [...by.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, list]) => ({
        name,
        rows: [...list].sort((a, b) => a.full_name.localeCompare(b.full_name)),
      }));
  })();

  const previewEmail =
    first.trim() && last.trim() ? `${slugPart(first)}.${slugPart(last)}@tbscreen.ph` : '';
  const emailValue = mode === 'edit' ? selected?.email ?? '' : previewEmail;
  const joinedText = (iso: string | null): string =>
    iso ? new Date(iso).toLocaleDateString(i18n.language, { month: 'short', year: 'numeric' }) : '—';

  const statusChip = (active: boolean) => (
    <span className={`chip ${active ? 'active' : 'inactive'}`}>
      {active ? t('bhw.active') : t('bhw.deactivated')}
    </span>
  );

  return (
    <>
      <div className="dcard">
        <div className="bhw-head">
          <div className="bhw-titlerow">
            <div className="bhw-titleleft">
              <h2>{t('bhw.title')}</h2>
              <span className="count-pill">{t('bhw.resultsCount', { count: visible.length })}</span>
            </div>
            <button className="bhw-new" onClick={openNew}>
              <span className="msym" aria-hidden="true">
                add
              </span>
              {t('bhw.addCta')}
            </button>
          </div>
          <p className="bhw-privacy">{t('bhw.privacyNote')}</p>
          <div className="bhw-tools">
            <div className="search-wrap">
              <span className="msym search-ic" aria-hidden="true">
                search
              </span>
              <input
                type="search"
                placeholder={t('bhw.searchPlaceholder')}
              aria-label={t('bhw.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="select-wrap">
              <select
                value={statusFilter}
                aria-label={t('bhw.colStatus')}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
              >
                <option value="all">{t('bhw.statusAll')}</option>
                <option value="active">{t('bhw.active')}</option>
                <option value="inactive">{t('bhw.deactivated')}</option>
              </select>
              <span className="msym sel-ic" aria-hidden="true">
                expand_more
              </span>
            </div>
            {asAdmin && barangayOptions.length > 1 ? (
              <div className="select-wrap">
                <select
                  value={barangayFilter}
                  aria-label={t('bhw.barangayLabel')}
                  onChange={(e) => setBarangayFilter(e.target.value)}
                >
                  <option value="all">{t('bhw.barangayAll')}</option>
                  {barangayOptions.map((b) => (
                    <option key={b} value={b}>
                      {b || t('bhw.barangayNone')}
                    </option>
                  ))}
                </select>
                <span className="msym sel-ic" aria-hidden="true">
                  expand_more
                </span>
              </div>
            ) : null}
            <button
              className="icon-btn"
              onClick={() => void load()}
              disabled={loading}
              title={t('common.refresh')}
              aria-label={t('common.refresh')}
            >
              <span className={`msym${loading ? ' spin' : ''}`} aria-hidden="true">
                refresh
              </span>
            </button>
          </div>
        </div>

        <div className="bhw-list" aria-busy={loading}>
          {error && mode === 'closed' && !handoff ? (
            <div className="dstate err">
              <div className="badge">
                <span className="msym" aria-hidden="true">
                  cloud_off
                </span>
              </div>
              <div className="st-title">{t('bhw.errorTitle')}</div>
              <div className="st-body">{t('bhw.actionError', { message: error })}</div>
              <button className="retry" onClick={() => void load()}>
                <span className="msym" aria-hidden="true">
                  refresh
                </span>
                {t('bhw.retry')}
              </button>
            </div>
          ) : loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bhw-row skel" aria-hidden="true">
                <span className="sk av" />
                <div className="bhw-info">
                  <span className="sk n" />
                  <span className="sk s" />
                </div>
                <span className="sk ch" />
              </div>
            ))
          ) : rows.length === 0 ? (
            <div className="dstate ok">
              <div className="badge">
                <span className="msym" aria-hidden="true">
                  group_off
                </span>
              </div>
              <div className="st-title">{t('bhw.empty')}</div>
              <div className="st-body">{t('bhw.emptyDataBody')}</div>
            </div>
          ) : visible.length === 0 ? (
            <div className="dstate ok">
              <div className="badge">
                <span className="msym" aria-hidden="true">
                  search_off
                </span>
              </div>
              <div className="st-title">{t('bhw.filterEmptyTitle')}</div>
              <div className="st-body">{t('bhw.filterEmptyBody')}</div>
            </div>
          ) : (
            /* One row renderer, two shapes. The captain gets `visible` flat;
               the admin gets the same rows under barangay headings. */
            (() => {
              const row = (r: BhwActivityRow) => {
                const isSel = mode === 'edit' && r.user_id === selId;
                return (
                  <button
                    key={r.user_id}
                    className={`bhw-row rowbtn${r.active ? '' : ' inactive'}${isSel ? ' selected' : ''}`}
                    onClick={() => openEdit(r)}
                  >
                    <span className="bhw-avatar">{initials(r.full_name)}</span>
                    <div className="bhw-info">
                      <span className="bhw-name">{r.full_name}</span>
                      <span className="bhw-sub">
                        {/* Inside a barangay group the barangay is already the
                            heading, so the sub-line drops it and shows the
                            purok — the thing that actually distinguishes two
                            workers in the same barangay. */}
                        {(asAdmin
                          ? [r.purok]
                          : [r.purok, r.barangay_name ?? r.barangay_code]
                        )
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </span>
                    </div>
                    {statusChip(r.active)}
                  </button>
                );
              };

              if (!asAdmin) return visible.map(row);

              return groups.map((g) => (
                <div key={g.name || '(none)'} className="bhw-group">
                  <div className="bhw-grouphead">
                    <span className="msym" aria-hidden="true">
                      location_on
                    </span>
                    <span className="bhw-groupname">{g.name || t('bhw.barangayNone')}</span>
                    <span className="bhw-groupcount">
                      {t('bhw.groupCount', { count: g.rows.length })}
                    </span>
                  </div>
                  {g.rows.map(row)}
                </div>
              ));
            })()
          )}
        </div>
      </div>

      {/* ---------- create / edit drawer ---------- */}
      {mode !== 'closed' ? (
        <div className="drawer-scrim" onClick={closeDrawer}>
          <section
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label={mode === 'new' ? t('bhw.newTitle') : t('bhw.editTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-head">
              <div className="drawer-titlebox">
                <div className="drawer-title">
                  {mode === 'new' ? t('bhw.newTitle') : selected?.full_name ?? t('bhw.editTitle')}
                </div>
                <div className="drawer-sub">
                  {mode === 'new'
                    ? barangayName
                      ? t('bhw.newSub', { barangay: barangayName })
                      : ''
                    : selected?.email ?? ''}
                </div>
              </div>
              {mode === 'edit' && selected ? statusChip(selected.active) : null}
              <button className="drawer-close" onClick={closeDrawer} aria-label={t('bhw.cancel')}>
                <span className="msym" aria-hidden="true">
                  close
                </span>
              </button>
            </div>

            <div className="drawer-scroll">
              <div className="drawer-body">
              {error ? <p className="error">{t('bhw.actionError', { message: error })}</p> : null}

              <div className="dfield-row">
                <label className="dfield">
                  <span className="dfield-lbl">{t('bhw.firstNameLabel')}</span>
                  <input value={first} onChange={(e) => setFirst(e.target.value)} />
                </label>
                <label className="dfield">
                  <span className="dfield-lbl">
                    {t('bhw.middleNameLabel')}
                    <span className="dfield-opt">{t('bhw.optional')}</span>
                  </span>
                  <input value={middle} onChange={(e) => setMiddle(e.target.value)} />
                </label>
                <label className="dfield">
                  <span className="dfield-lbl">{t('bhw.lastNameLabel')}</span>
                  <input value={last} onChange={(e) => setLast(e.target.value)} />
                </label>
              </div>

              {asAdmin ? (
                <div className="dfield">
                  <span className="dfield-lbl">{t('bhw.barangayLabel')}</span>
                  <AddressCascadeWeb value={formBrgy} onChange={setFormBrgy} />
                  <span className="dfield-hint">{t('bhw.barangayHint')}</span>
                </div>
              ) : null}

              <label className="dfield">
                <span className="dfield-lbl">{t('bhw.coverageLabel')}</span>
                <input
                  value={purok}
                  placeholder={t('bhw.coveragePlaceholder')}
                  onChange={(e) => setPurok(e.target.value)}
                />
              </label>

              <div className="dfield">
                <span className="dfield-lbl">{t('bhw.emailLabel')}</span>
                <div className="email-box">
                  <span className="msym" aria-hidden="true">
                    alternate_email
                  </span>
                  <span className={emailValue ? '' : 'pending'}>
                    {emailValue || t('bhw.emailPending')}
                  </span>
                </div>
                <span className="dfield-hint">{t('bhw.emailAuto')}</span>
              </div>

              {mode === 'edit' && selected ? (
                <div className="ctx-tiles">
                  <div className="ctx-tile">
                    <div className="k">{t('bhw.ctxCoverage')}</div>
                    <div className="v">
                      {[selected.purok, selected.barangay_name].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <div className="ctx-tile">
                    <div className="k">{t('bhw.ctxScreenings')}</div>
                    <div className="v num">{selected.screenings_n}</div>
                  </div>
                  <div className="ctx-tile">
                    <div className="k">{t('bhw.ctxReferrals')}</div>
                    <div className="v num">{selected.referrals_n}</div>
                  </div>
                  <div className="ctx-tile">
                    <div className="k">{t('bhw.ctxJoined')}</div>
                    <div className="v">{joinedText(selected.joined_at)}</div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="drawer-foot">
              {mode === 'new' ? (
                <div className="drawer-actions">
                  <button disabled={busy || !valid} onClick={() => void createBhw()}>
                    {t('bhw.createBhw')}
                  </button>
                  <button className="secondary" disabled={busy} onClick={closeDrawer}>
                    {t('bhw.cancel')}
                  </button>
                  <span className="req-note">{t(asAdmin ? 'bhw.reqNoteAdmin' : 'bhw.reqNote')}</span>
                </div>
              ) : selected ? (
                <>
                  <div className="drawer-actions">
                    <button disabled={busy || !valid} onClick={() => void saveBhw()}>
                      {t('bhw.save')}
                    </button>
                    {saved ? (
                      <span className="saved-flash">
                        <span className="msym" aria-hidden="true">
                          check_circle
                        </span>
                        {t('bhw.savedFlash')}
                      </span>
                    ) : null}
                  </div>
                  <div className="drawer-actions">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void resetPassword(selected)}
                    >
                      <span className="msym" aria-hidden="true">
                        key
                      </span>
                      {t('bhw.resetPw')}
                    </button>
                  </div>
                  {selected.active ? (
                    <button
                      className="deact-btn"
                      disabled={busy}
                      onClick={() => {
                        setReassignTo('');
                        setHandoff(selected);
                      }}
                    >
                      <span className="msym" aria-hidden="true">
                        block
                      </span>
                      {t('bhw.deactivate')}
                    </button>
                  ) : (
                    <button
                      className="react-btn"
                      disabled={busy}
                      onClick={() => void setActive(selected, true)}
                    >
                      <span className="msym" aria-hidden="true">
                        restart_alt
                      </span>
                      {t('bhw.reactivate')}
                    </button>
                  )}
                </>
              ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {/* ---------- deactivation handoff dialog ---------- */}
      {handoff ? (
        <div className="cap-modal-scrim" onClick={() => setHandoff(null)}>
          <div
            className="cap-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('bhw.deactivateTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cap-modal-head">
              <span className="cap-modal-ic danger">
                <span className="msym" aria-hidden="true">
                  block
                </span>
              </span>
              <div className="cap-modal-titlebox">
                <div className="cap-modal-title">{t('bhw.deactivateTitle')}</div>
                <div className="cap-modal-sub">
                  {[handoff.full_name, handoff.purok, handoff.barangay_name]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <button
                className="drawer-close"
                onClick={() => setHandoff(null)}
                aria-label={t('bhw.cancel')}
              >
                <span className="msym" aria-hidden="true">
                  close
                </span>
              </button>
            </div>

            <div className="cap-modal-body">
              <div className="ho-section-label">{t('bhw.activityLabel')}</div>
              <div className="ho-stats">
                <div className="ho-stat">
                  <div className="n">{handoff.screenings_n}</div>
                  <div className="w">{t('capDash.wordScreenings')}</div>
                </div>
                <div className="ho-stat">
                  <div className="n ref">{handoff.referrals_n}</div>
                  <div className="w">{t('capDash.wordReferrals')}</div>
                </div>
              </div>

              <div className="ho-section-label">{t('bhw.hoWhat')}</div>
              <div className="ho-points">
                <div className="ho-point">
                  <span className="msym lock" aria-hidden="true">
                    lock
                  </span>
                  <span>{t('bhw.hoPoint1')}</span>
                </div>
                <div className="ho-point">
                  <span className="msym keep" aria-hidden="true">
                    inventory_2
                  </span>
                  <span>{t('bhw.hoPoint2')}</span>
                </div>
                <div className="ho-point">
                  <span className="msym move" aria-hidden="true">
                    follow_the_signs
                  </span>
                  <span>{t('bhw.hoPoint3')}</span>
                </div>
              </div>

              <label className="dfield">
                <span className="dfield-lbl">{t('bhw.reassignLabel')}</span>
                <div className="select-wrap wide">
                  <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                    <option value="">{t('bhw.reassignNone')}</option>
                    {rows
                      .filter(
                        (r) =>
                          r.active &&
                          r.user_id !== handoff.user_id &&
                          // Patients may only move within the barangay they were
                          // enrolled in. No-op for a captain; load-bearing for an
                          // admin, whose list spans every barangay.
                          r.barangay_code === handoff.barangay_code,
                      )
                      .map((r) => (
                        <option key={r.user_id} value={r.user_id}>
                          {[r.full_name, r.purok].filter(Boolean).join(' · ')}
                        </option>
                      ))}
                  </select>
                  <span className="msym sel-ic" aria-hidden="true">
                    expand_more
                  </span>
                </div>
              </label>

              {error ? <p className="error">{t('bhw.actionError', { message: error })}</p> : null}
            </div>

            <div className="cap-modal-foot">
              <button
                className="deact-btn solid"
                disabled={busy}
                onClick={() => void setActive(handoff, false, reassignTo)}
              >
                <span className="msym" aria-hidden="true">
                  block
                </span>
                {t('bhw.hoConfirm')}
              </button>
              <button className="secondary" disabled={busy} onClick={() => setHandoff(null)}>
                {t('bhw.cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------- one-time credentials modal (create / reset) ---------- */}
      {creds ? (
        <div className="cap-modal-scrim" onClick={() => setCreds(null)}>
          <div
            className="cap-modal"
            role="dialog"
            aria-modal="true"
            aria-label={creds.reset ? t('bhw.resetDoneTitle') : t('bhw.createdTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cap-modal-head">
              <span className="cap-modal-ic ok">
                <span className="msym" aria-hidden="true">
                  {creds.reset ? 'key' : 'check_circle'}
                </span>
              </span>
              <div className="cap-modal-titlebox">
                <div className="cap-modal-title">
                  {creds.reset ? t('bhw.resetDoneTitle') : t('bhw.createdTitle')}
                </div>
                <div className="cap-modal-sub">{creds.name}</div>
              </div>
            </div>

            <div className="cap-modal-body">
              <div className="creds-row">
                <span className="creds-k">{t('bhw.emailLabel')}</span>
                <span className="creds-v">{creds.email}</span>
              </div>
              <div className="creds-row">
                <span className="creds-k">{t('bhw.tempPwLabel')}</span>
                <span className="creds-v mono">{creds.tempPassword}</span>
              </div>
              <p className="creds-note">{t('bhw.createdNote')}</p>
            </div>

            <div className="cap-modal-foot">
              <button onClick={() => setCreds(null)}>{t('bhw.done')}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
