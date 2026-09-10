/**
 * Facility audit viewer (migration 0038, Task 6.3).
 *
 * Reads `facility_audit_events()`, a keyset-paginated SECURITY INVOKER function.
 * Two consequences follow from that and shape this whole file:
 *
 *  - The facility boundary is `audit_logs`' own RLS, not anything written here.
 *    This component cannot widen it, and adding a filter here would not narrow
 *    it either — it would only hide rows the server already agreed to send.
 *  - Paging is by cursor, never by page number. Every event a single RPC writes
 *    shares one `occurred_at` (now() is transaction-stable), so the cursor is
 *    the pair (occurred_at, audit_id) and the order must match the server's.
 *
 * `changes` is rendered as a sentence per key, never as raw JSON. The keys are a
 * server-side whitelist and hold no clinical value, no free text and no contact
 * data; the renderer still names the keys it knows and falls back to the key
 * name rather than printing whatever arrives.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import type { AuditEventRow } from '../lib/types';

const PAGE_SIZE = 25;

const ENTITY_KEY: Record<string, string> = {
  appointments: 'audit.entity.appointments',
  tb_cases: 'audit.entity.tb_cases',
  treatment_followups: 'audit.entity.treatment_followups',
  referrals: 'audit.entity.referrals',
};

const ACTION_KEY: Record<string, string> = {
  created: 'audit.action.created',
  updated: 'audit.action.updated',
  status_changed: 'audit.action.status_changed',
  transferred: 'audit.action.transferred',
  cancelled: 'audit.action.cancelled',
  closed: 'audit.action.closed',
  voided: 'audit.action.voided',
};

const FIELD_KEY: Record<string, string> = {
  status: 'audit.field.status',
  scheduled_date: 'audit.field.scheduled_date',
  attended_date: 'audit.field.attended_date',
  facility_id: 'audit.field.facility_id',
  referral_id: 'audit.field.referral_id',
  tb_case_id: 'audit.field.tb_case_id',
  case_status: 'audit.field.case_status',
  treatment_start_date: 'audit.field.treatment_start_date',
  outcome: 'audit.field.outcome',
  outcome_date: 'audit.field.outcome_date',
  registration_date: 'audit.field.registration_date',
  case_number: 'audit.field.case_number',
  visit_date: 'audit.field.visit_date',
  voided_at: 'audit.field.voided_at',
  void_reason: 'audit.field.void_reason',
  presented: 'audit.field.presented',
  result_date: 'audit.field.result_date',
  lab_sample_id: 'audit.field.lab_sample_id',
};

const FILTERS = ['all', 'appointments', 'tb_cases', 'treatment_followups', 'referrals'] as const;
type AuditFilter = (typeof FILTERS)[number];

/**
 * One side of a change, as text.
 *
 * A uuid is shortened rather than printed in full: the viewer's job is to show
 * that ownership moved, not to be a place someone copies identifiers out of. A
 * null becomes the localised "not set" rather than the word "null".
 */
function sideText(value: unknown, t: (k: string) => string): string {
  if (value === null || value === undefined) return t('audit.notSet');
  if (typeof value === 'boolean') return value ? t('audit.yes') : t('audit.no');
  const s = String(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) ? `${s.slice(0, 8)}…` : s;
}

