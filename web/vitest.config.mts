/**
 * Vitest for the portal (web/). Separate from vite.config.ts on purpose: the
 * app build config carries a two-entry rollup input (index.html + admin.html)
 * that means nothing to a test run, and Vitest ignores vite.config.ts entirely
 * once this file exists — so the React plugin has to be repeated here.
 *
 * Unlike mobile/, this project is plain React DOM, so components CAN be
 * rendered: environment is jsdom and @testing-library/react drives them. The
 * only module that must always be mocked is src/lib/supabase.ts — it throws at
 * import time when VITE_SUPABASE_URL is unset, and no test should reach a real
 * project anyway.
 *
 * The extension is .mts for the same reason as mobile/vitest.config.mts: a .ts
 * Vite config warns about ESM-in-CommonJS on every run.
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
