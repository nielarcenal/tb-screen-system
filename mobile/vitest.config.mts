/**
 * Vitest is scoped deliberately narrowly.
 *
 * The app itself is Expo/React Native and needs Metro's transforms to run at
 * all — Vitest cannot load it and should never try. `include` therefore lists
 * only test files under src/, and the suites there must stay on pure modules
 * (domain rules, date helpers) that import no React Native at runtime.
 * screeningRules.ts qualifies: its only import is a type.
 *
 * If component tests are ever wanted, they need a different runner
 * (jest-expo), not a wider include here.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
