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
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Appbar, Button, HelperText, Text, TextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { supabase } from '../src/lib/supabase';
import { useSessionStore } from '../src/store/sessionStore';
import { triggerSync } from '../src/sync/syncManager';
import { palette } from '../src/ui/tokens';

export default function SignInScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const setSession = useSessionStore((s) => s.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
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
      setError(err.message);
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
          <View
            style={{
              width: 60,
              height: 60,
              borderRadius: 18,
              backgroundColor: palette.teal,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MaterialCommunityIcons name="hospital-box" size={32} color="#FFFFFF" />
          </View>
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
            secureTextEntry
            autoComplete="current-password"
            style={{ backgroundColor: palette.paper }}
          />
        </View>
        <HelperText type="error" visible={!!error}>
          {error ? t('signIn.error', { message: error }) : ''}
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
