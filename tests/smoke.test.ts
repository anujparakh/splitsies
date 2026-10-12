import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("has a migrated D1 database bound", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const tables = results.map((r) => r.name);
    expect(tables).toContain("users");
    expect(tables).toContain("expenses");
    expect(tables).toContain("expense_splits");
    expect(tables).toContain("settlements");
  });
});
