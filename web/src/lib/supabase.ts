/**
 * Supabase browser client. Uses the ANON key only (never the service key) —
 * every read/write is scoped by the RLS policies in 0002_rls_policies.sql:
 * TB-DOTS staff see only referrals addressed to their facility, plus the
 * patient/screening/appointment rows behind them.
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env and fill it in.',
  );
}

export const supabase = createClient(url, anonKey);
