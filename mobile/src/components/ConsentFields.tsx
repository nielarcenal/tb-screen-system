/**
 * Reusable per-patient consent block (brief §3, §4), styled per the design's
 * consent + SMS cards: a teal "informed consent" card with a deliberate toggle
 * (never pre-checked), and a separate white SMS opt-in card.
 *
 * PRIVACY RULES enforced here (mirror the DB CHECK on patients):
 *  - The mobile-number field is shown ONLY when the patient opts into SMS
 *    reminders. Turning SMS off clears any entered number.
 *  - Declining SMS must NOT block enrollment — that is the caller's concern;
 *    this component simply keeps contactNumber empty when smsOptIn is false.
 *
 * This is a controlled component. The enrollment form (Feature 5) owns the state
 * and decides when enrollment may proceed (e.g. requires consentGiven).
 */
import { Pressable, View } from 'react-native';
import { HelperText, SegmentedButtons, Switch, Text, TextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { palette } from '../ui/tokens';

export type SmsLanguage = 'en' | 'tl' | 'ceb';

export interface ConsentValue {
  /** Patient consents to pre-screening + referral. */
  consentGiven: boolean;
  /** Patient opts into SMS check-up reminders. */
  smsOptIn: boolean;
  /** Only meaningful when smsOptIn is true; otherwise kept empty. */
  contactNumber: string;
  /** Language the patient's SMS reminders are sent in (only used when smsOptIn). */
  smsLanguage: SmsLanguage;
}

export const emptyConsent: ConsentValue = {
  consentGiven: false,
  smsOptIn: false,
  contactNumber: '',
  smsLanguage: 'en',
};

/** Coerce an app language code to a supported SMS language (default English). */
const asSmsLanguage = (l: string): SmsLanguage => (l === 'tl' || l === 'ceb' ? l : 'en');

interface Props {
  value: ConsentValue;
  onChange: (next: ConsentValue) => void;
}

/** Basic PH mobile sanity check (11 digits starting 09). Real validation later. */
export function isValidPhMobile(n: string): boolean {
  return /^09\d{9}$/.test(n.trim());
}

export default function ConsentFields({ value, onChange }: Props) {
  const { t, i18n } = useTranslation();

  const toggleSms = (smsOptIn: boolean) =>
    onChange({
      ...value,
      smsOptIn,
      // Privacy: no SMS opt-in ⇒ no stored number.
      contactNumber: smsOptIn ? value.contactNumber : '',
      // Default the reminder language to the app's current language on opt-in.
      smsLanguage: smsOptIn ? asSmsLanguage(i18n.language) : value.smsLanguage,
    });

  const showNumberError =
    value.smsOptIn && value.contactNumber.length > 0 && !isValidPhMobile(value.contactNumber);

  return (
    <View style={{ gap: 14 }}>
      {/* Informed consent — teal card, deliberate toggle, never pre-checked. */}
      <View
        style={{
          backgroundColor: palette.tealContainer,
          borderWidth: 1.5,
          borderColor: palette.tealBorder,
          borderRadius: 16,
          padding: 18,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <MaterialCommunityIcons name="handshake" size={24} color={palette.tealDark} />
          <Text variant="titleMedium" style={{ color: palette.tealDeep, fontWeight: '700' }}>
            {t('consent.heading')}
          </Text>
        </View>
        <Text
          variant="bodyMedium"
          style={{ marginTop: 8, color: palette.tealDeep, lineHeight: 22 }}
        >
          {t('consent.intro')}
        </Text>
        <Pressable
          onPress={() => onChange({ ...value, consentGiven: !value.consentGiven })}
          accessibilityRole="switch"
          accessibilityState={{ checked: value.consentGiven }}
          style={{
            marginTop: 14,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            minHeight: 52,
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 14,
            backgroundColor: palette.paper,
          }}
        >
          {/* Visual only: the row owns the press, so tapping the switch itself
              can't fire a second toggle that cancels the row's. */}
          <View pointerEvents="none">
            <Switch value={value.consentGiven} color={palette.teal} />
          </View>
          <Text
            variant="bodyMedium"
            style={{ color: palette.ink, fontWeight: '600', flex: 1 }}
          >
            {t('consent.confirmLabel')}
          </Text>
        </Pressable>
      </View>

      {/* SMS reminders — optional; enrolling without SMS is always allowed. */}
      <View
        style={{
          backgroundColor: palette.paper,
          borderWidth: 1,
          borderColor: palette.border,
          borderRadius: 16,
          padding: 18,
        }}
      >
        <Pressable
          onPress={() => toggleSms(!value.smsOptIn)}
          accessibilityRole="switch"
          accessibilityState={{ checked: value.smsOptIn }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 }}
        >
          <View pointerEvents="none">
            <Switch value={value.smsOptIn} color={palette.teal} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyLarge" style={{ color: palette.ink, fontWeight: '600' }}>
              {t('consent.smsOptInLabel')}
            </Text>
            <Text variant="bodySmall" style={{ color: palette.muted, lineHeight: 17 }}>
              {t('consent.smsHint')}
            </Text>
          </View>
        </Pressable>

        {/* Contact number field appears ONLY on SMS opt-in (privacy §4). */}
        {value.smsOptIn ? (
          <View style={{ marginTop: 14 }}>
            <TextInput
              label={t('consent.contactNumberLabel')}
              placeholder={t('consent.contactNumberPlaceholder')}
              value={value.contactNumber}
              onChangeText={(contactNumber) => onChange({ ...value, contactNumber })}
              keyboardType="phone-pad"
              mode="outlined"
              error={showNumberError}
              style={{ backgroundColor: palette.paper }}
            />
            <HelperText type="error" visible={showNumberError}>
              {t('consent.contactNumberError')}
            </HelperText>

            {/* Language for this patient's reminder texts (defaults to app language). */}
            <View style={{ marginTop: 8, gap: 8 }}>
              <Text variant="bodySmall" style={{ color: palette.muted }}>
                {t('consent.smsLanguageLabel')}
              </Text>
              <SegmentedButtons
                value={value.smsLanguage}
                onValueChange={(smsLanguage) =>
                  onChange({ ...value, smsLanguage: smsLanguage as SmsLanguage })
                }
                buttons={[
                  { value: 'en', label: 'English' },
                  { value: 'tl', label: 'Tagalog' },
                  { value: 'ceb', label: 'Bisaya' },
                ]}
              />
            </View>
          </View>
        ) : null}
      </View>

      <HelperText type="info" visible style={{ paddingHorizontal: 0 }}>
        {t('consent.nonDiagnosticReminder')}
      </HelperText>
    </View>
  );
}
