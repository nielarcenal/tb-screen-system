/**
 * Settings tab (design 1a, screen 5): language option cards with check marks,
 * assigned-barangay card (PSGC cascade, §6), account card + sign-out, legal
 * (re-view terms/disclaimer), developer helpers.
 *
 * Assigned barangay: saved locally at once (works offline) and pushed to the
 * BHW's own users row on the next sync (users_update_self RLS policy).
 */
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, HelperText, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../../src/lib/supabase';
import { useAppStore } from '../../src/store/appStore';
import { useSessionStore } from '../../src/store/sessionStore';
import { AppLanguage } from '../../src/i18n/languages';
import AddressCascade, {
  AddressSelection,
  emptyAddress,
} from '../../src/components/AddressCascade';
import { cascadeForBarangay } from '../../src/db/psgcRepo';
import { clearSyncableCache, countPendingRows } from '../../src/db/database';
import { triggerSync } from '../../src/sync/syncManager';
import { palette } from '../../src/ui/tokens';

const LANGUAGE_OPTIONS: { key: AppLanguage; native: string; flag: string }[] = [
  { key: 'en', native: 'English', flag: '🇺🇸' },
  { key: 'tl', native: 'Tagalog', flag: '🇵🇭' },
  { key: 'ceb', native: 'Cebuano', flag: '🇵🇭' },
];

