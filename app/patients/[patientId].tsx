/**
 * Patient record (design 1a, screen 9): identity card with avatar, referral
 * status shown as a 4-step timeline (submitted → received → tested → result),
 * screening history cards with flagged/not-flagged chips, check-up list, and
 * the "start screening" CTA. All read from the local cache (offline).
 *
 * POSITIONING (§1): screenings are shown as "flagged for referral" or "not
 * flagged" — never as a diagnosis or risk. PGI-S is displayed as supplementary
 * context only.
 */
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Appbar, Button, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { getLocalPatient } from '../../src/db/patientsRepo';
import { listScreeningsForPatient, LocalScreeningRow } from '../../src/db/screeningsRepo';
import { getReferralForScreening, LocalReferralRow } from '../../src/db/referralsRepo';
import { listAppointmentsForPatient } from '../../src/db/appointmentsRepo';
import { barangayLabel } from '../../src/db/psgcRepo';
import { AppointmentRow, LocalPatientRow, ReferralStatus } from '../../src/db/types';
import { palette, followUpChip, statusChip } from '../../src/ui/tokens';

const STATUS_ORDER: ReferralStatus[] = ['submitted', 'received', 'tested', 'closed'];

/** Small tonal chip. */
function TonalChip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 12,
        backgroundColor: bg,
        alignSelf: 'flex-start',
      }}
    >
      <Text variant="labelSmall" style={{ color: fg, fontWeight: '600' }}>
        {label}
      </Text>
    </View>
  );
}

/** Uppercased muted section label. */
function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      variant="labelMedium"
      style={{ color: palette.muted, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 }}
    >
      {children.toUpperCase()}
    </Text>
  );
}

