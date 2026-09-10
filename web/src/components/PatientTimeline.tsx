import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import type { TimelineEventRow } from '../lib/types';

const LIMIT = 500;

const EVENT_KEY: Record<string, string> = {
  patient_enrolled: 'cases.timeline.event.patient_enrolled',
  screening_recorded: 'cases.timeline.event.screening_recorded',
  referral_submitted: 'cases.timeline.event.referral_submitted',
  referral_received: 'cases.timeline.event.referral_received',
  lab_result_recorded: 'cases.timeline.event.lab_result_recorded',
  patient_did_not_present: 'cases.timeline.event.patient_did_not_present',
  referral_closed: 'cases.timeline.event.referral_closed',
  case_registered: 'cases.timeline.event.case_registered',
  treatment_started: 'cases.timeline.event.treatment_started',
  appointment_scheduled: 'cases.timeline.event.appointment_scheduled',
  sms_sent: 'cases.timeline.event.sms_sent',
  appointment_attended: 'cases.timeline.event.appointment_attended',
  appointment_overdue: 'cases.timeline.event.appointment_overdue',
  appointment_missed: 'cases.timeline.event.appointment_missed',
  appointment_cancelled: 'cases.timeline.event.appointment_cancelled',
  followup_recorded: 'cases.timeline.event.followup_recorded',
  case_status_changed: 'cases.timeline.event.case_status_changed',
  case_transferred: 'cases.timeline.event.case_transferred',
  case_closed: 'cases.timeline.event.case_closed',
};

const MESSAGE_KIND_KEY: Record<string, string> = {
  reminder: 'cases.timeline.messageKind.reminder',
  follow_up: 'cases.timeline.messageKind.follow_up',
};

const DELIVERY_KEY: Record<string, string> = {
  queued: 'cases.timeline.delivery.queued',
  sent: 'cases.timeline.delivery.sent',
  failed: 'cases.timeline.delivery.failed',
  stubbed: 'cases.timeline.delivery.stubbed',
};

function displayDate(value: string | null): string {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString() : '';
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function statusKey(value: string): string {
  return `cases.status.${value === 'on_treatment' ? 'onTreatment' : value}`;
}

function EventDetail({ event }: { event: TimelineEventRow }) {
  const { t } = useTranslation();
  const d = event.detail ?? {};

  if (event.event_type === 'screening_recorded' && typeof d.referred === 'boolean') {
    return <span>{d.referred ? t('cases.timeline.referralRecommended') : t('cases.timeline.noReferralRecommended')}</span>;
  }
  if (event.event_type === 'referral_submitted' && asText(d.facility_short_code)) {
    return <span>{t('cases.timeline.destination', { code: asText(d.facility_short_code) })}</span>;
  }
  if (event.event_type === 'case_registered' && asText(d.case_number)) {
    return <span>{asText(d.case_number)}</span>;
  }
  if (event.event_type === 'case_status_changed') {
    const from = asText(d.from_status);
    const to = asText(d.to_status);
    if (from && to) return <span>{t('cases.timeline.statusChange', { from: t(statusKey(from)), to: t(statusKey(to)) })}</span>;
  }
  if (event.event_type === 'case_closed' && asText(d.outcome)) {
    const outcome = asText(d.outcome) as string;
    const key = outcome === 'treatment_completed' ? 'completed'
      : outcome === 'treatment_failed' ? 'failed'
        : outcome === 'lost_to_follow_up' ? 'lost'
          : outcome === 'not_evaluated' ? 'notEvaluated'
            : outcome;
    return <span>{t(`cases.outcome.${key}`)}</span>;
  }
  if (event.event_type === 'appointment_scheduled' && asText(d.scheduled_date)) {
    return <span>{t('cases.timeline.scheduledFor', { date: displayDate(asText(d.scheduled_date)) })}</span>;
  }
  if (event.event_type === 'sms_sent') {
    const kind = asText(d.message_kind);
    const delivery = asText(d.delivery_status);
    if (kind && delivery) return <span>{t('cases.timeline.smsDetail', {
      kind: t(MESSAGE_KIND_KEY[kind] ?? kind),
      status: t(DELIVERY_KEY[delivery] ?? delivery),
    })}</span>;
  }
  return null;
}

function TimelineEvent({ event }: { event: TimelineEventRow }) {
  const { t } = useTranslation();
  return (
    <article className={`timeline-event timeline-event--${event.event_type}`}>
      <div className="timeline-marker" aria-hidden="true" />
      <div className="timeline-event-body">
        <div className="timeline-event-head">
          <strong>{t(EVENT_KEY[event.event_type] ?? 'cases.timeline.event.other')}</strong>
          {event.occurred_on_is_derived ? <span className="timeline-derived">{t('cases.timeline.derived')}</span> : null}
        </div>
        <EventDetail event={event} />
        <div className="timeline-meta">
          {event.facility_name ? <span>{event.facility_name}</span> : null}
          {event.actor_role === 'system' ? <span>{t('cases.timeline.system')}</span>
            : event.actor_role ? <span>{t('cases.timeline.recordedByRole', { role: event.actor_role.replace('_', ' ') })}</span>
              : null}
        </div>
      </div>
      <time>{event.is_undated ? t('cases.timeline.dateUnknown') : displayDate(event.occurred_on)}</time>
    </article>
  );
}

export default function PatientTimeline({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<TimelineEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('patient_timeline', {
      p_patient_id: patientId,
      p_limit: LIMIT,
    });
    if (rpcError) {
      setError(rpcError.message);
      setEvents([]);
    } else {
      setEvents(Array.isArray(data) ? data as TimelineEventRow[] : []);
    }
    setLoading(false);
  }, [patientId]);

  useEffect(() => { void load(); }, [load]);

  const dated = useMemo(() => events.filter((event) => !event.is_undated), [events]);
  const undated = useMemo(() => events.filter((event) => event.is_undated), [events]);

  return (
    <section className="patient-timeline" aria-label={t('cases.timeline.title')}>
      <div className="patient-timeline-head">
        <div>
          <h3>{t('cases.timeline.title')}</h3>
          <p>{t('cases.timeline.privacy')}</p>
        </div>
        <button aria-label={t('common.refresh')} onClick={() => void load()} disabled={loading}>
          <span className="msym" aria-hidden="true">refresh</span>
        </button>
      </div>
      {error ? (
        <div className="case-list-state" role="alert">
          <strong>{t('cases.timeline.loadError')}</strong><span>{error}</span>
          <button onClick={() => void load()}>{t('inbox.retry')}</button>
        </div>
      ) : loading ? <p className="case-empty-line">{t('common.loading')}</p>
        : events.length === 0 ? <p className="case-empty-line">{t('cases.timeline.empty')}</p>
          : (
            <>
              <div className="timeline-list">{dated.map((event) => <TimelineEvent key={event.event_id} event={event} />)}</div>
              {undated.length > 0 ? (
                <div className="timeline-undated">
                  <h4>{t('cases.timeline.undatedTitle')}</h4>
                  <p>{t('cases.timeline.undatedHelp')}</p>
                  <div className="timeline-list">{undated.map((event) => <TimelineEvent key={event.event_id} event={event} />)}</div>
                </div>
              ) : null}
              {events.length === LIMIT ? <p className="timeline-limit">{t('cases.timeline.limit')}</p> : null}
            </>
          )}
    </section>
  );
}
