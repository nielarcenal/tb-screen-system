import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, View } from 'react-native';
import { ActivityIndicator, Button, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { preventScreenCaptureAsync } from 'expo-screen-capture';
import { useTranslation } from 'react-i18next';
import { PinError, validPin } from '../domain/pinLock';
import { pinVault } from '../lib/pinVault';
import { usePinStore } from '../store/pinStore';
import { useSessionStore } from '../store/sessionStore';
import { palette } from '../ui/tokens';

type Mode = 'setup' | 'unlock' | 'change';

function PinForm({ mode }: { mode: Mode }) {
  const { t } = useTranslation();
  const [recover, setRecover] = useState(false);
  const [pin, setPin] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void pinVault.read().then((r) => { if (mounted.current) setRetryAt(r?.retryAt ?? 0); })
      .catch(() => { if (mounted.current) setError(t('pin.storageError')); });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [t]);
  const waiting = !recover && retryAt > now;
  const replacing = recover || mode !== 'unlock';

  const submit = async () => {
    if (pending.current || waiting) return;
    if ((!recover && mode !== 'setup' && !validPin(pin)) || (replacing && !validPin(next))) {
      setError(t('pin.invalid')); return;
    }
    if (replacing && next !== confirm) { setError(t('pin.mismatch')); return; }
    pending.current = true; setBusy(true); setError(''); Keyboard.dismiss();
    const generation = usePinStore.getState().generation;
    try {
      if (recover) await pinVault.recover(email, password, next);
      else if (mode === 'setup') {
        const ownerId = useSessionStore.getState().userId;
        if (!ownerId) throw new PinError('storage');
        await pinVault.setup(next, ownerId);
      } else if (mode === 'change') await pinVault.change(pin, next);
      else await pinVault.unlock(pin);
      usePinStore.getState().complete(generation);
    } catch (e) {
      if (mounted.current) {
        setPin(''); setPassword('');
        setError(e instanceof PinError && e.code === 'wrong' ? t('pin.wrong')
          : e instanceof PinError && e.code === 'wait' ? t('pin.tooMany')
          : recover ? t('pin.recoveryError') : t('pin.storageError'));
        try { setRetryAt((await pinVault.read())?.retryAt ?? 0); }
        catch { setError(t('pin.storageError')); }
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const pinInput = (label: string, value: string, setValue: (s: string) => void) => (
    <TextInput mode="outlined" label={label} accessibilityLabel={label} value={value}
      onChangeText={(v) => setValue(v.replace(/\D/g, '').slice(0, 6))}
      keyboardType="number-pad" secureTextEntry maxLength={6} autoComplete="off"
      importantForAutofill="noExcludeDescendants" autoCorrect={false} disabled={busy}
      onSubmitEditing={() => void submit()} />
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}>
          <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center', gap: 16 }}>
            <Text variant="labelLarge" style={{ color: palette.teal }}>{t('common.appName')}</Text>
            <Text variant="headlineSmall">{recover ? t('pin.recoverTitle') : mode === 'setup'
              ? t('pin.setupTitle') : mode === 'change' ? t('pin.changeTitle') : t('pin.unlockTitle')}</Text>
            <Text>{recover ? t('pin.recoverHint') : t('pin.hint')}</Text>
            {recover ? <>
              <TextInput mode="outlined" label={t('pin.email')} value={email} onChangeText={setEmail}
                keyboardType="email-address" autoCapitalize="none" autoCorrect={false} disabled={busy} />
              <TextInput mode="outlined" label={t('pin.password')} value={password} onChangeText={setPassword}
                secureTextEntry autoCapitalize="none" autoCorrect={false} disabled={busy} />
            </> : mode !== 'setup' ? pinInput(t('pin.current'), pin, setPin) : null}
            {replacing ? <>
              {pinInput(t('pin.new'), next, setNext)}
              {pinInput(t('pin.confirm'), confirm, setConfirm)}
            </> : null}
            {error ? <Text style={{ color: palette.red }} accessibilityLiveRegion="polite">{error}</Text> : null}
            {waiting ? <Text>{t('pin.wait', { seconds: Math.ceil((retryAt - now) / 1000) })}</Text> : null}
            <Button mode="contained" loading={busy} disabled={busy || waiting}
              contentStyle={{ minHeight: 50 }} onPress={() => void submit()}>
              {replacing ? t('pin.save') : t('pin.unlock')}
            </Button>
            {mode !== 'setup' ? <Button disabled={busy} onPress={() => {
              setRecover(!recover); setError(''); setPin(''); setNext(''); setConfirm(''); setPassword(''); setEmail('');
            }}>{recover ? t('pin.usePin') : t('pin.forgot')}</Button> : null}
            {mode === 'change' ? <Button disabled={busy} onPress={() => usePinStore.getState().cancelChange()}>
              {t('common.cancel')}
            </Button> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function AppPinLock({ children, authReady }: { children: ReactNode; authReady: boolean }) {
  const { t } = useTranslation();
  const lock = usePinStore();
  const userId = useSessionStore((s) => s.userId);
  const [privacyReady, setPrivacyReady] = useState(false);
  const [privacyError, setPrivacyError] = useState(false);
  const initialize = async () => {
    setPrivacyError(false);
    try {
      // Android FLAG_SECURE also removes patient details from Recents thumbnails.
      await preventScreenCaptureAsync('bhw-pin');
      setPrivacyReady(true);
      await usePinStore.getState().initialize();
    } catch { setPrivacyError(true); }
  };
  useEffect(() => {
    void initialize();
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') { Keyboard.dismiss(); usePinStore.getState().lock(); }
    });
    return () => { listener.remove(); };
  }, []);
  const mode: Mode | null = !lock.configured && userId ? 'setup'
    : lock.configured && lock.locked ? 'unlock' : lock.changing ? 'change' : null;
  if (!lock.ready || !privacyReady || !authReady) return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16, backgroundColor: palette.background }}>
      {lock.failed || privacyError ? <>
        <Text>{t('pin.storageError')}</Text>
        <Button onPress={() => void initialize()}>{t('pin.retry')}</Button>
      </> : <ActivityIndicator />}
    </View>
  );
  return <>
    <View style={{ flex: 1, display: mode ? 'none' : 'flex' }}
      importantForAccessibility={mode ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={!!mode}>
      {children}
    </View>
    {mode ? <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={() => {}}>
      <PinForm key={`${mode}-${lock.generation}`} mode={mode} />
    </Modal> : null}
  </>;
}
