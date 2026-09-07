/**
 * Forced password change (D-06) — the app-side twin of
 * web/src/components/ChangePasswordGate.tsx.
 *
 * WHY IT IS AN OVERLAY AND NOT A SCREEN: a route can be dismissed. This covers
 * the whole app, absolutely positioned above the navigator, and swallows the
 * Android back button, because the thing it is protecting against is a password
 * the BHW did not choose and their midwife still knows. "Later" is not an
 * option the finding leaves open. The one way out other than setting a password
 * is signing out, which runs the same guarded flow as Settings — including the
 * unsynced-records question, so the escape hatch can never destroy a day's work.
 *
 * WHAT IT IS NOT: enforcement. The flag is cleared by an RPC this client calls
 * after auth.updateUser() succeeds (migration 0019); the database cannot verify
 * the password really changed. What the gate closes is the provisioner's
 * standing access, which no client-side trick reopens.
 */
import { useEffect, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../lib/supabase';
import { confirmSignOut } from '../lib/signOutFlow';
import {
  MIN_PASSWORD_LENGTH,
  PasswordProblem,
  validateNewPassword,
} from '../domain/passwordPolicy';
import { useSessionStore } from '../store/sessionStore';
import { palette } from '../ui/tokens';

/** Spelled out rather than built from the problem name, so every message key
 *  in this file can be grepped for in the locale bundles. */
const PROBLEM_MESSAGE: Record<PasswordProblem, string> = {
  tooShort: 'password.errTooShort',
  looksProvisioned: 'password.errLooksProvisioned',
  mismatch: 'password.errMismatch',
};

export default function ChangePasswordGate() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const email = useSessionStore((s) => s.email);
  const setMustChangePassword = useSessionStore((s) => s.setMustChangePassword);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Hardware back must not reach the navigator underneath. Returning true says
  // "handled"; the subscription is torn down with the gate, so normal back
  // behaviour returns the moment the password is set.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const save = async () => {
    const problem = validateNewPassword(password, confirm);
    if (problem) {
      setError(t(PROBLEM_MESSAGE[problem], { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    setBusy(true);
    setError(null);

    const { error: pwErr } = await supabase.auth.updateUser({ password });
    if (pwErr) {
      setError(t('password.errApi', { message: pwErr.message }));
      setBusy(false);
      return;
    }

    // The password has already changed by this point. Reporting a failure to
    // save would send the BHW back to a password that no longer works, so the
    // message says what actually happened and which password to use next.
    const { error: flagErr } = await supabase.rpc('clear_password_change_flag');
    if (flagErr) {
      setError(t('password.errFlag'));
      setBusy(false);
      return;
    }

    setBusy(false);
    setMustChangePassword(false); // removes this overlay
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.sheet]}>
      <ScrollView
        contentContainerStyle={{
          padding: 24,
          paddingTop: insets.top + 32,
          paddingBottom: insets.bottom + 24,
          gap: 16,
          flexGrow: 1,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 8 }}>
          <Text variant="headlineSmall" style={{ color: palette.ink, fontWeight: '700' }}>
            {t('password.gateTitle')}
          </Text>
          <Text variant="bodyMedium" style={{ color: palette.inkSoft, lineHeight: 21 }}>
            {t('password.gateSub')}
          </Text>
          {email ? (
            <Text variant="bodySmall" style={{ color: palette.muted, marginTop: 2 }}>
              {t('password.signedInAs', { email })}
            </Text>
          ) : null}
        </View>

        <View style={{ marginTop: 8, gap: 16 }}>
          <TextInput
            label={t('password.newLabel')}
            value={password}
            onChangeText={setPassword}
            mode="outlined"
            secureTextEntry={!show}
            autoCapitalize="none"
            autoComplete="new-password"
            disabled={busy}
            right={
              <TextInput.Icon
                icon={show ? 'eye-off' : 'eye'}
                onPress={() => setShow((v) => !v)}
                accessibilityLabel={
                  show ? t('signIn.hidePassword') : t('signIn.showPassword')
                }
              />
            }
            style={{ backgroundColor: palette.paper }}
          />
          <TextInput
            label={t('password.confirmLabel')}
            value={confirm}
            onChangeText={setConfirm}
            mode="outlined"
            secureTextEntry={!show}
            autoCapitalize="none"
            autoComplete="new-password"
            disabled={busy}
            style={{ backgroundColor: palette.paper }}
          />
        </View>

        <Text variant="bodySmall" style={{ color: palette.muted, lineHeight: 19 }}>
          {t('password.hint', { min: MIN_PASSWORD_LENGTH })}
        </Text>

        <HelperText type="error" visible={!!error}>
          {error ?? ''}
        </HelperText>

        <Button
          mode="contained"
          onPress={() => void save()}
          loading={busy}
          disabled={busy || !password || !confirm}
          contentStyle={{ height: 56 }}
          labelStyle={{ fontSize: 17, fontWeight: '600' }}
          style={{ borderRadius: 28 }}
        >
          {busy ? t('password.saving') : t('password.cta')}
        </Button>

        <View style={{ flex: 1 }} />

        {/* The only way past this screen other than setting a password. Same
            guarded flow as Settings: syncs first, and asks before discarding
            anything that could not be uploaded. */}
        <Button
          mode="text"
          onPress={() => confirmSignOut(t, setBusy)}
          disabled={busy}
          textColor={palette.muted}
        >
          {t('password.signOut')}
        </Button>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: palette.background,
    // Above the navigator on both platforms: zIndex for the JS layer order,
    // elevation so Android does not paint the screen underneath on top.
    zIndex: 100,
    elevation: 24,
  },
});
