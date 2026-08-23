/**
 * BHW dashboard home (design 1a, screen 4):
 *   1. sync state as a calm tonal chip in the header (teal = synced,
 *      amber = pending/syncing, neutral = offline — never red, §7);
 *   2. a "needs attention" row of tonal stat cards (upcoming / missed /
 *      no-show) with big counts; tap a card to open the filtered follow-up list;
 *   3. one primary action — "Enroll & screen a patient" — as a large pill;
 *   4. new lab results.
 *
 * All data comes from the local cache (offline); the sync pull keeps it fresh.
 * First-launch gate: redirects to /welcome until the disclaimer is accepted.
 */
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Href, Redirect, useFocusEffect, useRouter } from 'expo-router';
import { Banner, Button, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DashboardAppointment,
  DashboardReferral,
  listMissedAppointments,
  listNoShowReferrals,
  listResultReferrals,
  listUpcomingAppointments,
} from '../../src/db/dashboardRepo';
import { useAppStore } from '../../src/store/appStore';
import { useSessionStore } from '../../src/store/sessionStore';
import { useSyncStore } from '../../src/store/syncStore';
import { triggerSync } from '../../src/sync/syncManager';
import { palette } from '../../src/ui/tokens';

type TileKey = 'upcoming' | 'missed' | 'noShow';

/** Tonal card colors per tile (design: teal / red / amber containers). */
const TILE_COLORS: Record<TileKey, { bg: string; num: string; label: string }> = {
  upcoming: { bg: palette.tealContainer, num: palette.tealDark, label: palette.tealDeep },
  missed: { bg: palette.redContainer, num: palette.red, label: palette.redDeep },
  noShow: { bg: palette.amberContainer, num: palette.amber, label: palette.amberInk },
};

