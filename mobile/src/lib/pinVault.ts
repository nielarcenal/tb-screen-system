import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import { PinVault } from '../domain/pinLock';

const KEY = 'tbscreen.device-pin.v1';
export const pinVault = new PinVault({
  read: () => SecureStore.getItemAsync(KEY),
  write: (value) => SecureStore.setItemAsync(KEY, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }),
  random: () => Crypto.randomUUID(),
  hash: (value) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
  now: Date.now,
  authenticate: async (email, password) => {
    // Isolated, non-persistent client: recovery must not switch the app's session
    // to a different account or disturb the current offline queue.
    const client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    try {
      const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      return error ? null : data.user?.id ?? null;
    } finally {
      await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    }
  },
});
