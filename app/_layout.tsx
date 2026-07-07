/**
 * Root layout: global providers + startup wiring.
 *  - PaperProvider (Material Design 3) + SafeAreaProvider.
 *  - Waits for the persistent appStore to hydrate before rendering, so the
 *    first-launch gate (below, in index) doesn't flash the wrong screen.
 *  - Applies the persisted UI language to i18next.
 *  - Starts auto-sync (fires on reconnect) for the app's lifetime.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { MD3LightTheme, PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import '../src/i18n'; // side-effect: initialize i18next
import { palette } from '../src/ui/tokens';
import '../src/i18n/paperDates'; // side-effect: register date-picker locales
import { changeLanguage } from '../src/i18n';
import { supabase } from '../src/lib/supabase';
import { useAppStore } from '../src/store/appStore';
import { useSessionStore } from '../src/store/sessionStore';
import { startAutoSync, stopAutoSync } from '../src/sync/syncManager';

// Route React Native Paper's icons through @expo/vector-icons (v15 no longer
// bundles react-native-vector-icons, which Paper would otherwise import). The
// `name` cast bridges Paper's generic string to MCI's typed glyph union.
const paperSettings = {
  icon: ({ name, color, size }: { name: string; color?: string; size: number }) => (
    <MaterialCommunityIcons name={name as never} color={color} size={size} />
  ),
};

/**
 * App theme: MD3 mapped to the approved design canvas ("TB-Screen BHW.dc.html")
 * — deep teal primary, seafoam accent, warm off-white surfaces. Amber tertiary
 * is reserved for patient-reported (PGI-S) elements.
 */
export const appTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: palette.teal,
    onPrimary: '#FFFFFF',
    primaryContainer: palette.tealContainer,
    onPrimaryContainer: palette.tealDeep,
    secondary: palette.seafoam,
    onSecondary: '#FFFFFF',
    secondaryContainer: palette.tealContainer,
    onSecondaryContainer: palette.tealDeep,
    tertiary: palette.amber,
    onTertiary: '#FFFFFF',
    tertiaryContainer: palette.amberContainer,
    onTertiaryContainer: palette.amberInk,
    background: palette.background,
    onBackground: palette.ink,
    surface: palette.background,
    onSurface: palette.ink,
    surfaceVariant: palette.surfaceVariant,
    onSurfaceVariant: palette.inkMid,
    outline: palette.outline,
    outlineVariant: palette.border,
    error: palette.red,
    onError: '#FFFFFF',
    errorContainer: palette.redContainer,
    onErrorContainer: palette.redDeep,
    // Warm elevation tints so raised surfaces stay off-white, not lavender.
    elevation: {
      level0: 'transparent',
      level1: '#F7F4EF',
      level2: '#F3F0EA',
      level3: '#EDE8E0',
      level4: '#EBE5DC',
      level5: '#E8E2D8',
    },
  },
};

export default function RootLayout() {
  const [hydrated, setHydrated] = useState(useAppStore.persist.hasHydrated());
  const language = useAppStore((s) => s.language);

  useEffect(() => {
    const unsub = useAppStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAppStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);

  useEffect(() => {
    void changeLanguage(language);
  }, [language]);

  useEffect(() => {
    startAutoSync();
    return () => stopAutoSync();
  }, []);

  // Restore the auth session into the transient sessionStore on launch (works
  // offline — Supabase caches the session in AsyncStorage) and keep it in step
  // with later sign-ins/outs. Feature 8: this replaces the sync-test bootstrap.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        useSessionStore
          .getState()
          .setSession(data.session.user.id, data.session.user.email ?? null);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        useSessionStore.getState().setSession(session.user.id, session.user.email ?? null);
      } else {
        useSessionStore.getState().clearSession();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <PaperProvider settings={paperSettings} theme={appTheme}>
        {/* Screens render their own Paper Appbars; the native header is off. */}
        <Stack screenOptions={{ headerShown: false }} />
      </PaperProvider>
    </SafeAreaProvider>
  );
}
