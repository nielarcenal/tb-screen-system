/**
 * The account this phone is signed in as may no longer use this app (D-07).
 *
 * Reached when a re-check during a successful sync — or on a later auth event —
 * comes back with a definite "no": the BHW was deactivated, or their role was
 * changed to a portal one. A sign-in refusal never gets here; that path is
 * refused on the sign-in screen itself, before any session is stored.
 *
 * WHY AN OVERLAY AND NOT A SCREEN, same as ChangePasswordGate: a route can be
 * dismissed. This covers the whole app, sits absolutely positioned above the
 * navigator, and swallows the Android back button.
 *
 * WHY THE WAY OUT IS THE GUARDED SIGN-OUT. The account is blocked, but the
 * records on this phone may not all have reached the server, and those belong
 * to patients, not to the account. So this offers exactly the flow Settings
 * offers: sync first, and if anything is still pending, say how many records
 * would be destroyed and let the BHW choose "Stay signed in" to keep them. That
 * leaves the app blocked but the work intact, which is the right trade — the
 * server has already stopped honouring this account (the auth ban), so a phone
 * that cannot be used is not a hole. NOTHING IS WIPED AUTOMATICALLY: the
 * destructive answer stays explicit, and stays theirs.
 */
import { useEffect } from 'react';
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DeniedReason, roleDestinationKey } from '../domain/accountAccess';
import { confirmSignOut } from '../lib/signOutFlow';
import { useSessionStore } from '../store/sessionStore';
import { palette } from '../ui/tokens';

/** Spelled out rather than built from the reason, so each key is greppable. */
const TITLE_KEY: Record<DeniedReason, string> = {
  inactive: 'blocked.inactiveTitle',
  wrongRole: 'blocked.wrongRoleTitle',
  noAccount: 'blocked.noAccountTitle',
};

const BODY_KEY: Record<DeniedReason, string> = {
  inactive: 'blocked.inactiveBody',
  wrongRole: 'blocked.wrongRoleBody',
  noAccount: 'blocked.noAccountBody',
};

export default function AccountBlockedGate({
  reason,
  role,
}: {
  reason: DeniedReason;
  role: string | null;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const email = useSessionStore((s) => s.email);

  // Hardware back must not reach the navigator underneath. Returning true says
  // "handled"; the subscription is torn down with the gate.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

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
      >
        <View style={{ gap: 8 }}>
          <Text variant="headlineSmall" style={{ color: palette.ink, fontWeight: '700' }}>
            {t(TITLE_KEY[reason])}
          </Text>
          <Text variant="bodyMedium" style={{ color: palette.inkSoft, lineHeight: 21 }}>
            {t(BODY_KEY[reason], { destination: t(roleDestinationKey(role)) })}
          </Text>
          {email ? (
            <Text variant="bodySmall" style={{ color: palette.muted, marginTop: 2 }}>
              {t('password.signedInAs', { email })}
            </Text>
          ) : null}
        </View>

        <Text variant="bodySmall" style={{ color: palette.muted, lineHeight: 19 }}>
          {t('blocked.pendingNote')}
        </Text>

        <View style={{ flex: 1 }} />

        {/* The same guarded flow as Settings — it syncs first and asks before
            discarding anything that could not be uploaded, so this exit can
            never quietly destroy a day's work. */}
        <Button
          mode="contained"
          onPress={() => confirmSignOut(t)}
          contentStyle={{ height: 56 }}
          labelStyle={{ fontSize: 17, fontWeight: '600' }}
          style={{ borderRadius: 28 }}
        >
          {t('blocked.signOut')}
        </Button>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: palette.background,
    // Above the navigator on both platforms, and above the password gate:
    // an account that may not use the app must not be asked to choose a
    // password for it.
    zIndex: 110,
    elevation: 26,
  },
});
