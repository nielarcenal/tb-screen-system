/**
 * Specimen referral form (Feature 6): on-screen summary + QR, and "Print /
 * save PDF" via expo-print (the Android print dialog offers Save as PDF).
 *
 * The QR is rendered once by react-native-qrcode-svg; for printing, its PNG
 * data-URL is embedded into the HTML from src/domain/specimenForm.ts.
 *
 * NOTE (schema): appointments have no FK to referrals (brief §4), so the form
 * shows the patient's most recent 'scheduled' appointment — correct for the
 * create-referral flow, which makes exactly one. Flagged as a possible later
 * migration (appointments.referral_id).
 *
 * PRIVACY: no contact number on the form or in the QR (see specimenForm.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Appbar, Button, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-native-qrcode-svg';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { listAppointmentsForPatient } from '../../src/db/appointmentsRepo';
import { getFacility } from '../../src/db/facilitiesRepo';
import { getLocalPatient } from '../../src/db/patientsRepo';
import { getReferral } from '../../src/db/referralsRepo';
import { getScreening } from '../../src/db/screeningsRepo';
import { barangayLabel } from '../../src/db/psgcRepo';
import {
  buildQrPayload,
  buildSpecimenHtml,
  SpecimenData,
} from '../../src/domain/specimenForm';
import { nowIso } from '../../src/lib/uuid';
import { useSessionStore } from '../../src/store/sessionStore';
import { palette } from '../../src/ui/tokens';

/** The subset of the react-native-qrcode-svg ref we use. */
interface QrRef {
  toDataURL: (cb: (base64: string) => void) => void;
}

