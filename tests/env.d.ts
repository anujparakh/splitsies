import type { D1Migration } from "@cloudflare/vitest-plugin";

// `env` from "cloudflare:test" is typed as `Cloudflare.Env`, so test-only
// bindings injected by vitest.config.ts are declared by merging onto it.
declare global {
  namespace Cloudflare {
    interface Env {
      /** Injected by vitest.config.ts via readD1Migrations(). */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