export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const termsAcceptedAt = useAppStore((s) => s.termsAcceptedAt);
  const lastSyncAt = useAppStore((s) => s.lastSyncAt);
  const userId = useSessionStore((s) => s.userId);
  const sessionExpired = useSessionStore((s) => s.expired);
  const { isOnline, phase, lastError } = useSyncStore();

  const [upcoming, setUpcoming] = useState<DashboardAppointment[]>([]);
  const [missed, setMissed] = useState<DashboardAppointment[]>([]);
  const [noShows, setNoShows] = useState<DashboardReferral[]>([]);
  const [results, setResults] = useState<DashboardReferral[]>([]);

  const reload = useCallback(async () => {
    const [u, m, n, r] = await Promise.all([
      listUpcomingAppointments(),
      listMissedAppointments(),
      listNoShowReferrals(),
      listResultReferrals(),
    ]);
    setUpcoming(u);
    setMissed(m);
    setNoShows(n);
    setResults(r);
  }, []);

  // Refresh on focus AND whenever a sync pass finishes (phase flips to idle).
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload, phase]),
  );

  if (!termsAcceptedAt) {
    return <Redirect href="/welcome" />;
  }

  const counts: Record<TileKey, number> = {
    upcoming: upcoming.length,
    missed: missed.length,
    noShow: noShows.length,
  };
  const allClear = counts.upcoming + counts.missed + counts.noShow === 0;

  // Calm sync chip (design: teal = synced, amber = pending, neutral = offline).
  const syncChip = () => {
    if (phase === 'syncing')
      return {
        icon: 'cloud-upload' as const,
        label: t('home.syncChipSyncing'),
        bg: palette.amberContainer,
        fg: palette.amberInk,
        bd: palette.amberBorder,
      };
    if (isOnline === false)
      return {
        icon: 'cloud-off-outline' as const,
        label: t('home.syncChipOffline'),
        bg: palette.surfaceSubtle,
        fg: palette.inkSoft,
        bd: palette.border,
      };
    if (lastSyncAt)
      return {
        icon: 'cloud-check' as const,
        label: t('home.syncChipSynced'),
        bg: palette.tealContainer,
        fg: palette.tealDark,
        bd: palette.tealBorder,
      };
    return {
      icon: 'sync' as const,
      label: t('home.syncChipNever'),
      bg: palette.surfaceSubtle,
      fg: palette.inkSoft,
      bd: palette.border,
    };
  };
  const chip = syncChip();

  const openPatient = (patientId: string) => router.push(`/patients/${patientId}`);

  const rowCard = (key: string, title: string, description: string | undefined, icon: string, onPress: () => void) => (
    <Pressable
      key={key}
      onPress={onPress}
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
        <MaterialCommunityIcons name={icon as never} size={20} color={palette.tealDark} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="titleSmall" style={{ color: palette.ink }}>
          {title}
        </Text>
        {description ? (
          <Text variant="bodySmall" style={{ color: palette.muted }}>
            {description}
          </Text>
        ) : null}
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={palette.muted} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      {/* Header: app name + tappable sync chip. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 20,
          paddingTop: insets.top + 12,
          paddingBottom: 6,
        }}
      >
        <Text variant="titleLarge" style={{ color: palette.ink, fontWeight: '600', flex: 1 }}>
          {t('home.title')}
        </Text>
        <Pressable
          disabled={!userId || phase === 'syncing'}
          onPress={() => void triggerSync()}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            height: 34,
            paddingHorizontal: 12,
            borderRadius: 17,
            borderWidth: 1,
            borderColor: chip.bd,
            backgroundColor: chip.bg,
          }}
        >
          <MaterialCommunityIcons name={chip.icon} size={17} color={chip.fg} />
          <Text variant="labelMedium" style={{ color: chip.fg, fontWeight: '600' }}>
            {chip.label}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 32, gap: 14 }}>
        {/* Two different situations, two different messages: never signed in
            on this phone, vs. a session that ended on its own. The second one
            has to say the patients are still here — the list below it is. */}
        <Banner
          visible={!userId}
          icon={sessionExpired ? 'clock-alert-outline' : 'account-alert'}
          actions={[{ label: t('home.signInCta'), onPress: () => router.push('/sign-in') }]}
        >
          {sessionExpired ? t('home.sessionExpiredBanner') : t('home.signInBanner')}
        </Banner>

        {/* Offline note — calm, informational, never alarming (§7). */}
        {isOnline === false ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 12,
              backgroundColor: palette.surfaceSubtle,
            }}
          >
            <MaterialCommunityIcons name="cloud-off-outline" size={18} color={palette.muted} />
            <Text variant="bodySmall" style={{ color: palette.inkSoft, flex: 1, lineHeight: 18 }}>
              {t('home.neverSynced')}
            </Text>
          </View>
        ) : null}

        {/* Needs-attention stat cards (tonal, big counts). */}
        <Text
          variant="labelMedium"
          style={{ color: palette.muted, fontWeight: '700', letterSpacing: 0.8 }}
        >
          {t('home.attentionHeading').toUpperCase()}
        </Text>

        {allClear ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="check-circle-outline" size={22} color={palette.teal} />
            <Text variant="bodyMedium" style={{ flex: 1, color: palette.inkMid }}>
              {t('home.allCaughtUp')}
            </Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {(['upcoming', 'missed', 'noShow'] as TileKey[]).map((key) => {
              const colors = TILE_COLORS[key];
              return (
                <Pressable
                  key={key}
                  style={{ flex: 1 }}
                  disabled={counts[key] === 0}
                  // Cast: expo-router's generated route types only refresh on
                  // the next `expo start`, which doesn't know /follow-ups yet.
                  onPress={() => router.push(`/follow-ups?filter=${key}` as Href)}
                >
                  <View
                    style={{
                      borderRadius: 16,
                      paddingHorizontal: 12,
                      paddingVertical: 14,
                      minHeight: 96,
                      gap: 4,
                      backgroundColor: colors.bg,
                      opacity: counts[key] === 0 ? 0.45 : 1,
                    }}
                  >
                    <Text style={{ fontSize: 30, fontWeight: '700', color: colors.num }}>
                      {counts[key]}
                    </Text>
                    <Text
                      variant="bodySmall"
                      style={{ color: colors.label, fontWeight: '500', lineHeight: 16 }}
                    >
                      {t(`home.tiles.${key}`)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Primary action — the BHW's main job. */}
        <Button
          mode="contained"
          icon="plus-circle"
          contentStyle={{ height: 64 }}
          labelStyle={{ fontSize: 17, fontWeight: '600' }}
          style={{ borderRadius: 20, marginTop: 4 }}
          onPress={() => router.push('/patients/enroll')}
        >
          {t('home.primaryCta')}
        </Button>
        <Text variant="bodySmall" style={{ textAlign: 'center', color: palette.muted }}>
          {lastSyncAt
            ? t('home.lastSync', { date: new Date(lastSyncAt).toLocaleString() })
            : t('home.neverSynced')}
        </Text>
        {lastError ? (
          <Text variant="bodySmall" style={{ color: palette.red }}>
            {lastError.kind === 'offline'
              ? t('home.syncOffline')
              : t('home.syncError', { message: lastError.detail })}
          </Text>
        ) : null}

        <Text
          variant="labelMedium"
          style={{ color: palette.muted, fontWeight: '700', letterSpacing: 0.8, marginTop: 6 }}
        >
          {t('home.resultsSection').toUpperCase()}
        </Text>
        {results.length === 0 ? (
          <Text variant="bodySmall" style={{ color: palette.muted }}>
            {t('home.emptySection')}
          </Text>
        ) : (
          <View style={{ gap: 8 }}>
            {results.map((r) =>
              rowCard(
                r.referral_id,
                r.full_name ?? r.display_code,
                r.result_date
                  ? `${new Date(r.result_date).toLocaleDateString()} — ${r.result ?? ''}`
                  : (r.result ?? undefined),
                'file-check',
                () => openPatient(r.patient_id),
              ),
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
