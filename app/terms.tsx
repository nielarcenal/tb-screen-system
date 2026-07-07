/**
 * Read-only view of the terms + non-diagnostic disclaimer, reachable from
 * Settings after first-launch acceptance (brief §8, F3). Styled to match the
 * onboarding terms step (design 1a, screen 2).
 */
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Appbar, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useAppStore } from '../src/store/appStore';
import { palette } from '../src/ui/tokens';

export default function TermsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const termsAcceptedAt = useAppStore((s) => s.termsAcceptedAt);

  const acceptedLine = termsAcceptedAt
    ? t('terms.acceptedOn', { date: new Date(termsAcceptedAt).toLocaleString() })
    : t('terms.notAccepted');

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Appbar.Header style={{ backgroundColor: palette.background }}>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title={t('terms.title')} />
      </Appbar.Header>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
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

        <Text variant="bodySmall" style={{ color: palette.muted }}>
          {acceptedLine}
        </Text>
      </ScrollView>
    </View>
  );
}
