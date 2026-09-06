/**
 * Follow-up list (design 1a, screen 10): the three follow-up states as filter
 * pills — upcoming / missed check-ups and did-not-present referrals — reached
 * from the home stat cards (which pass the initial filter). All data from the
 * local cache (offline); rows open the patient record.
 */
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Appbar, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import {
  DashboardAppointment,
  DashboardReferral,
  listMissedAppointments,
  listNoShowReferrals,
  listUpcomingAppointments,
} from '../src/db/dashboardRepo';
import { followUpChip, palette } from '../src/ui/tokens';

type FilterKey = 'upcoming' | 'missed' | 'noShow';
const FILTERS: FilterKey[] = ['upcoming', 'missed', 'noShow'];

export default function FollowUpsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { filter: initialFilter } = useLocalSearchParams<{ filter?: string }>();

  const [filter, setFilter] = useState<FilterKey>(
    FILTERS.includes(initialFilter as FilterKey) ? (initialFilter as FilterKey) : 'upcoming',
  );
  const [upcoming, setUpcoming] = useState<DashboardAppointment[]>([]);
  const [missed, setMissed] = useState<DashboardAppointment[]>([]);
  const [noShows, setNoShows] = useState<DashboardReferral[]>([]);

  useFocusEffect(
    useCallback(() => {
      void Promise.all([
        listUpcomingAppointments(),
        listMissedAppointments(),
        listNoShowReferrals(),
      ]).then(([u, m, n]) => {
        setUpcoming(u);
        setMissed(m);
        setNoShows(n);
      });
    }, []),
  );

  const chip = followUpChip[filter];

  const rows: { key: string; patientId: string; title: string; sub: string }[] =
    filter === 'noShow'
      ? noShows.map((r) => ({
          key: r.referral_id,
          patientId: r.patient_id,
          title: r.full_name ?? r.display_code,
          // The sub-line used to fall back to the specimen id when a pre-0006
          // row had no name. That id is now the facility's (0024) and is null
          // on everything this device created, so the patient code — which
          // always exists — carries the line instead.
          sub: r.full_name ? r.display_code : '',
        }))
      : (filter === 'upcoming' ? upcoming : missed).map((a) => ({
          key: a.appointment_id,
          patientId: a.patient_id,
          title: a.full_name ?? a.display_code,
          sub: a.full_name ? `${a.display_code} · ${a.scheduled_date}` : a.scheduled_date,
        }));

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Appbar.Header style={{ backgroundColor: palette.background }}>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title={t('followUps.title')} />
      </Appbar.Header>

      {/* Filter pills. */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20 }}>
        {FILTERS.map((k) => {
          const on = filter === k;
          return (
            <Pressable
              key={k}
              onPress={() => setFilter(k)}
              style={{
                flex: 1,
                height: 44,
                borderRadius: 22,
                borderWidth: on ? 0 : 1.5,
                borderColor: palette.outline,
                backgroundColor: on ? palette.teal : palette.paper,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                variant="labelMedium"
                style={{ color: on ? '#FFFFFF' : palette.inkMid, fontWeight: '600' }}
              >
                {t(`home.tiles.${k}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 16, gap: 8 }}>
        {rows.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 48, gap: 10 }}>
            <MaterialCommunityIcons name="check-all" size={44} color={palette.outline} />
            <Text variant="titleSmall" style={{ color: palette.inkMid, fontWeight: '600' }}>
              {t('followUps.empty')}
            </Text>
            <Text
              variant="bodySmall"
              style={{ color: palette.muted, textAlign: 'center', lineHeight: 19 }}
            >
              {t('followUps.emptySub')}
            </Text>
          </View>
        ) : (
          rows.map((r) => (
            <Pressable
              key={r.key}
              onPress={() => router.push(`/patients/${r.patientId}`)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                minHeight: 68,
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
                <MaterialCommunityIcons name="account" size={22} color={palette.tealDark} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="titleSmall" style={{ color: palette.ink }}>
                  {r.title}
                </Text>
                {r.sub ? (
                  <Text variant="bodySmall" style={{ color: palette.muted }}>
                    {r.sub}
                  </Text>
                ) : null}
              </View>
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 12,
                  backgroundColor: chip.bg,
                }}
              >
                <Text variant="labelSmall" style={{ color: chip.fg, fontWeight: '600' }}>
                  {t(`home.tiles.${filter}`)}
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}
