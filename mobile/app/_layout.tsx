/**
 * Root layout: global providers + startup wiring.
 *  - PaperProvider (Material Design 3) + SafeAreaProvider.
 *  - Waits for the persistent appStore to hydrate before rendering, so the
 *    first-launch gate (below, in index) doesn't flash the wrong screen.
 *  - Applies the persisted UI language to i18next.
 *  - Starts auto-sync (fires on reconnect) for the app's lifetime.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { Stack } from 'expo-router';
import { MD3LightTheme, PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import '../src/i18n'; // side-effect: initialize i18next
import { palette } from '../src/ui/tokens';
import '../src/i18n/paperDates'; // side-effect: register date-picker locales
import { changeLanguage } from '../src/i18n';
import { supabase } from '../src/lib/supabase';
import ChangePasswordGate from '../src/components/ChangePasswordGate';
import ConfirmDialogHost from '../src/components/ConfirmDialogHost';
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

/**
 * Shows the forced-password-change overlay (D-06) only when we KNOW the account
 * still holds a provisioned password. A null flag — nobody signed in, or the
 * users row could not be read offline — renders nothing.
 */
function PasswordGate() {
  const userId = useSessionStore((s) => s.userId);
  const mustChange = useSessionStore((s) => s.mustChangePassword);
  if (!userId || mustChange !== true) return null;
  return <ChangePasswordGate />;
}

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

  // Supabase's token auto-refresh is a JS timer, and JS timers don't run
  // reliably once React Native is backgrounded. Left alone, the access token
  // (1h) quietly expires while the phone is asleep, so the app comes back with
  // only the refresh token — the one state where a single rejected refresh
  // ends the session. Tie the ticker to the foreground instead, as the
  // Supabase React Native setup requires: refresh while the BHW is using the
  // app, stop while they aren't.
  useEffect(() => {
    if (AppState.currentState === 'active') void supabase.auth.startAutoRefresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void supabase.auth.startAutoRefresh();
      else void supabase.auth.stopAutoRefresh();
    });
    return () => {
      sub.remove();
      void supabase.auth.stopAutoRefresh();
    };
  }, []);

  // Restore the auth session into the transient sessionStore on launch (works
  // offline — Supabase caches the session in AsyncStorage) and keep it in step
  // with later sign-ins/outs. Feature 8: this replaces the sync-test bootstrap.
  useEffect(() => {
    // Best-effort: the BHW's own name for form attribution, plus the D-06
    // forced-password-change flag. Fails silently offline — mustChangePassword
    // stays null, which does not gate — and is retried on the next auth event.
    const fetchOwnProfile = (userId: string) => {
      void supabase
        .from('users')
        .select('full_name, must_change_password')
        .eq('user_id', userId)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          const session = useSessionStore.getState();
          if (data.full_name) session.setFullName(data.full_name);
          session.setMustChangePassword(data.must_change_password === true);
        });
    };
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        useSessionStore
          .getState()
          .setSession(data.session.user.id, data.session.user.email ?? null);
        fetchOwnProfile(data.session.user.id);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[auth]', event, session ? 'session' : 'no session');
      }
      if (session) {
        useSessionStore.getState().setSession(session.user.id, session.user.email ?? null);
        // Refetch while EITHER answer is still missing. Keyed on both because
        // a token refresh re-emits a session for the same user: refetching every
        // time would be wasteful, but skipping on the name alone would leave the
        // password flag permanently unknown for a session restored offline.
        const { fullName, mustChangePassword } = useSessionStore.getState();
        if (fullName === null || mustChangePassword === null) fetchOwnProfile(session.user.id);
        return;
      }
      // A null session is NOT always a sign-out. Supabase also emits
      // INITIAL_SESSION with null when its own start-up failed (e.g. the first
      // request after a network change), and clearing on that made the app
      // demand a sign-in the BHW never asked for. Only SIGNED_OUT means the
      // stored session is really gone.
      if (event === 'SIGNED_OUT') useSessionStore.getState().clearSession();
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
        {/* D-06: covers the whole app while the account still holds the
            password it was provisioned with. Rendered as a sibling of the
            navigator, not a route, so it cannot be navigated away from. */}
        <PasswordGate />
        {/* Draws the app's own confirmation dialogs. Mounted last, and on a
            native modal window, so it sits above the password gate too — the
            gate offers the same guarded sign-out. */}
        <ConfirmDialogHost />
      </PaperProvider>
    </SafeAreaProvider>
  );
}