export default function PatientDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { patientId } = useLocalSearchParams<{ patientId: string }>();

  const [patient, setPatient] = useState<LocalPatientRow | null>(null);
  const [screenings, setScreenings] = useState<LocalScreeningRow[]>([]);
  // Referral (if any) per screening_id — drives the per-screening action button.
  const [referrals, setReferrals] = useState<Record<string, LocalReferralRow | null>>({});
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [address, setAddress] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!patientId) return;
      void (async () => {
        const p = await getLocalPatient(patientId);
        setPatient(p);
        const s = p ? await listScreeningsForPatient(p.patient_id) : [];
        setScreenings(s);
        const pairs = await Promise.all(
          s.map(async (row) => [row.screening_id, await getReferralForScreening(row.screening_id)] as const),
        );
        setReferrals(Object.fromEntries(pairs));
        setAppointments(p ? await listAppointmentsForPatient(p.patient_id) : []);
        setAddress(p ? ((await barangayLabel(p.barangay_code)) ?? p.barangay_code) : '');
        setLoaded(true);
      })();
    }, [patientId]),
  );

  /** 4-step referral timeline (design: teal dots for done stages). */
  const timeline = (referral: LocalReferralRow) => {
    const doneIdx = STATUS_ORDER.indexOf(referral.status);
    return (
      <View
        style={{
          backgroundColor: palette.paper,
          borderWidth: 1,
          borderColor: palette.border,
          borderRadius: 16,
          padding: 18,
          paddingBottom: 4,
        }}
      >
        {STATUS_ORDER.map((st, i) => {
          const done = i <= doneIdx;
          const last = i === STATUS_ORDER.length - 1;
          return (
            <View key={st} style={{ flexDirection: 'row', gap: 14 }}>
              <View style={{ alignItems: 'center' }}>
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    backgroundColor: done ? palette.teal : palette.surfaceVariant,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialCommunityIcons
                    name={done ? 'check' : 'circle-small'}
                    size={15}
                    color={done ? '#FFFFFF' : palette.outline}
                  />
                </View>
                {!last ? (
                  <View
                    style={{
                      width: 2,
                      flex: 1,
                      minHeight: 16,
                      backgroundColor: i < doneIdx ? palette.teal : palette.surfaceVariant,
                    }}
                  />
                ) : null}
              </View>
              <View style={{ paddingBottom: 16 }}>
                <Text
                  variant="titleSmall"
                  style={{ color: done ? palette.ink : palette.muted, fontWeight: '600' }}
                >
                  {t(`status.${st}`)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const apptChip = (a: AppointmentRow) => {
    if (a.status === 'missed') return followUpChip.missed;
    return followUpChip.upcoming; // scheduled + attended both wear teal
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Appbar.Header style={{ backgroundColor: palette.background }}>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title={patient?.full_name ?? patient?.display_code ?? ''} />
      </Appbar.Header>

      {loaded && !patient ? (
        <Text variant="bodyMedium" style={{ padding: 16 }}>
          {t('patientDetail.notFound')}
        </Text>
      ) : patient ? (
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 6, paddingBottom: 32, gap: 16 }}>
          {/* Identity card. */}
          <View
            style={{
              backgroundColor: palette.paper,
              borderWidth: 1,
              borderColor: palette.border,
              borderRadius: 16,
              padding: 18,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                backgroundColor: palette.tealContainer,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {patient.full_name ? (
                <Text variant="titleMedium" style={{ color: palette.tealDark, fontWeight: '600' }}>
                  {patient.full_name
                    .trim()
                    .split(/\s+/)
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </Text>
              ) : (
                <MaterialCommunityIcons name="account" size={26} color={palette.tealDark} />
              )}
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text variant="titleMedium" style={{ color: palette.ink, fontWeight: '600' }}>
                {patient.full_name ?? patient.display_code}
              </Text>
              <Text variant="bodySmall" style={{ color: palette.muted }}>
                {patient.display_code} ·{' '}
                {t('patients.itemDescription', {
                  sex: t(`sex.${patient.sex}`),
                  age: patient.age,
                })}
                {' · '}
                {address}
                {patient.sitio ? ` · ${patient.sitio}` : ''}
              </Text>
              <Text variant="bodySmall" style={{ color: palette.muted }}>
                {t('patientDetail.smsLabel')}:{' '}
                {patient.sms_consent
                  ? t('patientDetail.smsOptedIn', { number: patient.contact_number ?? '' })
                  : t('patientDetail.smsDeclined')}
              </Text>
              <TonalChip
                label={
                  patient.sync_status === 'synced'
                    ? t('patientDetail.syncSynced')
                    : t('patientDetail.syncPending')
                }
                bg={patient.sync_status === 'synced' ? palette.tealContainer : palette.amberContainer}
                fg={patient.sync_status === 'synced' ? palette.tealDark : palette.amberInk}
              />
            </View>
          </View>

          {/* Screening history. */}
          <View>
            <SectionLabel>{t('patientDetail.screeningsSection')}</SectionLabel>
            {screenings.length === 0 ? (
              <Text variant="bodyMedium" style={{ color: palette.muted }}>
                {t('patientDetail.noScreenings')}
              </Text>
            ) : (
              <View style={{ gap: 10 }}>
                {screenings.map((s) => {
                  const referral = referrals[s.screening_id] ?? null;
                  const flagged = s.referred;
                  return (
                    <View key={s.screening_id} style={{ gap: 10 }}>
                      <View
                        style={{
                          backgroundColor: palette.paper,
                          borderWidth: 1,
                          borderColor: palette.border,
                          borderRadius: 14,
                          paddingHorizontal: 16,
                          paddingVertical: 14,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                        }}
                      >
                        <MaterialCommunityIcons
                          name="clipboard-text"
                          size={22}
                          color={palette.muted}
                        />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text variant="titleSmall" style={{ color: palette.ink }}>
                            {new Date(s.created_at).toLocaleString()}
                          </Text>
                          {s.pgis_severity ? (
                            <Text variant="bodySmall" style={{ color: palette.muted }}>
                              {t('patientDetail.pgisShort', {
                                value: t(`screening.pgisOptions.${s.pgis_severity}`),
                              })}
                            </Text>
                          ) : null}
                        </View>
                        <TonalChip
                          label={
                            flagged
                              ? t('patientDetail.flaggedChip')
                              : t('patientDetail.notFlaggedChip')
                          }
                          bg={flagged ? palette.tealContainer : palette.surfaceSubtle}
                          fg={flagged ? palette.tealDark : palette.inkSoft}
                        />
                      </View>

                      {/* Referral status + actions only for checklist-flagged screenings (§5). */}
                      {flagged ? (
                        <View style={{ gap: 10 }}>
                          {referral ? (
                            <>
                              {timeline(referral)}
                              {referral.presented === false ? (
                                <TonalChip
                                  label={t('patientDetail.noShowChip')}
                                  bg={followUpChip.noShow.bg}
                                  fg={followUpChip.noShow.fg}
                                />
                              ) : null}
                              {/* Lab result recorded by TB-DOTS staff — displayed, never computed (§1). */}
                              {referral.result ? (
                                <View
                                  style={{
                                    backgroundColor: statusChip.closed.bg,
                                    borderRadius: 14,
                                    paddingHorizontal: 16,
                                    paddingVertical: 12,
                                  }}
                                >
                                  <Text
                                    variant="bodyMedium"
                                    style={{ color: statusChip.closed.fg }}
                                  >
                                    {t('patientDetail.resultLine', {
                                      date: referral.result_date
                                        ? new Date(referral.result_date).toLocaleDateString()
                                        : '—',
                                      result: referral.result,
                                    })}
                                  </Text>
                                </View>
                              ) : null}
                              <Button
                                mode="outlined"
                                icon="file-document"
                                textColor={palette.teal}
                                onPress={() => router.push(`/specimen/${referral.referral_id}`)}
                                contentStyle={{ height: 48 }}
                                labelStyle={{ fontWeight: '600' }}
                                style={{ borderRadius: 24, borderColor: palette.teal }}
                              >
                                {t('patientDetail.viewSpecimen')}
                              </Button>
                            </>
                          ) : (
                            <Button
                              mode="contained-tonal"
                              icon="send"
                              onPress={() => router.push(`/referral/${s.screening_id}`)}
                              contentStyle={{ height: 48 }}
                              labelStyle={{ fontWeight: '600' }}
                              style={{ borderRadius: 24 }}
                            >
                              {t('patientDetail.createReferral')}
                            </Button>
                          )}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* Check-ups. */}
          {appointments.length > 0 ? (
            <View>
              <SectionLabel>{t('referral.appointmentSection')}</SectionLabel>
              <View style={{ gap: 8 }}>
                {appointments.map((a) => {
                  const chip = apptChip(a);
                  return (
                    <View
                      key={a.appointment_id}
                      style={{
                        backgroundColor: palette.paper,
                        borderWidth: 1,
                        borderColor: palette.border,
                        borderRadius: 14,
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <MaterialCommunityIcons name="calendar" size={22} color={palette.muted} />
                      <Text variant="titleSmall" style={{ color: palette.ink, flex: 1 }}>
                        {a.scheduled_date}
                      </Text>
                      <TonalChip
                        label={t(`patientDetail.appt.${a.status}`)}
                        bg={chip.bg}
                        fg={chip.fg}
                      />
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Primary action. */}
          <Button
            mode="contained"
            icon="clipboard-list"
            onPress={() => router.push(`/screening/${patient.patient_id}`)}
            contentStyle={{ height: 54 }}
            labelStyle={{ fontSize: 16, fontWeight: '600' }}
            style={{ borderRadius: 27 }}
          >
            {t('patientDetail.startScreening')}
          </Button>
        </ScrollView>
      ) : null}
    </View>
  );
}