export default function SpecimenFormScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { referralId } = useLocalSearchParams<{ referralId: string }>();
  const bhwName = useSessionStore((s) => s.fullName);

  const [data, setData] = useState<SpecimenData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const qrRef = useRef<QrRef | null>(null);

  useEffect(() => {
    if (!referralId) return;
    void (async () => {
      const referral = await getReferral(referralId);
      if (!referral) {
        setLoaded(true);
        return;
      }
      const [screening, patient, facility] = await Promise.all([
        getScreening(referral.screening_id),
        getLocalPatient(referral.patient_id),
        getFacility(referral.facility_id),
      ]);
      if (!screening || !patient) {
        setLoaded(true);
        return;
      }
      const appointments = await listAppointmentsForPatient(patient.patient_id);
      const nextScheduled = appointments.find((a) => a.status === 'scheduled') ?? null;
      setData({
        referralId: referral.referral_id,
        screeningId: screening.screening_id,
        patientId: patient.patient_id,
        specimenId: referral.specimen_id,
        displayCode: patient.display_code,
        patientName: patient.full_name,
        age: patient.age,
        sex: patient.sex,
        barangayCode: patient.barangay_code,
        barangayLabel: (await barangayLabel(patient.barangay_code)) ?? patient.barangay_code,
        sitio: patient.sitio,
        flags: screening.symptom_flags,
        pgis: screening.pgis_severity,
        screeningDate: screening.created_at,
        facilityName: facility?.name ?? referral.facility_id,
        facilityAddress: facility?.address ?? null,
        appointmentDate: nextScheduled?.scheduled_date ?? null,
        bhwName,
        generatedAt: nowIso(),
      });
      setLoaded(true);
    })();
  }, [referralId, bhwName]);

  const print = () => {
    if (!data || !qrRef.current) return;
    setPrintError(null);
    qrRef.current.toDataURL((base64) => {
      const html = buildSpecimenHtml(data, `data:image/png;base64,${base64}`, t);
      Print.printAsync({ html }).catch((e: unknown) => {
        // User-cancelled print dialogs also reject on some devices; show softly.
        setPrintError(e instanceof Error ? e.message : String(e));
      });
    });
  };

  /** Render the form to a PDF file and hand it to the OS share sheet. */
  const share = () => {
    if (!data || !qrRef.current) return;
    setPrintError(null);
    qrRef.current.toDataURL((base64) => {
      const html = buildSpecimenHtml(data, `data:image/png;base64,${base64}`, t);
      void (async () => {
        try {
          const { uri } = await Print.printToFileAsync({ html });
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, {
              mimeType: 'application/pdf',
              dialogTitle: t('specimen.title'),
            });
          }
        } catch (e) {
          setPrintError(e instanceof Error ? e.message : String(e));
        }
      })();
    });
  };

  /** One "Label: value" row on the paper form. */
  const formRow = (label: string, value: string, mono = false) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 2 }}>
      <Text variant="bodySmall" style={{ color: palette.muted }}>
        {label}
      </Text>
      <Text
        variant="bodySmall"
        style={{
          color: palette.ink,
          fontWeight: '700',
          flexShrink: 1,
          textAlign: 'right',
          fontFamily: mono ? 'monospace' : undefined,
        }}
      >
        {value}
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Appbar.Header style={{ backgroundColor: palette.background }}>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title={t('specimen.title')} />
      </Appbar.Header>

      {loaded && !data ? (
        <Text variant="bodyMedium" style={{ padding: 16 }}>
          {t('specimen.notFound')}
        </Text>
      ) : data ? (
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 14 }}>
          <Text
            variant="labelMedium"
            style={{ color: palette.muted, fontWeight: '700', letterSpacing: 0.8 }}
          >
            {t('specimen.heading').toUpperCase()}
          </Text>

          {/* Paper-look form preview (design 1d: black on white, no tints). */}
          <View
            style={{
              backgroundColor: '#FFFFFF',
              borderWidth: 1,
              borderColor: palette.outline,
              borderRadius: 8,
              padding: 18,
              elevation: 2,
            }}
          >
            {/* Header block with strong rule. */}
            <View
              style={{
                borderBottomWidth: 2,
                borderBottomColor: palette.ink,
                paddingBottom: 8,
                gap: 2,
              }}
            >
              <Text variant="titleSmall" style={{ color: palette.ink, fontWeight: '700' }}>
                {t('specimen.heading')}
              </Text>
              <Text variant="bodySmall" style={{ color: palette.inkSoft }}>
                {data.facilityAddress
                  ? `${data.facilityName} — ${data.facilityAddress}`
                  : data.facilityName}
              </Text>
              <Text
                variant="bodySmall"
                style={{ color: palette.inkSoft, fontFamily: 'monospace' }}
              >
                {data.specimenId ?? '—'}
              </Text>
            </View>

            {/* Patient block. */}
            <View
              style={{
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: palette.border,
                gap: 2,
              }}
            >
              {data.patientName
                ? formRow(t('enroll.fullNameLabel'), data.patientName)
                : null}
              {formRow(t('specimen.patientCode'), data.displayCode, true)}
              {formRow(
                t('patientDetail.ageSex'),
                t('patients.itemDescription', { sex: t(`sex.${data.sex}`), age: data.age }),
              )}
              {formRow(t('address.barangay'), data.barangayLabel)}
              {data.sitio ? formRow(t('address.sitio'), data.sitio) : null}
            </View>

            {/* Appointment block. */}
            <View
              style={{
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: palette.border,
                gap: 2,
              }}
            >
              {formRow(t('specimen.appointment'), data.appointmentDate ?? '—')}
            </View>

            {/* QR + standing non-diagnosis note (§1). */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 16,
                paddingTop: 12,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text variant="bodySmall" style={{ color: palette.inkMid, lineHeight: 18 }}>
                  {t('specimen.qrCaption')}
                </Text>
                <Text
                  variant="labelSmall"
                  style={{ color: palette.muted, marginTop: 6, lineHeight: 14 }}
                >
                  {t('specimen.subheading')}
                </Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <QRCode
                  value={buildQrPayload(data)}
                  size={110}
                  getRef={(c) => {
                    qrRef.current = c as QrRef | null;
                  }}
                />
                <Text
                  variant="labelSmall"
                  style={{ marginTop: 4, color: palette.ink, fontFamily: 'monospace' }}
                >
                  {data.displayCode}
                </Text>
              </View>
            </View>
          </View>

          {printError ? (
            <Text variant="bodySmall" style={{ color: palette.red }}>
              {t('specimen.printError', { message: printError })}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 12, paddingBottom: 32 }}>
            <Button
              mode="outlined"
              icon="printer"
              onPress={print}
              textColor={palette.teal}
              contentStyle={{ height: 52 }}
              labelStyle={{ fontWeight: '600' }}
              style={{ flex: 1, borderRadius: 26, borderColor: palette.teal }}
            >
              {t('specimen.printCta')}
            </Button>
            <Button
              mode="outlined"
              icon="share-variant"
              onPress={share}
              textColor={palette.teal}
              contentStyle={{ height: 52 }}
              labelStyle={{ fontWeight: '600' }}
              style={{ flex: 1, borderRadius: 26, borderColor: palette.teal }}
            >
              {t('specimen.shareCta')}
            </Button>
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}
