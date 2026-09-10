import type {
  AppointmentRow,
  PatientRow,
  TbCaseRow,
  TreatmentFollowupRow,
} from './types';

export type CaseFilter = 'all' | 'active' | 'closed' | 'followup_due' | 'missed';
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
    const missed = operationallyActive && caseAppointments.some((row) => row.status === 'missed');
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
  return isActiveCase(item.tbCase)
    && item.appointments.some((row) => row.status === 'missed');
}
