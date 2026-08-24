/**
 * BHW sign-in (Feature 8) — styled per design 1a screen 3: centered app mark,
 * large inputs, pill CTA. Accounts are provisioned by the admin
 * (supabase/seed.sql); no self-registration.
 *
 * Offline note (§7): signing IN needs a connection, but a previously signed-in
 * session is restored from AsyncStorage by Supabase on launch, so day-to-day
 * offline work never hits this screen.
 */
import { useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Appbar, Button, HelperText, Text, TextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { supabase } from '../src/lib/supabase';
import { useSessionStore } from '../src/store/sessionStore';
import { isConnectivityError } from '../src/sync/syncErrors';
import { triggerSync } from '../src/sync/syncManager';
import { palette } from '../src/ui/tokens';

export default function SignInScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const setSession = useSessionStore((s) => s.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Split so a connectivity failure can show a plain translated line. Supabase's
  // raw message names the project URL ("...supabase.co"), which is noise to a BHW
  // in the field and leaks the backend onto the screen. Reuses D-10's classifier
  // rather than adding a second network-detection path.
  const [error, setError] = useState<{ offline: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (err) {
      setError({ offline: isConnectivityError(err.message), message: err.message });
      return;
    }
    setSession(data.user.id, data.user.email ?? null);
    void triggerSync(); // first sync right away (facilities, pulls, queued rows)
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Appbar.Header style={{ backgroundColor: palette.background }}>
        <Appbar.BackAction onPress={() => router.back()} />
      </Appbar.Header>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16, flexGrow: 1 }}>
        <View style={{ alignItems: 'center', gap: 12, marginTop: 24 }}>
          <Image
            source={require('../assets/tb-screen-logo.png')}
            style={{ width: 60, height: 60, borderRadius: 18 }}
            accessibilityLabel={t('common.appName')}
          />
          <Text variant="titleLarge" style={{ color: palette.ink, fontWeight: '600' }}>
            {t('signIn.title')}
          </Text>
          <Text
            variant="bodySmall"
            style={{ color: palette.muted, textAlign: 'center', lineHeight: 19 }}
          >
            {t('signIn.intro')}
          </Text>
        </View>

        <View style={{ marginTop: 20, gap: 16 }}>
          <TextInput
            label={t('signIn.email')}
            value={email}
            onChangeText={setEmail}
            mode="outlined"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            style={{ backgroundColor: palette.paper }}
          />
          <TextInput
            label={t('signIn.password')}
            value={password}
            onChangeText={setPassword}
            mode="outlined"
            secureTextEntry={!showPassword}
            autoComplete="current-password"
            right={
              <TextInput.Icon
                icon={showPassword ? 'eye-off' : 'eye'}
                onPress={() => setShowPassword((v) => !v)}
                accessibilityLabel={
                  showPassword ? t('signIn.hidePassword') : t('signIn.showPassword')
                }
              />
            }
            style={{ backgroundColor: palette.paper }}
          />
        </View>
        <HelperText type="error" visible={!!error}>
          {error
            ? error.offline
              ? t('signIn.errorOffline')
              : t('signIn.error', { message: error.message })
            : ''}
        </HelperText>
        <Button
          mode="contained"
          onPress={() => void signIn()}
          loading={busy}
          disabled={busy || !email.trim() || !password}
          contentStyle={{ height: 56 }}
          labelStyle={{ fontSize: 17, fontWeight: '600' }}
          style={{ borderRadius: 28 }}
        >
          {t('signIn.cta')}
        </Button>

        <Text
          variant="bodySmall"
          style={{ marginTop: 14, textAlign: 'center', color: palette.inkSoft, lineHeight: 19 }}
        >
          {t('signIn.helper')}
        </Text>

        <View style={{ flex: 1 }} />
        <Text
          variant="bodySmall"
          style={{ textAlign: 'center', color: palette.muted, lineHeight: 19 }}
        >
          {t('common.appName')} · v1.0{'\n'}
          {t('welcome.disclaimerHeading')}
        </Text>
      </ScrollView>
    </View>
  );
}
