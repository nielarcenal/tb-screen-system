import type {
  AppointmentRow,
  PatientRow,
  TbCaseRow,
  TreatmentFollowupRow,
} from './types';

export type CaseFilter =
  | 'all'
  | 'active'
  | 'closed'
  | 'followup_due'
  | 'overdue'
  | 'due_soon'
  | 'appointments_today'
  | 'stale'
  | 'missed';
export type CaseAttention = 'interrupted' | 'missed' | 'due' | null;

export interface CaseRegistryItem {
  tbCase: TbCaseRow;
  patient: PatientRow | null;
  followups: TreatmentFollowupRow[];
  appointments: AppointmentRow[];
  latestFollowup: TreatmentFollowupRow | null;
  nextAppointment: AppointmentRow | null;
  attention: CaseAttention;
}

export function isActiveCase(tbCase: TbCaseRow): boolean {
  return ['registered', 'on_treatment', 'interrupted'].includes(tbCase.case_status);
}

function shiftIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A later scheduled or attended visit means staff have acted on the missed
 * appointment, so the old assertion stays in history but leaves the queue. */
export function hasUnresolvedMissedAppointment(item: CaseRegistryItem): boolean {
  return item.appointments.some(
    (missed) => missed.status === 'missed'
      && !item.appointments.some(
        (later) => later.scheduled_date > missed.scheduled_date
          && (later.status === 'scheduled' || later.status === 'attended'),
      ),
  );
}

export function isStaleCase(item: CaseRegistryItem, today: string): boolean {
  const cutoff = shiftIsoDate(today, -30);
  return isActiveCase(item.tbCase)
    && item.tbCase.registration_date < cutoff
    && !item.followups.some((row) => !row.voided_at && row.visit_date >= cutoff);
}

/** Join already-RLS-scoped case rows with their children without inventing a
 * clinical score. Attention is made only from recorded operational facts. */
export function buildCaseRegistry(
  cases: readonly TbCaseRow[],
  patients: readonly PatientRow[],
  followups: readonly TreatmentFollowupRow[],
  appointments: readonly AppointmentRow[],
  today: string,
): CaseRegistryItem[] {
  const patientById = new Map(patients.map((patient) => [patient.patient_id, patient]));

  return cases.map((tbCase) => {
    const caseFollowups = followups
      .filter((row) => row.case_id === tbCase.case_id)
      .sort((a, b) => b.visit_date.localeCompare(a.visit_date));
    const liveFollowups = caseFollowups.filter((row) => !row.voided_at);
    const caseAppointments = appointments
      .filter((row) => row.tb_case_id === tbCase.case_id)
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
    const operationallyActive = isActiveCase(tbCase);
    const missed = operationallyActive && caseAppointments.some(
      (row) => row.status === 'missed'
        && !caseAppointments.some(
          (later) => later.scheduled_date > row.scheduled_date
            && (later.status === 'scheduled' || later.status === 'attended'),
        ),
    );
    const due = operationallyActive && caseAppointments.some(
      (row) => row.status === 'scheduled' && row.scheduled_date <= today,
    );
    const nextAppointment =
      caseAppointments.find(
        (row) => row.status === 'scheduled' && row.scheduled_date >= today,
      ) ?? null;

    return {
      tbCase,
      patient: patientById.get(tbCase.patient_id) ?? null,
      followups: caseFollowups,
      appointments: caseAppointments,
      latestFollowup: liveFollowups[0] ?? null,
      nextAppointment,
      attention:
        tbCase.case_status === 'interrupted' ? 'interrupted' : missed ? 'missed' : due ? 'due' : null,
    };
  });
}

export function caseMatchesFilter(
  item: CaseRegistryItem,
  filter: CaseFilter,
  today: string,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return isActiveCase(item.tbCase);
  if (filter === 'closed') return item.tbCase.case_status === 'closed';
  if (filter === 'followup_due') {
    return isActiveCase(item.tbCase) && item.appointments.some(
      (row) => row.status === 'scheduled' && row.scheduled_date <= today,
    );
  }
  if (filter === 'overdue') {
    return isActiveCase(item.tbCase) && item.appointments.some(
      (row) => row.status === 'scheduled' && row.scheduled_date < today,
    );
  }
  if (filter === 'due_soon') {
    const tomorrow = shiftIsoDate(today, 1);
    const horizon = shiftIsoDate(today, 7);
    return isActiveCase(item.tbCase) && item.appointments.some(
      (row) => row.status === 'scheduled'
        && row.scheduled_date >= tomorrow
        && row.scheduled_date <= horizon,
    );
  }
  if (filter === 'appointments_today') {
    return isActiveCase(item.tbCase) && item.appointments.some(
      (row) => row.status === 'scheduled' && row.scheduled_date === today,
    );
  }
  if (filter === 'stale') return isStaleCase(item, today);
  return isActiveCase(item.tbCase) && hasUnresolvedMissedAppointment(item);
}
