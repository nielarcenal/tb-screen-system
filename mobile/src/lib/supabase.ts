/**
 * Supabase client for React Native.
 *
 * RN needs a URL polyfill (Supabase builds request URLs) and an explicit storage
 * adapter so the auth session survives app restarts. We use AsyncStorage for the
 * session token. detectSessionInUrl is disabled (no browser redirect on native).
 */
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import { env } from './env';

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
