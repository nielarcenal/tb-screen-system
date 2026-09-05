/**
 * Create referral (Feature 6). Reached ONLY from a screening the DOH-NTP
 * checklist flagged (§5) — if the screening isn't flagged, or already has a
 * referral, this screen says so instead of offering the form.
 *
 * Creates, fully offline, in the local cache (both queue for push):
 *  - an appointment (status 'scheduled') for the chosen check-up date, and
 *  - the referral (status 'submitted') with a generated specimen id,
 * then moves to the printable specimen form.
 */
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Appbar,
  Button,
  Chip,
  HelperText,
  RadioButton,
  Text,
  TextInput,
} from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { DatePickerModal } from 'react-native-paper-dates';

import { insertLocalAppointment } from '../../src/db/appointmentsRepo';
import { listTbDotsFacilities } from '../../src/db/facilitiesRepo';
import { getLocalPatient } from '../../src/db/patientsRepo';
import { getReferralForScreening, insertLocalReferral } from '../../src/db/referralsRepo';
import { defaultFacilityForBarangay } from '../../src/db/psgcRepo';
import { getScreening, LocalScreeningRow } from '../../src/db/screeningsRepo';
import { FacilityRow, LocalPatientRow } from '../../src/db/types';
import { toDateOnly } from '../../src/lib/dates';
import { uuid } from '../../src/lib/uuid';
import { useAppStore } from '../../src/store/appStore';
import { triggerSync } from '../../src/sync/syncManager';
import { palette } from '../../src/ui/tokens';

export default function CreateReferralScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { screeningId } = useLocalSearchParams<{ screeningId: string }>();
  const allocateSpecimenId = useAppStore((s) => s.allocateSpecimenId);

  const [screening, setScreening] = useState<LocalScreeningRow | null>(null);
  const [patient, setPatient] = useState<LocalPatientRow | null>(null);
  const [facilities, setFacilities] = useState<FacilityRow[]>([]);
  const [existingReferralId, setExistingReferralId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!screeningId) return;
    void (async () => {
      const s = await getScreening(screeningId);
      setScreening(s);
      setPatient(s ? await getLocalPatient(s.patient_id) : null);
      const existing = await getReferralForScreening(screeningId);
      setExistingReferralId(existing?.referral_id ?? null);
      const f = await listTbDotsFacilities();
      setFacilities(f);
      if (f.length === 1) {
        setFacilityId(f[0].facility_id); // only one choice
      } else if (s) {
        // Pre-select the nearest center for the patient's barangay (0009) —
        // a default only, freely changeable below.
        const p = await getLocalPatient(s.patient_id);
        const def = p ? await defaultFacilityForBarangay(p.barangay_code) : null;
        if (def && f.some((fac) => fac.facility_id === def)) setFacilityId(def);
      }
      setLoaded(true);
    })();
  }, [screeningId]);

  const canSave = !!screening && !!patient && !!facilityId && !!date && !saving;

  const save = async () => {
    if (!canSave || !screening || !patient || !facilityId || !date) return;
    setSaving(true);
    try {
      const referralId = uuid();
      // Appointment first, then referral — both land in the same push queue.
      await insertLocalAppointment({
        appointment_id: uuid(),
        patient_id: patient.patient_id,
        scheduled_date: toDateOnly(date),
        attended_date: null,
        status: 'scheduled',
      });
      await insertLocalReferral({
        referral_id: referralId,
        patient_id: patient.patient_id,
        screening_id: screening.screening_id,
        facility_id: facilityId,
        specimen_id: allocateSpecimenId(),
        status: 'submitted',
        result_outcome: null, // only a TB-DOTS facility ever records this
        result_date: null,
        presented: null,
      });
      void triggerSync(); // best-effort; rows stay queued if offline
      router.replace(`/specimen/${referralId}`);
    } finally {
      setSaving(false);
    }
  };

  const blocked = loaded && (!screening || !screening.referred || !!existingReferralId);

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Appbar.Header style={{ backgroundColor: palette.background }}>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title={t('referral.title')} />
      </Appbar.Header>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 14 }}>
        {patient && screening ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text variant="titleMedium">{patient.full_name ?? patient.display_code}</Text>
            <Chip compact mode="outlined">
              {t('referral.screeningSummary', {
                date: new Date(screening.created_at).toLocaleDateString(),
              })}
            </Chip>
          </View>
        ) : null}

        {blocked ? (
          <>
            <Text variant="bodyMedium">
              {existingReferralId ? t('referral.alreadyExists') : t('referral.notFlagged')}
            </Text>
            {existingReferralId ? (
              <Button
                mode="contained"
                icon="file-document"
                onPress={() => router.replace(`/specimen/${existingReferralId}`)}
              >
                {t('patientDetail.viewSpecimen')}
              </Button>
            ) : null}
          </>
        ) : loaded ? (
          <>
            <Text
              variant="labelMedium"
              style={{ color: palette.muted, fontWeight: '700', letterSpacing: 0.8 }}
            >
              {t('referral.facilitySection').toUpperCase()}
            </Text>
            {facilities.length === 0 ? (
              <HelperText type="error" visible>
                {t('referral.noFacilities')}
              </HelperText>
            ) : (
              <View
                style={{
                  backgroundColor: palette.paper,
                  borderWidth: 1,
                  borderColor: palette.border,
                  borderRadius: 16,
                  paddingVertical: 4,
                }}
              >
                <RadioButton.Group
                  value={facilityId ?? ''}
                  onValueChange={(v) => setFacilityId(v)}
                >
                  {facilities.map((f) => (
                    <RadioButton.Item
                      key={f.facility_id}
                      value={f.facility_id}
                      label={f.name}
                      position="leading"
                    />
                  ))}
                </RadioButton.Group>
              </View>
            )}

            <Text
              variant="labelMedium"
              style={{ color: palette.muted, fontWeight: '700', letterSpacing: 0.8, marginTop: 6 }}
            >
              {t('referral.appointmentSection').toUpperCase()}
            </Text>
            <HelperText type="info" visible style={{ paddingHorizontal: 0 }}>
              {t('referral.appointmentHint')}
            </HelperText>
            <TextInput
              mode="outlined"
              label={t('referral.pickDate')}
              value={date ? toDateOnly(date) : ''}
              editable={false}
              style={{ backgroundColor: palette.paper }}
              right={<TextInput.Icon icon="calendar" onPress={() => setPickerOpen(true)} />}
              onPressIn={() => setPickerOpen(true)}
            />
            <DatePickerModal
              locale={i18n.language}
              mode="single"
              visible={pickerOpen}
              date={date}
              validRange={{ startDate: new Date() }}
              onDismiss={() => setPickerOpen(false)}
              onConfirm={({ date: picked }) => {
                setPickerOpen(false);
                if (picked) setDate(picked);
              }}
            />

            <HelperText type="info" visible={!canSave && !saving}>
              {t('referral.missing')}
            </HelperText>
            <View style={{ paddingBottom: 32 }}>
              <Button
                mode="contained"
                onPress={save}
                disabled={!canSave}
                loading={saving}
                contentStyle={{ height: 56 }}
                labelStyle={{ fontSize: 16.5, fontWeight: '600' }}
                style={{ borderRadius: 28 }}
              >
                {t('referral.createCta')}
              </Button>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
