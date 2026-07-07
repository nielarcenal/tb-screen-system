/**
 * Typed access to the EXPO_PUBLIC_* environment variables.
 *
 * Only the anon key lives here. The service_role key must NEVER be bundled into
 * the mobile app (see .env.example).
 *
 * Missing config does NOT throw at import — otherwise the app couldn't even show
 * the first-launch/consent screens (which need no backend). Instead we warn and
 * fall back to placeholders so the app boots; any server call then fails and is
 * surfaced by the sync layer. `isSupabaseConfigured` lets callers skip network.
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = url.length > 0 && anonKey.length > 0;

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.warn(
    '[env] EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY not set. Copy mobile/.env.example ' +
      'to mobile/.env to enable sync. The app runs offline-only until then.',
  );
}

export const env = {
  // Fallbacks are syntactically valid so createClient() doesn't throw at import;
  // they point nowhere, so any request simply fails (and is caught by sync).
  supabaseUrl: isSupabaseConfigured ? url : 'http://localhost:54321',
  supabaseAnonKey: isSupabaseConfigured ? anonKey : 'anon-key-not-configured',
} as const;
