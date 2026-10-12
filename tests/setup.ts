import { applyD1Migrations, env } from "cloudflare:test";

// Each test worker gets the real schema from migrations/, so a migration that
// would break production breaks the test suite first.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
