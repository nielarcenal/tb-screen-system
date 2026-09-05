/**
 * Vitest for the Edge Functions — the third and last scope in this repo
 * (mobile/ and web/ are the other two), added because supabase/functions/ had
 * no runner at all and its two entry points are the least reachable code in
 * the project: one sends real SMS through a paid gateway, the other holds the
 * service-role key and creates auth users.
 *
 * WHAT IT CAN AND CANNOT LOAD. index.ts in both functions is Deno: it calls
 * Deno.serve, reads Deno.env, and imports npm: specifiers that Node does not
 * resolve. Vitest cannot load either one and should never try. So `include`
 * covers _shared/ only, and the rule that keeps this scope working is that
 * every module there stays PURE — no Deno globals, no network, no clock of its
 * own. That is why selection.ts takes `nowMs` as an argument.
 *
 * Both functions import these modules with an explicit `.ts` extension, which
 * is what Deno requires; Vite resolves that form too, so one file satisfies
 * both runtimes with no build step and no duplicated logic.
 *
 * .mts for the same reason as the other two configs: a .ts Vite config warns
 * about ESM-in-CommonJS on every run.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['_shared/**/*.test.ts'],
  },
});