function ChangeSummary({ changes }: { changes: Record<string, unknown> }) {
  const { t } = useTranslation();
  const entries = Object.entries(changes ?? {});
  if (entries.length === 0) return <span className="audit-nochange">{t('audit.noFields')}</span>;

  return (
    <ul className="audit-changes">
      {entries.map(([field, value]) => {
        const pair = (value ?? {}) as { from?: unknown; to?: unknown };
        const label = t(FIELD_KEY[field] ?? field);
        // Every writer in 0031/0035/0038 emits {from, to}. Anything else is a
        // future writer this renderer has not been taught about; name the field
        // rather than dumping the value.
        const shaped = typeof value === 'object' && value !== null && ('from' in pair || 'to' in pair);
        return (
          <li key={field}>
            <span className="audit-field">{label}</span>
            {shaped ? (
              <span className="audit-transition">
                {sideText(pair.from, t)} <span aria-hidden="true">→</span> {sideText(pair.to, t)}
              </span>
            ) : (
              <span className="audit-transition">{t('audit.changed')}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function AuditLog() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AuditEventRow[]>([]);
  const [filter, setFilter] = useState<AuditFilter>('all');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const fetchPage = useCallback(
    async (cursor: AuditEventRow | null, currentFilter: AuditFilter) => {
      const { data, error: rpcError } = await supabase.rpc('facility_audit_events', {
        p_limit: PAGE_SIZE,
        p_before_at: cursor?.occurred_at ?? null,
        p_before_id: cursor?.audit_id ?? null,
        p_entity_table: currentFilter === 'all' ? null : currentFilter,
      });
      if (rpcError) throw new Error(rpcError.message);
      return Array.isArray(data) ? (data as AuditEventRow[]) : [];
    },
    [],
  );

  const load = useCallback(
    async (currentFilter: AuditFilter) => {
      setLoading(true);
      setError(null);
      setDone(false);
      try {
        const page = await fetchPage(null, currentFilter);
        setRows(page);
        setDone(page.length < PAGE_SIZE);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setRows([]);
      }
      setLoading(false);
    },
    [fetchPage],
  );

  useEffect(() => {
    void load(filter);
  }, [load, filter]);

  const loadMore = async () => {
    // The cursor is the LAST row currently held, so a page boundary that falls
    // inside a group of events sharing one timestamp still advances: audit_id
    // breaks the tie on both sides.
    const cursor = rows[rows.length - 1];
    if (!cursor || loadingMore || done) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchPage(cursor, filter);
      setRows((prev) => [...prev, ...page]);
      if (page.length < PAGE_SIZE) setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoadingMore(false);
  };

  return (
    <section className="audit-log" aria-label={t('audit.title')}>
      <div className="audit-head">
        <div>
          <h3>{t('audit.title')}</h3>
          <p>{t('audit.privacy')}</p>
        </div>
        <button aria-label={t('common.refresh')} onClick={() => void load(filter)} disabled={loading}>
          <span className="msym" aria-hidden="true">refresh</span>
        </button>
      </div>

      <div className="audit-filters" role="group" aria-label={t('audit.filterLabel')}>
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            className={filter === key ? 'chip chip--on' : 'chip'}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {t(key === 'all' ? 'audit.filter.all' : ENTITY_KEY[key])}
          </button>
        ))}
      </div>

      {error ? (
        <div className="case-list-state" role="alert">
          <strong>{t('audit.loadError')}</strong>
          <span>{error}</span>
          <button onClick={() => void load(filter)}>{t('inbox.retry')}</button>
        </div>
      ) : loading ? (
        <p className="case-empty-line">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="case-empty-line">{t('audit.empty')}</p>
      ) : (
        <>
          <ul className="audit-list">
            {rows.map((row) => (
              <li key={row.audit_id} className="audit-row">
                <div className="audit-row-head">
                  <strong>{t(ACTION_KEY[row.action] ?? row.action)}</strong>
                  <span className="audit-entity">{t(ENTITY_KEY[row.entity_table] ?? row.entity_table)}</span>
                  <time dateTime={row.occurred_at}>{new Date(row.occurred_at).toLocaleString()}</time>
                </div>
                <ChangeSummary changes={row.changes} />
                <div className="audit-meta">
                  {/* actor_name comes from a LEFT JOIN through the users RLS, so
                      it is null for anyone out of the reader's scope, and for a
                      support write with no signed-in actor at all. */}
                  {row.actor_name ? (
                    <span>{t('audit.byName', { name: row.actor_name, role: row.actor_role ?? '—' })}</span>
                  ) : row.actor_role ? (
                    <span>{t('audit.byRole', { role: row.actor_role })}</span>
                  ) : (
                    <span>{t('audit.bySystem')}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {done ? (
            <p className="audit-end">{t('audit.end')}</p>
          ) : (
            <button className="audit-more" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? t('common.loading') : t('audit.loadMore')}
            </button>
          )}
        </>
      )}
    </section>
  );
}
