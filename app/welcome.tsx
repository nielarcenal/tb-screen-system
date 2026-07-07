/**
 * First-launch flow (design 1a, screens 1–2):
 *   step 1 — language picker: large option cards, live app-wide switch;
 *   step 2 — non-diagnostic disclaimer (§1) + terms/data-privacy, accepted once.
 * On accept we record the timestamp and go to home. This screen is only
 * reachable when terms are not yet accepted (or after a dev reset).
 */
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useAppStore } from '../src/store/appStore';
import { AppLanguage } from '../src/i18n/languages';
import { palette } from '../src/ui/tokens';

const LANGUAGE_OPTIONS: { key: AppLanguage; native: string; sub: string; flag: string }[] = [
  { key: 'en', native: 'English', sub: 'English', flag: '🇺🇸' },
  { key: 'tl', native: 'Tagalog', sub: 'Filipino', flag: '🇵🇭' },
  { key: 'ceb', native: 'Cebuano', sub: 'Sinugboanon', flag: '🇵🇭' },
];

export default function WelcomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const acceptTerms = useAppStore((s) => s.acceptTerms);
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);

  const [step, setStep] = useState<'language' | 'terms'>('language');

  const onAccept = () => {
    acceptTerms();
    router.replace('/');
  };

  if (step === 'language') {
    return (
      <ScrollView
        style={{ backgroundColor: palette.background }}
        contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 64, paddingBottom: 28 }}
      >
        <View style={{ alignItems: 'center', gap: 14 }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 22,
              backgroundColor: palette.teal,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MaterialCommunityIcons name="hospital-box" size={38} color="#FFFFFF" />
          </View>
          <Text variant="headlineSmall" style={{ color: palette.ink, fontWeight: '600' }}>
            {t('common.appName')}
          </Text>
          <Text
            variant="bodyMedium"
            style={{ color: palette.inkSoft, textAlign: 'center', lineHeight: 21 }}
          >
            {t('welcome.tagline')}
          </Text>
        </View>

        <View style={{ marginTop: 40, gap: 14 }}>
          {LANGUAGE_OPTIONS.map((opt) => {
            const selected = language === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setLanguage(opt.key)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 16,
                  minHeight: 72,
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                  borderRadius: 16,
                  borderWidth: selected ? 2 : 1.5,
                  borderColor: selected ? palette.teal : palette.outline,
                  backgroundColor: selected ? palette.tealContainer : palette.paper,
                }}
              >
                <Text style={{ fontSize: 26 }}>{opt.flag}</Text>
                <View style={{ gap: 2 }}>
                  <Text variant="titleMedium" style={{ color: palette.ink, fontWeight: '600' }}>
                    {opt.native}
                  </Text>
                  <Text variant="bodySmall" style={{ color: palette.inkSoft }}>
                    {opt.sub}
                  </Text>
                </View>
                <View style={{ flex: 1 }} />
                <MaterialCommunityIcons
                  name="check-circle"
                  size={24}
                  color={selected ? palette.teal : 'transparent'}
                />
              </Pressable>
            );
          })}
        </View>

        <View style={{ flex: 1 }} />
        <Button
          mode="contained"
          onPress={() => setStep('terms')}
          contentStyle={{ height: 56 }}
          labelStyle={{ fontSize: 17, fontWeight: '600' }}
          style={{ marginTop: 32, borderRadius: 28 }}
        >
          {t('common.continue')}
        </Button>
        <Text
          variant="bodySmall"
          style={{ marginTop: 12, textAlign: 'center', color: palette.muted }}
        >
          {t('welcome.languageHint')}
        </Text>
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 28, gap: 16 }}>
        <Text variant="headlineSmall" style={{ color: palette.ink, fontWeight: '600' }}>
          {t('welcome.termsHeading')}
        </Text>

        {/* Non-diagnostic disclaimer — highlighted first (§1). */}
        <View
          style={{
            backgroundColor: palette.tealContainer,
            borderWidth: 1.5,
            borderColor: palette.teal,
            borderRadius: 16,
            padding: 18,
            flexDirection: 'row',
            gap: 14,
          }}
        >
          <MaterialCommunityIcons name="information" size={28} color={palette.tealDark} />
          <View style={{ flex: 1, gap: 6 }}>
            <Text variant="titleMedium" style={{ color: palette.tealDeep, fontWeight: '700' }}>
              {t('welcome.disclaimerHeading')}
            </Text>
            <Text variant="bodyMedium" style={{ color: palette.tealDeep, lineHeight: 21 }}>
              {t('welcome.disclaimerBody')}
            </Text>
          </View>
        </View>

        <View
          style={{
            backgroundColor: palette.paper,
            borderWidth: 1,
            borderColor: palette.border,
            borderRadius: 16,
            padding: 18,
            gap: 6,
          }}
        >
          <Text variant="titleMedium" style={{ color: palette.ink, fontWeight: '600' }}>
            {t('welcome.termsHeading')}
          </Text>
          <Text variant="bodyMedium" style={{ color: palette.inkMid, lineHeight: 22 }}>
            {t('welcome.termsBody')}
          </Text>
        </View>
      </ScrollView>

      <View
        style={{
          padding: 24,
          paddingTop: 14,
          backgroundColor: palette.background,
          borderTopWidth: 1,
          borderTopColor: palette.surfaceVariant,
        }}
      >
        <Button
          mode="contained"
          onPress={onAccept}
          contentStyle={{ height: 56 }}
          labelStyle={{ fontSize: 17, fontWeight: '600' }}
          style={{ borderRadius: 28 }}
        >
          {t('welcome.acceptCta')}
        </Button>
      </View>
    </View>
  );
}
