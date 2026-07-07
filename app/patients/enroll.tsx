/**
 * Patient enrollment (Feature 5, brief §8.5) — styled per design 1a screen 6:
 * sex as pill toggles, address card with a teal "pre-filled" note, teal
 * consent card + white SMS card (ConsentFields), and a pill CTA that stays
 * disabled until the form is valid.
 *
 * PRIVACY (§4): no name field by design — the record is identified by a
 * generated display_code (PAT-<device>-<seq>). The contact number is stored
 * ONLY when the patient opts into SMS reminders (ConsentFields enforces the
 * field visibility; we store null otherwise). Declining SMS never blocks
 * enrollment — only the general pre-screening consent is required.
 *
 * Address (§6): the cascade pre-fills from the BHW's assigned barangay but
 * stays editable per patient; barangay_code is stored on the patient record
 * independently of the setting. Sitio is free text, never used for matching.
 *
 * Requires a signed-in user: enrolled_by must equal auth.uid for the server
 * RLS insert policy.
 */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Appbar, Banner, Button, HelperText, Text, TextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import AddressCascade, {
  AddressSelection,
  emptyAddress,
} from '../../src/components/AddressCascade';
import ConsentFields, {
  ConsentValue,
  emptyConsent,
  isValidPhMobile,
} from '../../src/components/ConsentFields';
import { insertLocalPatient } from '../../src/db/patientsRepo';
import { cascadeForBarangay } from '../../src/db/psgcRepo';
import { Sex } from '../../src/db/types';
import { nowIso, uuid } from '../../src/lib/uuid';
import { useAppStore } from '../../src/store/appStore';
import { useSessionStore } from '../../src/store/sessionStore';
import { triggerSync } from '../../src/sync/syncManager';
import { palette } from '../../src/ui/tokens';

/** Pill toggle for sex selection (design: filled teal when selected). */
function SexPill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        height: 52,
        borderRadius: 26,
        borderWidth: selected ? 0 : 1.5,
        borderColor: palette.outline,
        backgroundColor: selected ? palette.teal : palette.paper,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        variant="titleSmall"
        style={{ color: selected ? '#FFFFFF' : palette.inkMid, fontWeight: '600' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function EnrollScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const userId = useSessionStore((s) => s.userId);
  const assignedBarangayCode = useAppStore((s) => s.assignedBarangayCode);
  const allocateDisplayCode = useAppStore((s) => s.allocateDisplayCode);

  const [age, setAge] = useState('');
  const [sex, setSex] = useState<Sex | null>(null);
  const [address, setAddress] = useState<AddressSelection>(emptyAddress);
  const [sitio, setSitio] = useState('');
  const [consent, setConsent] = useState<ConsentValue>(emptyConsent);
  const [saving, setSaving] = useState(false);

  // Pre-fill the cascade from the BHW's assigned barangay (§6) — editable.
  useEffect(() => {
    if (!assignedBarangayCode) return;
    void cascadeForBarangay(assignedBarangayCode).then((sel) => {
      if (sel) setAddress(sel);
    });
  }, [assignedBarangayCode]);

  const ageNum = Number(age);
  const ageValid = age.trim() !== '' && Number.isInteger(ageNum) && ageNum >= 0 && ageNum < 130;
  const contactValid = !consent.smsOptIn || isValidPhMobile(consent.contactNumber);
  const canSave =
    !!userId &&
    consent.consentGiven &&
    ageValid &&
    sex !== null &&
    !!address.barangayCode &&
    contactValid &&
    !saving;

  const save = async () => {
    if (!canSave || !userId || !sex || !address.barangayCode) return;
    setSaving(true);
    try {
      const patientId = uuid();
      await insertLocalPatient({
        patient_id: patientId,
        display_code: allocateDisplayCode(),
        enrolled_by: userId,
        age: ageNum,
        sex,
        barangay_code: address.barangayCode,
        sitio: sitio.trim() || null,
        // Privacy §4: number stored only with SMS consent.
        contact_number: consent.smsOptIn ? consent.contactNumber.trim() : null,
        sms_consent: consent.smsOptIn,
        consent_date: nowIso(),
      });
      void triggerSync(); // best-effort; row stays queued if offline
      router.replace(`/patients/${patientId}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Appbar.Header style={{ backgroundColor: palette.background }}>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title={t('enroll.title')} />
      </Appbar.Header>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 16 }}>
        <Banner
          visible={!userId}
          icon="account-alert"
          actions={[{ label: t('enroll.goToSignIn'), onPress: () => router.push('/sign-in') }]}
        >
          {t('enroll.signInRequired')}
        </Banner>

        <Text variant="bodyMedium" style={{ color: palette.inkSoft }}>
          {t('enroll.intro')}
        </Text>
        <Text variant="bodySmall" style={{ color: palette.muted }}>
          {t('enroll.requiredHint')}
        </Text>

        {/* Patient details. */}
        <View style={{ gap: 12 }}>
          <TextInput
            label={`${t('enroll.ageLabel')} *`}
            value={age}
            onChangeText={setAge}
            keyboardType="number-pad"
            mode="outlined"
            error={age.trim() !== '' && !ageValid}
            style={{ backgroundColor: palette.paper }}
          />
          <HelperText type="error" visible={age.trim() !== '' && !ageValid}>
            {t('enroll.ageError')}
          </HelperText>
          <Text variant="labelLarge" style={{ color: palette.inkMid }}>
            {`${t('enroll.sexLabel')} *`}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <SexPill
              label={t('sex.male')}
              selected={sex === 'male'}
              onPress={() => setSex('male')}
            />
            <SexPill
              label={t('sex.female')}
              selected={sex === 'female'}
              onPress={() => setSex('female')}
            />
          </View>
        </View>

        {/* Address — card with the teal "pre-filled" note. */}
        <View>
          <Text
            variant="labelMedium"
            style={{
              color: palette.muted,
              fontWeight: '700',
              letterSpacing: 0.8,
              marginBottom: 8,
            }}
          >
            {`${t('enroll.addressSection')} *`.toUpperCase()}
          </Text>
          <View
            style={{
              backgroundColor: palette.paper,
              borderWidth: 1,
              borderColor: palette.border,
              borderRadius: 16,
              padding: 16,
              gap: 12,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                backgroundColor: palette.tealContainer,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 8,
              }}
            >
              <MaterialCommunityIcons name="map-marker" size={17} color={palette.tealDark} />
              <Text
                variant="bodySmall"
                style={{ color: palette.tealDark, flex: 1, lineHeight: 17 }}
              >
                {t('enroll.addressHint')}
              </Text>
            </View>
            <AddressCascade value={address} onChange={setAddress} />
            <TextInput
              label={t('address.sitio')}
              value={sitio}
              onChangeText={setSitio}
              mode="outlined"
              style={{ backgroundColor: palette.paper }}
            />
          </View>
        </View>

        {/* Consent + SMS cards. */}
        <ConsentFields value={consent} onChange={setConsent} />

        <HelperText type="info" visible={!canSave && !saving}>
          {t('enroll.missingFields')}
        </HelperText>
        <View style={{ paddingBottom: 32 }}>
          <Button
            mode="contained"
            onPress={save}
            disabled={!canSave}
            loading={saving}
            contentStyle={{ height: 56 }}
            labelStyle={{ fontSize: 17, fontWeight: '600' }}
            style={{ borderRadius: 28 }}
          >
            {t('enroll.saveCta')}
          </Button>
        </View>
      </ScrollView>
    </View>
  );
}
