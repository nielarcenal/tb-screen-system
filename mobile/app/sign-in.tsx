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
import { checkAccountAccess, recordAccountAccess, rejectSession } from '../src/lib/accountGate';
import { DeniedReason, roleDestinationKey } from '../src/domain/accountAccess';
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
  // Split by kind so a connectivity failure can show a plain translated line.
  // Supabase's raw message names the project URL ("...supabase.co"), which is
  // noise to a BHW in the field and leaks the backend onto the screen. Reuses
  // D-10's classifier rather than adding a second network-detection path.
  // 'refused' is D-07: the password was right, but this account may not use
  // this app.
  const [error, setError] = useState<
    | { kind: 'offline' }
    | { kind: 'api'; message: string }
    | { kind: 'refused'; reason: DeniedReason; role: string | null }
    | null
  >(null);
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (err) {
      setBusy(false);
      setError(
        isConnectivityError(err.message)
          ? { kind: 'offline' }
          : { kind: 'api', message: err.message },
      );
      return;
    }

    // D-07: authenticated is not the same as allowed. Ask the server who this
    // is BEFORE the session is stored and before the first sync — a tb_dots
    // account satisfies 0007's unconditional patients_tbdots_read, so one sync
    // would write every patient in the province into this handset. The spinner
    // deliberately still covers this second round trip.
    //
    // 'deny' on a missing row: at sign-in there is no local data and no
    // unsynced work of this account's to lose, so failing closed is free. The
    // opposite policy is used mid-session (see accountAccess.ts).
    const access = await checkAccountAccess(data.user.id, 'deny');
    if (access.kind === 'denied') {
      await rejectSession();
      setBusy(false);
      setError({ kind: 'refused', reason: access.reason, role: access.role });
      return;
    }

    setBusy(false);
    setSession(data.user.id, data.user.email ?? null);
    // An 'unknown' here is discarded, which is what we want: the sign-in itself
    // proved connectivity, so this is nearly always 'allowed', and if it somehow
    // was not, _layout re-asks on the next auth event. An 'allowed' also erases
    // any refusal remembered from a previous session on this phone.
    recordAccountAccess(access);
    void triggerSync(); // first sync right away (facilities, pulls, queued rows)
    router.back();
  };

  /** The line under the fields. Spelled out so every key can be grepped for. */
  const errorText = (): string => {
    if (!error) return '';
    if (error.kind === 'offline') return t('signIn.errorOffline');
    if (error.kind === 'api') return t('signIn.error', { message: error.message });
    if (error.reason === 'inactive') return t('signIn.refusedInactive');
    if (error.reason === 'noAccount') return t('signIn.refusedNoAccount');
    return t('signIn.refusedWrongRole', { destination: t(roleDestinationKey(error.role)) });
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Appbar.Header style={{ backgroundColor: palette.background }}>
        <Appbar.BackAction onPress={() => router.back()} />
      </Appbar.Header>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 24, gap: 16, flexGrow: 1 }}
      >
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
          {errorText()}
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
