/**
 * Patients tab (design 1a, screen 4 list): searchable local patient list as
 * white row cards with initials avatar + tonal sync chip. Reads ONLY the local
 * cache — works fully offline. Names collected since 0006 (user sign-off);
 * pre-0006 rows fall back to the display code.
 */
import { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { FAB, Searchbar, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listLocalPatients } from '../../src/db/patientsRepo';
import { LocalPatientRow } from '../../src/db/types';
import { palette } from '../../src/ui/tokens';

export default function PatientsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [patients, setPatients] = useState<LocalPatientRow[]>([]);
  const [search, setSearch] = useState('');

  // Reload whenever the tab gains focus (after enroll / screening / sync).
  useFocusEffect(
    useCallback(() => {
      void listLocalPatients().then(setPatients);
    }, []),
  );

  const q = search.trim().toLowerCase();
  const visible = q
    ? patients.filter(
        (p) =>
          p.display_code.toLowerCase().includes(q) ||
          (p.full_name ?? '').toLowerCase().includes(q),
      )
    : patients;

  /** Up to two initials from the name (design avatars); null without a name. */
  const initials = (name: string | null) =>
    name
      ? name
          .trim()
          .split(/\s+/)
          .map((w) => w[0])
          .slice(0, 2)
          .join('')
          .toUpperCase()
      : null;

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <View style={{ paddingHorizontal: 20, paddingTop: insets.top + 12, paddingBottom: 6 }}>
        <Text variant="titleLarge" style={{ color: palette.ink, fontWeight: '600' }}>
          {t('patients.title')}
        </Text>
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
        <Searchbar
          placeholder={t('patients.searchPlaceholder')}
          value={search}
          onChangeText={setSearch}
          style={{ backgroundColor: palette.surfaceVariant, borderRadius: 26 }}
          inputStyle={{ color: palette.ink }}
          iconColor={palette.muted}
        />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(p) => p.patient_id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 96, gap: 8 }}
        renderItem={({ item }) => {
          const synced = item.sync_status === 'synced';
          return (
            <Pressable
              onPress={() => router.push(`/patients/${item.patient_id}`)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                minHeight: 64,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: palette.surfaceVariant,
                backgroundColor: palette.paper,
              }}
            >
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 21,
                  backgroundColor: palette.tealContainer,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {initials(item.full_name) ? (
                  <Text
                    variant="titleSmall"
                    style={{ color: palette.tealDark, fontWeight: '600' }}
                  >
                    {initials(item.full_name)}
                  </Text>
                ) : (
                  <MaterialCommunityIcons name="account" size={22} color={palette.tealDark} />
                )}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="titleSmall" style={{ color: palette.ink }}>
                  {item.full_name ?? item.display_code}
                </Text>
                <Text variant="bodySmall" style={{ color: palette.muted }}>
                  {item.display_code} ·{' '}
                  {t('patients.itemDescription', {
                    sex: t(`sex.${item.sex}`),
                    age: item.age,
                  })}
                </Text>
              </View>
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 12,
                  backgroundColor: synced ? palette.tealContainer : palette.amberContainer,
                }}
              >
                <Text
                  variant="labelSmall"
                  style={{
                    color: synced ? palette.tealDark : palette.amberInk,
                    fontWeight: '600',
                  }}
                >
                  {synced ? t('patientDetail.syncSynced') : t('patientDetail.syncPending')}
                </Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
            <MaterialCommunityIcons name="account-search" size={34} color={palette.outline} />
            <Text
              variant="bodyMedium"
              style={{ color: palette.muted, textAlign: 'center', paddingHorizontal: 16 }}
            >
              {q ? t('patients.noMatch') : t('patients.empty')}
            </Text>
          </View>
        }
      />

      <FAB
        icon="account-plus"
        label={t('patients.enrollCta')}
        color="#FFFFFF"
        style={{
          position: 'absolute',
          right: 16,
          bottom: 16,
          backgroundColor: palette.teal,
          borderRadius: 28,
        }}
        onPress={() => router.push('/patients/enroll')}
      />
    </View>
  );
}
