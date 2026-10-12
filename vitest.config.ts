import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside workerd against a real (local) D1, so the integration tests
// exercise actual SQL rather than a mock. The pure-function tests run happily
// in the same environment, which keeps us to one config file.
const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          // Fixed test values; the real ones are Worker secrets.
          PASSWORD_PEPPER: "test-pepper-not-a-real-secret",
          SESSION_SECRET: "test-session-secret-not-a-real-secret",
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./tests/setup.ts"],
  },
});
