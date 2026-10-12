import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppState } from "../shared/types";
import { hashPassword } from "../src/auth";

const ANUJ_PASSWORD = "anuj-test-password";
const RUCHI_PASSWORD = "ruchi-test-password";

/** Resets to a known two-user group before every test. */
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM expense_splits"),
    env.DB.prepare("DELETE FROM expenses"),
    env.DB.prepare("DELETE FROM settlements"),
    env.DB.prepare("DELETE FROM users"),
  ]);

  const pepper = env.PASSWORD_PEPPER;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, name, password_hash, created_at) VALUES (1, 'Anuj', ?, ?)",
    ).bind(await hashPassword(ANUJ_PASSWORD, pepper), now),
    env.DB.prepare(
      "INSERT INTO users (id, name, password_hash, created_at) VALUES (2, 'Ruchi', ?, ?)",
    ).bind(await hashPassword(RUCHI_PASSWORD, pepper), now),
  ]);
});

/** Logs in and returns a Cookie header value for subsequent requests. */
async function signIn(password: string): Promise<string> {
  const response = await SELF.fetch("https://splitsies.test/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  expect(response.status).toBe(200);
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";")[0]!;
}

function authed(cookie: string, path: string, init: RequestInit = {}) {
  return SELF.fetch(`https://splitsies.test${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      "content-type": "application/json",
      cookie,
    },
  });
}

describe("hashPassword", () => {
  it("matches scripts/hash-password.mjs byte-for-byte", async () => {
    // Guards the seeding path: scripts/hash-password.mjs is run outside the
    // Worker to compute hashes for seed INSERTs. If the two implementations
    // ever disagree, every freshly deployed app locks everyone out.
    expect(await hashPassword("hunter2", "test-pepper")).toBe(
      "xUfDrJ5WjzaPRwSDA_QRLFT9iT4Ml1Is7UYaU1PPYYU",
    );
  });
});

describe("auth", () => {
  it("rejects an unauthenticated request for state", async () => {
    const response = await SELF.fetch("https://splitsies.test/api/state");
    expect(response.status).toBe(401);
  });

  it("rejects an unrecognised password", async () => {
    const response = await SELF.fetch("https://splitsies.test/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "not-anybody's-password" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("identifies the user from the password alone", async () => {
    for (const [password, name] of [
      [ANUJ_PASSWORD, "Anuj"],
      [RUCHI_PASSWORD, "Ruchi"],
    ] as const) {
      const cookie = await signIn(password);
      const state = (await (await authed(cookie, "/api/state")).json()) as AppState;
      expect(state.me.name).toBe(name);
    }
  });

  it("rejects a tampered session signature", async () => {
    const cookie = await signIn(ANUJ_PASSWORD);
    const forged = cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await authed(forged, "/api/state")).status).toBe(401);
  });

  it("rejects a session claiming another user id", async () => {
    const cookie = await signIn(ANUJ_PASSWORD);
    const [name, token] = cookie.split("=") as [string, string];
    const parts = token.split(".");
    const forged = `${name}=2.${parts[1]}.${parts[2]}`;
    expect((await authed(forged, "/api/state")).status).toBe(401);
  });

  it("clears the cookie on sign-out", async () => {
    const cookie = await signIn(ANUJ_PASSWORD);
    const response = await authed(cookie, "/api/logout", { method: "POST" });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("expenses", () => {
  const groceries = {
    description: "Groceries",
    amountCents: 8420,
    date: "2026-10-09",
    paidBy: 1,
    participants: [1, 2],
  };

  it("creates an expense, its splits, and the resulting balances", async () => {
    const cookie = await signIn(ANUJ_PASSWORD);
    const response = await authed(cookie, "/api/expenses", {
      method: "POST",
      body: JSON.stringify(groceries),
    });
    expect(response.status).toBe(200);

    const state = (await response.json()) as AppState;
    expect(state.expenses).toHaveLength(1);
    expect(state.expenses[0]!.splits).toEqual([
      { userId: 1, shareCents: 4210 },
      { userId: 2, shareCents: 4210 },
    ]);
    expect(state.balances.transfers).toEqual([
      { fromUser: 2, toUser: 1, amountCents: 4210 },
    ]);
  });

  it("replaces splits on edit rather than duplicating them", async () => {
    const cookie = await signIn(ANUJ_PASSWORD);
    const created = (await (
      await authed(cookie, "/api/expenses", {
        method: "POST",
        body: JSON.stringify(groceries),
      })
    ).json()) as AppState;
    const id = created.expenses[0]!.id;

    const edited = (await (
      await authed(cookie, `/api/expenses/${id}`, {
        method: "PUT",
        body: JSON.stringify({ ...groceries, amountCents: 5000, participants: [2] }),
      })
    ).json()) as AppState;

    expect(edited.expenses).toHaveLength(1);
    expect(edited.expenses[0]!.splits).toEqual([{ userId: 2, shareCents: 5000 }]);
    expect(edited.balances.transfers).toEqual([
      { fromUser: 2, toUser: 1, amountCents: 5000 },
    ]);
  });

  it("deletes an expense and its splits", async () => {
    const cookie = await signIn(ANUJ_PASSWORD);
    const created = (await (
      await authed(cookie, "/api/expenses", {
        method: "POST",
        body: JSON.stringify(groceries),
      })
    ).json()) as AppState;
    const id = created.expenses[0]!.id;

    const after = (await (
      await authed(cookie, `/api/expenses/${id}`, { method: "DELETE" })
    ).json()) as AppState;
    expect(after.expenses).toEqual([]);
    expect(after.balances.transfers).toEqual([]);

    const orphans = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM expense_splits WHERE expense_id = ?",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(orphans!.n).toBe(0);
  });

  it("404s on editing or deleting something that is gone", async () => {
    const cookie = await signIn(ANUJ_PASSWORD);
    expect(
      (await authed(cookie, "/api/expenses/9999", {
        method: "PUT",
        body: JSON.stringify(groceries),
      })).status,
    ).toBe(404);
    expect(
      (await authed(cookie, "/api/expenses/9999", { method: "DELETE" })).status,
    ).toBe(404);
  });

  it("rejects invalid input with a message", async () => {
    const cookie = await signIn(ANUJ_PASSWORD);
    const cases = [
      { ...groceries, amountCents: 0 },
      { ...groceries, amountCents: -500 },
      { ...groceries, amountCents: 12.5 },
      { ...groceries, description: "   " },
      { ...groceries, date: "09/10/2026" },
      { ...groceries, date: "2026-02-30" },
      { ...groceries, participants: [] },
      { ...groceries, participants: [1, 1] },
      { ...groceries, participants: [999] },
      { ...groceries, paidBy: 999 },
      {},
      "not even an object",
    ];
    for (const body of cases) {
      const response = await authed(cookie, "/api/expenses", {
        method: "POST",
        body: JSON.stringify(body),
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toHaveProperty("error");
    }
  });
});

describe("settlements", () => {
  it("zeroes the balance when the full amount is settled", async () => {
    const cookie = await signIn(ANUJ_PASSWORD);
    await authed(cookie, "/api/expenses", {
      method: "POST",
      body: JSON.stringify({
        description: "Dinner",
        amountCents: 10000,
        date: "2026-10-09",
        paidBy: 1,
        participants: [1, 2],
      }),
    });

    const state = (await (
      await authed(cookie, "/api/settlements", {
        method: "POST",
        body: JSON.stringify({
          fromUser: 2,
          toUser: 1,
          amountCents: 5000,
          date: "2026-10-10",
        }),
      })
    ).json()) as AppState;

    expect(state.balances.transfers).toEqual([]);
    expect(state.balances.nets.every((n) => n.netCents === 0)).toBe(true);
    expect(state.settlements).toHaveLength(1);
  });

  it("rejects a settlement between one person and themselves", async () => {
    const cookie = await signIn(ANUJ_PASSWORD);
    const response = await authed(cookie, "/api/settlements", {
      method: "POST",
      body: JSON.stringify({
        fromUser: 1,
        toUser: 1,
        amountCents: 5000,
        date: "2026-10-10",
      }),
    });
    expect(response.status).toBe(400);
  });

  it("deletes a settlement and restores the balance", async () => {
    const cookie = await signIn(ANUJ_PASSWORD);
    await authed(cookie, "/api/expenses", {
      method: "POST",
      body: JSON.stringify({
        description: "Dinner",
        amountCents: 10000,
        date: "2026-10-09",
        paidBy: 1,
        participants: [1, 2],
      }),
    });
    const settled = (await (
      await authed(cookie, "/api/settlements", {
        method: "POST",
        body: JSON.stringify({
          fromUser: 2,
          toUser: 1,
          amountCents: 5000,
          date: "2026-10-10",
        }),
      })
    ).json()) as AppState;

    const after = (await (
      await authed(cookie, `/api/settlements/${settled.settlements[0]!.id}`, {
        method: "DELETE",
      })
    ).json()) as AppState;

    expect(after.settlements).toEqual([]);
    expect(after.balances.transfers).toEqual([
      { fromUser: 2, toUser: 1, amountCents: 5000 },
    ]);
  });
});