/** Uppercased section label (design: small bold letterspaced muted). */
function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      variant="labelMedium"
      style={{ color: palette.muted, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10 }}
    >
      {children.toUpperCase()}
    </Text>
  );
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const resetTerms = useAppStore((s) => s.resetTerms);
  const assignedBarangayCode = useAppStore((s) => s.assignedBarangayCode);
  const assignedBarangayDirty = useAppStore((s) => s.assignedBarangayDirty);
  const setAssignedBarangay = useAppStore((s) => s.setAssignedBarangay);
  const { userId, email, beginSignOut, clearSession } = useSessionStore();

  const [address, setAddress] = useState<AddressSelection>(emptyAddress);
  // True while the pre-sign-out sync runs, so the button can't be tapped twice.
  const [signingOut, setSigningOut] = useState(false);

  // Pre-fill the cascade from the stored assigned barangay (if set).
  useEffect(() => {
    if (!assignedBarangayCode) return;
    void cascadeForBarangay(assignedBarangayCode).then((sel) => {
      if (sel) setAddress(sel);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * End the session and wipe the offline cache, so another account on the same
   * phone can never read the previous account's patients (the server scopes
   * each pull; the cache must not outlive the session that fetched it).
   *
   * Only ever called once we know nothing unsynced is about to be destroyed,
   * or once the BHW has explicitly agreed to discard it.
   */
  const performSignOut = async () => {
    beginSignOut(); // marks the SIGNED_OUT below as deliberate, not expiry
    // scope: 'local' ends THIS device's session only. The default ('global')
    // revokes the account everywhere, which signed the same BHW out of their
    // other phone or the web portal mid-shift.
    await supabase.auth.signOut({ scope: 'local' }); // listener clears the store too
    clearSession();
    await clearSyncableCache();
  };

  /**
   * Sign out, with a final push first so a day's work isn't lost when online.
   *
   * The cache wipe is irreversible, so it must not run on a guess: triggerSync()
   * never throws (it records failures in useSyncStore.lastError), so wrapping it
   * in try/catch proves nothing. Instead we ask the database afterwards how many
   * rows are still pending, and only wipe when the answer is zero — otherwise
   * the BHW is told exactly how many records would be destroyed and can stay
   * signed in until they find a signal.
   */
  const confirmSignOut = () => {
    Alert.alert(t('settings.signOutConfirmTitle'), t('settings.signOutConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.signOut'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setSigningOut(true);
            try {
              await triggerSync(); // push pending rows if we're online
              const pending = await countPendingRows();
              if (pending === 0) {
                await performSignOut();
                return;
              }
              Alert.alert(
                t('settings.signOutPendingTitle'),
                t('settings.signOutPendingBody', { count: pending }),
                [
                  { text: t('settings.staySignedIn'), style: 'cancel' },
                  {
                    text: t('settings.signOutDiscard'),
                    style: 'destructive',
                    onPress: () => void performSignOut(),
                  },
                ],
              );
            } finally {
              setSigningOut(false);
            }
          })();
        },
      },
    ]);
  };

  const onAddressChange = (next: AddressSelection) => {
    setAddress(next);
    if (next.barangayCode && next.barangayCode !== assignedBarangayCode) {
      setAssignedBarangay(next.barangayCode);
      void triggerSync(); // best-effort immediate push; queues if offline
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <View style={{ paddingHorizontal: 20, paddingTop: insets.top + 12, paddingBottom: 6 }}>
        <Text variant="titleLarge" style={{ color: palette.ink, fontWeight: '600' }}>
          {t('settings.title')}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 10, paddingBottom: 32, gap: 22 }}>
        {/* Language — large option cards, live app-wide switch. */}
        <View>
          <SectionLabel>{t('settings.languageSection')}</SectionLabel>
          <View style={{ gap: 10 }}>
            {LANGUAGE_OPTIONS.map((opt) => {
              const selected = language === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setLanguage(opt.key)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    minHeight: 56,
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    borderRadius: 14,
                    borderWidth: selected ? 2 : 1.5,
                    borderColor: selected ? palette.teal : palette.outline,
                    backgroundColor: selected ? palette.tealContainer : palette.paper,
                  }}
                >
                  <Text style={{ fontSize: 20 }}>{opt.flag}</Text>
                  <Text variant="titleSmall" style={{ color: palette.ink }}>
                    {opt.native}
                  </Text>
                  <View style={{ flex: 1 }} />
                  <MaterialCommunityIcons
                    name="check-circle"
                    size={22}
                    color={selected ? palette.teal : 'transparent'}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Assigned barangay — set once, pre-fills every enrollment. */}
        <View>
          <SectionLabel>{t('settings.assignedSection')}</SectionLabel>
          <Text variant="bodySmall" style={{ color: palette.muted, marginBottom: 10 }}>
            {t('settings.assignedHint')}
          </Text>
          <View
            style={{
              backgroundColor: palette.paper,
              borderWidth: 1,
              borderColor: palette.border,
              borderRadius: 16,
              padding: 16,
            }}
          >
            <AddressCascade value={address} onChange={onAddressChange} />
          </View>
          <HelperText type="info" visible={assignedBarangayDirty}>
            {t('settings.assignedPendingPush')}
          </HelperText>
        </View>

        {/* Account. */}
        <View>
          <SectionLabel>{t('settings.accountSection')}</SectionLabel>
          {userId ? (
            <>
              <View
                style={{
                  backgroundColor: palette.paper,
                  borderWidth: 1,
                  borderColor: palette.border,
                  borderRadius: 16,
                  padding: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: palette.teal,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialCommunityIcons name="account" size={24} color="#FFFFFF" />
                </View>
                <Text variant="bodyMedium" style={{ color: palette.ink, flex: 1 }}>
                  {email ?? userId}
                </Text>
              </View>
              <Button
                mode="outlined"
                icon="logout"
                textColor={palette.red}
                onPress={confirmSignOut}
                loading={signingOut}
                disabled={signingOut}
                contentStyle={{ height: 52 }}
                labelStyle={{ fontWeight: '600' }}
                style={{ marginTop: 12, borderRadius: 26, borderColor: palette.outline }}
              >
                {signingOut ? t('settings.signOutSyncing') : t('settings.signOut')}
              </Button>
            </>
          ) : (
            <Button
              mode="contained-tonal"
              icon="login"
              onPress={() => router.push('/sign-in')}
              contentStyle={{ height: 52 }}
              labelStyle={{ fontWeight: '600' }}
              style={{ borderRadius: 26 }}
            >
              {t('settings.signIn')}
            </Button>
          )}
        </View>

        {/* Legal. */}
        <View>
          <SectionLabel>{t('settings.legalSection')}</SectionLabel>
          <Button
            mode="outlined"
            icon="file-document"
            onPress={() => router.push('/terms')}
            contentStyle={{ height: 52 }}
            labelStyle={{ fontWeight: '600' }}
            style={{ borderRadius: 26, borderColor: palette.outline }}
          >
            {t('settings.viewTerms')}
          </Button>
        </View>

        {/* Developer helpers. */}
        <View>
          <SectionLabel>{t('settings.developerSection')}</SectionLabel>
          <Button
            mode="text"
            onPress={() => {
              resetTerms();
              router.replace('/');
            }}
          >
            {t('settings.resetFirstLaunch')}
          </Button>
        </View>
      </ScrollView>
    </View>
  );
}
