# Splitsies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a password-gated shared-expense tracker for one group of 2–3 people, deployed as a single Cloudflare Worker with D1.

**Architecture:** One Worker serves the React SPA as static assets and a Hono JSON API under `/api/*`, backed by D1. All money is integer cents. Balance math lives in one server-side module; every mutation returns the complete new `AppState` so the client never recomputes money. Auth is a deterministic peppered HMAC of the password (which alone identifies the user) plus a signed stateless session cookie.

**Tech Stack:** Cloudflare Workers, Hono 4, D1 (SQLite), React 19, TypeScript 7, Vite 8, Vitest 5 with `@cloudflare/vitest-plugin` (tests run in workerd against real local D1).

**Spec:** `docs/superpowers/specs/2026-10-11-splitsies-design.md`

---

## Status: Foundation Complete

Task 0 is **already done and committed** (`832e15b`). Do not redo it.

Verified working: `npx tsc --noEmit` clean, `npx vitest run` passing, `npx vite build`
succeeding, `npx wrangler deploy --dry-run` accepting the config.

Existing files you will build on:

| File | Contents |
| --- | --- |
| `wrangler.jsonc` | Worker + assets + D1 config. `run_worker_first: ["/api/*"]`. |
| `migrations/0001_init.sql` | Full schema: `users`, `expenses`, `expense_splits`, `settlements`. |
| `shared/types.ts` | The API contract. **Import types from here; do not redefine them.** |
| `shared/money.ts` | `parseDollarsToCents`, `formatUsd`, `formatCentsPlain`, `MAX_AMOUNT_CENTS`. |
| `types/env.d.ts` | Declares `PASSWORD_PEPPER` and `SESSION_SECRET` on `Env`. |
| `tests/setup.ts` | Applies migrations to the test D1 before each test worker. |
| `vitest.config.ts` | Test pepper/secret bindings are fixed test values. |
| `tsconfig.json` | `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. |

**`noUncheckedIndexedAccess` is on.** `array[0]` is `T | undefined`. Code accordingly — this is the single most common source of type errors in this repo.

**`verbatimModuleSyntax` is on.** Type-only imports must say `import type { ... }`.

### File structure to build

```
src/
  index.ts        Hono app: route wiring only, no logic           (Task 3)
  auth.ts         password hash, cookie sign/verify, middleware   (Task 3)
  db.ts           all SQL; the only snake_case↔camelCase mapper   (Task 3)
  validate.ts     ExpenseInput/SettlementInput validation         (Task 3)
  state.ts        assembles AppState                              (Task 3)
  lib/
    split.ts      equal split with deterministic remainder        (Task 1)
    balances.ts   nets + greedy transfers                         (Task 1)
app/
  main.tsx        mount                                           (Task 2)
  App.tsx         auth gate + state container                     (Task 2)
  api.ts          typed fetch wrapper                             (Task 2)
  styles.css      design tokens + all styles                      (Task 2)
  components/
    Login.tsx  BalanceCard.tsx  ActivityFeed.tsx
    Sheet.tsx  ExpenseSheet.tsx  SettleSheet.tsx
tests/
  money.test.ts  split.test.ts  balances.test.ts                  (Task 1)
  api.test.ts                                                     (Task 3)
```

### Parallelization

- **Task 1** (money math) and **Task 2** (frontend) are independent. Run them concurrently.
- **Task 3** (backend) imports Task 1's modules, so it starts after Task 1 lands.
- **Task 4** (integration + docs) is last.

---

## Task 1: Money Math

Pure functions, no I/O, no D1. The only place in the app where a bug is both likely and expensive, so this is strict TDD: test first, watch it fail, then implement.

**Files:**
- Create: `src/lib/split.ts`, `src/lib/balances.ts`
- Create: `tests/money.test.ts`, `tests/split.test.ts`, `tests/balances.test.ts`

### Interface contract (Task 3 depends on these exact signatures)

```ts
// src/lib/split.ts
import type { ExpenseSplit } from "../../shared/types";
export function splitEqually(amountCents: number, participantIds: number[]): ExpenseSplit[];

// src/lib/balances.ts
import type { Balances, Expense, Settlement, User } from "../../shared/types";
export function computeBalances(
  users: User[],
  expenses: Expense[],
  settlements: Settlement[],
): Balances;
```

- [ ] **Step 1: Write the failing tests for `shared/money.ts`**

`shared/money.ts` already exists and is implemented. These tests pin its behaviour.

Create `tests/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  formatCentsPlain,
  formatUsd,
  parseDollarsToCents,
} from "../shared/money";

describe("parseDollarsToCents", () => {
  it("parses plain dollar amounts", () => {
    expect(parseDollarsToCents("12")).toBe(1200);
    expect(parseDollarsToCents("12.5")).toBe(1250);
    expect(parseDollarsToCents("12.50")).toBe(1250);
    expect(parseDollarsToCents("0.01")).toBe(1);
  });

  it("parses the inexact-in-binary-float case exactly", () => {
    expect(parseDollarsToCents("0.1")).toBe(10);
    expect(parseDollarsToCents("0.07")).toBe(7);
    expect(parseDollarsToCents("1.10")).toBe(110);
  });

  it("tolerates what people actually type", () => {
    expect(parseDollarsToCents(" 12.50 ")).toBe(1250);
    expect(parseDollarsToCents("$12.50")).toBe(1250);
    expect(parseDollarsToCents("1,234.56")).toBe(123456);
    expect(parseDollarsToCents(".5")).toBe(50);
    expect(parseDollarsToCents("0")).toBe(0);
  });

  it("rejects junk rather than guessing", () => {
    for (const bad of ["", " ", ".", "$", "abc", "1.2.3", "-5", "1e3", "12.345"]) {
      expect(parseDollarsToCents(bad), bad).toBeNull();
    }
  });
});

describe("formatUsd", () => {
  it("formats cents as dollars", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1)).toBe("$0.01");
    expect(formatUsd(1250)).toBe("$12.50");
    expect(formatUsd(100)).toBe("$1.00");
  });

  it("groups thousands", () => {
    expect(formatUsd(123456)).toBe("$1,234.56");
    expect(formatUsd(100000000)).toBe("$1,000,000.00");
  });

  it("puts the sign before the symbol", () => {
    expect(formatUsd(-1250)).toBe("-$12.50");
  });
});

describe("formatCentsPlain", () => {
  it("formats without symbol or grouping, for form inputs", () => {
    expect(formatCentsPlain(1250)).toBe("12.50");
    expect(formatCentsPlain(123456)).toBe("1234.56");
    expect(formatCentsPlain(5)).toBe("0.05");
  });
});

describe("round trip", () => {
  it("survives parse → format → parse for every cent value in a range", () => {
    for (const cents of [0, 1, 7, 10, 99, 100, 101, 1250, 123456, 99999999]) {
      expect(parseDollarsToCents(formatCentsPlain(cents))).toBe(cents);
    }
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run tests/money.test.ts`
Expected: PASS (the implementation already exists). If any case fails, fix `shared/money.ts` — the test expresses the intent.

- [ ] **Step 3: Commit**

```bash
git add tests/money.test.ts shared/money.ts
git commit -m "test: pin cents/dollars conversion behaviour"
```

- [ ] **Step 4: Write the failing tests for `splitEqually`**

Create `tests/split.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { splitEqually } from "../src/lib/split";

const sum = (splits: { shareCents: number }[]) =>
  splits.reduce((total, s) => total + s.shareCents, 0);

describe("splitEqually", () => {
  it("divides evenly when it can", () => {
    expect(splitEqually(1000, [1, 2])).toEqual([
      { userId: 1, shareCents: 500 },
      { userId: 2, shareCents: 500 },
    ]);
  });

  it("gives the whole amount to a lone participant", () => {
    expect(splitEqually(1337, [7])).toEqual([{ userId: 7, shareCents: 1337 }]);
  });

  it("hands leftover pennies to the lowest user ids, deterministically", () => {
    // $10.00 / 3 = $3.3333...; one extra cent goes to user 1.
    expect(splitEqually(1000, [1, 2, 3])).toEqual([
      { userId: 1, shareCents: 334 },
      { userId: 2, shareCents: 333 },
      { userId: 3, shareCents: 333 },
    ]);
    // 5 / 3 = 1 remainder 2: users 1 and 2 each get the extra cent.
    expect(splitEqually(5, [1, 2, 3])).toEqual([
      { userId: 1, shareCents: 2 },
      { userId: 2, shareCents: 2 },
      { userId: 3, shareCents: 1 },
    ]);
  });

  it("orders output by user id regardless of input order", () => {
    expect(splitEqually(1000, [3, 1, 2]).map((s) => s.userId)).toEqual([1, 2, 3]);
  });

  it("splits a single cent without inventing money", () => {
    const splits = splitEqually(1, [1, 2]);
    expect(sum(splits)).toBe(1);
    expect(splits).toEqual([
      { userId: 1, shareCents: 1 },
      { userId: 2, shareCents: 0 },
    ]);
  });

  it("always sums to exactly the amount", () => {
    for (let amount = 1; amount <= 200; amount++) {
      for (const ids of [[1], [1, 2], [1, 2, 3], [1, 2, 3, 4], [2, 5, 9]]) {
        expect(sum(splitEqually(amount, ids)), `${amount} / ${ids.length}`).toBe(amount);
      }
    }
  });

  it("rejects input that cannot produce a valid split", () => {
    expect(() => splitEqually(1000, [])).toThrow();
    expect(() => splitEqually(0, [1])).toThrow();
    expect(() => splitEqually(-100, [1])).toThrow();
    expect(() => splitEqually(10.5, [1])).toThrow();
    expect(() => splitEqually(1000, [1, 1])).toThrow();
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npx vitest run tests/split.test.ts`
Expected: FAIL — cannot resolve `../src/lib/split`.

- [ ] **Step 6: Implement `splitEqually`**

Create `src/lib/split.ts`:

```ts
import type { ExpenseSplit } from "../../shared/types";

/**
 * Splits `amountCents` equally among `participantIds`.
 *
 * Equal division rarely divides evenly ($10 / 3). The remainder is distributed
 * one cent at a time to the lowest user ids, so the shares always sum to
 * exactly `amountCents` and the same inputs always produce the same output.
 * Rounding each share independently would lose or invent pennies and balances
 * would never quite reach zero.
 *
 * @throws if the inputs could not produce a valid split.
 */
export function splitEqually(
  amountCents: number,
  participantIds: number[],
): ExpenseSplit[] {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error(`amountCents must be a positive integer, got ${amountCents}`);
  }
  if (participantIds.length === 0) {
    throw new Error("an expense needs at least one participant");
  }
  if (new Set(participantIds).size !== participantIds.length) {
    throw new Error("participant ids must be unique");
  }

  const ids = [...participantIds].sort((a, b) => a - b);
  const base = Math.floor(amountCents / ids.length);
  const remainder = amountCents % ids.length;

  return ids.map((userId, index) => ({
    userId,
    shareCents: base + (index < remainder ? 1 : 0),
  }));
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run tests/split.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 8: Commit**

```bash
git add src/lib/split.ts tests/split.test.ts
git commit -m "feat: equal expense splitting with deterministic remainder"
```

- [ ] **Step 9: Write the failing tests for `computeBalances`**

Create `tests/balances.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Expense, Settlement, User } from "../shared/types";
import { computeBalances } from "../src/lib/balances";

const USERS: User[] = [
  { id: 1, name: "Anuj" },
  { id: 2, name: "Ruchi" },
];

const THREE: User[] = [...USERS, { id: 3, name: "Sam" }];

/** Builds an expense with shares split equally among `participants`. */
function expense(
  id: number,
  amountCents: number,
  paidBy: number,
  participants: number[],
): Expense {
  const base = Math.floor(amountCents / participants.length);
  const remainder = amountCents % participants.length;
  return {
    id,
    description: `expense ${id}`,
    amountCents,
    date: "2026-10-01",
    paidBy,
    createdBy: paidBy,
    createdAt: "2026-10-01T00:00:00.000Z",
    splits: [...participants]
      .sort((a, b) => a - b)
      .map((userId, index) => ({
        userId,
        shareCents: base + (index < remainder ? 1 : 0),
      })),
  };
}

function settlement(
  id: number,
  fromUser: number,
  toUser: number,
  amountCents: number,
): Settlement {
  return {
    id,
    fromUser,
    toUser,
    amountCents,
    date: "2026-10-02",
    createdAt: "2026-10-02T00:00:00.000Z",
  };
}

const netOf = (balances: { nets: { userId: number; netCents: number }[] }, userId: number) =>
  balances.nets.find((n) => n.userId === userId)?.netCents;

describe("computeBalances nets", () => {
  it("reports zero for everyone when there is no activity", () => {
    const { nets, transfers } = computeBalances(USERS, [], []);
    expect(nets).toEqual([
      { userId: 1, netCents: 0 },
      { userId: 2, netCents: 0 },
    ]);
    expect(transfers).toEqual([]);
  });

  it("credits the payer and debits the sharers", () => {
    // Anuj pays $100 shared with Ruchi: Anuj is up $50, Ruchi down $50.
    const balances = computeBalances(USERS, [expense(1, 10000, 1, [1, 2])], []);
    expect(netOf(balances, 1)).toBe(5000);
    expect(netOf(balances, 2)).toBe(-5000);
  });

  it("leaves an expense the payer did not share fully owed to them", () => {
    const balances = computeBalances(USERS, [expense(1, 10000, 1, [2])], []);
    expect(netOf(balances, 1)).toBe(10000);
    expect(netOf(balances, 2)).toBe(-10000);
  });

  it("nets opposing expenses against each other", () => {
    const balances = computeBalances(
      USERS,
      [expense(1, 10000, 1, [1, 2]), expense(2, 4000, 2, [1, 2])],
      [],
    );
    // Anuj +50, then -20 => +30.
    expect(netOf(balances, 1)).toBe(3000);
    expect(netOf(balances, 2)).toBe(-3000);
  });

  it("counts a settlement as the debtor paying the creditor back", () => {
    const balances = computeBalances(
      USERS,
      [expense(1, 10000, 1, [1, 2])],
      [settlement(1, 2, 1, 5000)],
    );
    expect(netOf(balances, 1)).toBe(0);
    expect(netOf(balances, 2)).toBe(0);
    expect(balances.transfers).toEqual([]);
  });

  it("handles a partial settlement", () => {
    const balances = computeBalances(
      USERS,
      [expense(1, 10000, 1, [1, 2])],
      [settlement(1, 2, 1, 2000)],
    );
    expect(netOf(balances, 1)).toBe(3000);
    expect(netOf(balances, 2)).toBe(-3000);
  });

  it("handles over-settlement by flipping who owes whom", () => {
    const balances = computeBalances(
      USERS,
      [expense(1, 10000, 1, [1, 2])],
      [settlement(1, 2, 1, 7000)],
    );
    expect(netOf(balances, 1)).toBe(-2000);
    expect(netOf(balances, 2)).toBe(2000);
    expect(balances.transfers).toEqual([
      { fromUser: 1, toUser: 2, amountCents: 2000 },
    ]);
  });

  it("includes users with no activity", () => {
    const balances = computeBalances(THREE, [expense(1, 10000, 1, [1, 2])], []);
    expect(netOf(balances, 3)).toBe(0);
    expect(balances.nets).toHaveLength(3);
  });

  it("always sums to zero, including with uneven three-way splits", () => {
    const balances = computeBalances(
      THREE,
      [expense(1, 1000, 1, [1, 2, 3]), expense(2, 7, 2, [1, 2, 3]), expense(3, 1, 3, [1, 3])],
      [settlement(1, 3, 1, 13)],
    );
    const total = balances.nets.reduce((t, n) => t + n.netCents, 0);
    expect(total).toBe(0);
  });
});

describe("computeBalances transfers", () => {
  it("states a two-person debt in the right direction", () => {
    const balances = computeBalances(USERS, [expense(1, 10000, 1, [1, 2])], []);
    expect(balances.transfers).toEqual([
      { fromUser: 2, toUser: 1, amountCents: 5000 },
    ]);
  });

  it("resolves three-way debt without redundant payments", () => {
    // Anuj pays $90 split three ways: each owes him $30.
    const balances = computeBalances(THREE, [expense(1, 9000, 1, [1, 2, 3])], []);
    expect(balances.transfers).toEqual([
      { fromUser: 2, toUser: 1, amountCents: 3000 },
      { fromUser: 3, toUser: 1, amountCents: 3000 },
    ]);
  });

  it("collapses circular debt into the fewest transfers", () => {
    // Each pays $30 shared with the next person only; the ring should not
    // produce three separate payments.
    const balances = computeBalances(
      THREE,
      [expense(1, 3000, 1, [2]), expense(2, 3000, 2, [3]), expense(3, 3000, 3, [1])],
      [],
    );
    expect(balances.transfers).toEqual([]);
    expect(balances.nets.every((n) => n.netCents === 0)).toBe(true);
  });

  it("produces transfers that exactly cancel every net", () => {
    const users = THREE;
    const balances = computeBalances(
      users,
      [expense(1, 5000, 1, [1, 2, 3]), expense(2, 1200, 3, [1, 2])],
      [settlement(1, 2, 1, 500)],
    );
    const applied = new Map(balances.nets.map((n) => [n.userId, n.netCents]));
    for (const t of balances.transfers) {
      applied.set(t.fromUser, applied.get(t.fromUser)! + t.amountCents);
      applied.set(t.toUser, applied.get(t.toUser)! - t.amountCents);
    }
    for (const [, net] of applied) expect(net).toBe(0);
  });

  it("never emits a zero or self transfer", () => {
    const balances = computeBalances(
      THREE,
      [expense(1, 9000, 1, [1, 2, 3]), expense(2, 3000, 2, [2])],
      [],
    );
    for (const t of balances.transfers) {
      expect(t.amountCents).toBeGreaterThan(0);
      expect(t.fromUser).not.toBe(t.toUser);
    }
  });
});
```

- [ ] **Step 10: Run to verify it fails**

Run: `npx vitest run tests/balances.test.ts`
Expected: FAIL — cannot resolve `../src/lib/balances`.

- [ ] **Step 11: Implement `computeBalances`**

Create `src/lib/balances.ts`:

```ts
import type { Balances, Expense, Settlement, Transfer, User } from "../../shared/types";

/**
 * Computes every user's net position and the payments that would settle up.
 *
 * This is the only place in the application that decides what anybody owes.
 * The client receives the result and renders it; it never does money
 * arithmetic beyond formatting.
 *
 * A user's net, in cents:
 *
 *     net(u) = money u paid out for expenses
 *            - u's shares of expenses
 *            + settlements u paid to others
 *            - settlements others paid to u
 *
 * Positive means the group owes them. Nets always sum to zero.
 */
export function computeBalances(
  users: User[],
  expenses: Expense[],
  settlements: Settlement[],
): Balances {
  const net = new Map<number, number>(users.map((u) => [u.id, 0]));
  const add = (userId: number, cents: number) => {
    // Ignore activity for users who no longer exist rather than inventing a
    // balance row for them.
    if (net.has(userId)) net.set(userId, net.get(userId)! + cents);
  };

  for (const e of expenses) {
    add(e.paidBy, e.amountCents);
    for (const s of e.splits) add(s.userId, -s.shareCents);
  }

  for (const s of settlements) {
    add(s.fromUser, s.amountCents);
    add(s.toUser, -s.amountCents);
  }

  const nets = users.map((u) => ({ userId: u.id, netCents: net.get(u.id) ?? 0 }));

  return { nets, transfers: settleUp(nets) };
}

/**
 * Turns net positions into concrete payments.
 *
 * Greedily matches the largest debtor against the largest creditor and
 * transfers the smaller of the two magnitudes, which retires at least one
 * party per step. Minimizing transfers is NP-hard in general, but greedy is
 * optimal for the two- and three-person cases this app is built for, and the
 * result is always correct regardless of size.
 */
function settleUp(nets: { userId: number; netCents: number }[]): Transfer[] {
  // Sorted copies, so the caller's array is untouched.
  const debtors = nets
    .filter((n) => n.netCents < 0)
    .map((n) => ({ userId: n.userId, owed: -n.netCents }))
    .sort((a, b) => b.owed - a.owed || a.userId - b.userId);
  const creditors = nets
    .filter((n) => n.netCents > 0)
    .map((n) => ({ userId: n.userId, due: n.netCents }))
    .sort((a, b) => b.due - a.due || a.userId - b.userId);

  const transfers: Transfer[] = [];
  let d = 0;
  let c = 0;

  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d]!;
    const creditor = creditors[c]!;
    const amountCents = Math.min(debtor.owed, creditor.due);

    transfers.push({ fromUser: debtor.userId, toUser: creditor.userId, amountCents });

    debtor.owed -= amountCents;
    creditor.due -= amountCents;
    if (debtor.owed === 0) d++;
    if (creditor.due === 0) c++;
  }

  return transfers;
}
```

- [ ] **Step 12: Run to verify it passes**

Run: `npx vitest run tests/balances.test.ts`
Expected: PASS, 14 tests.

Note on the "three-way debt" test ordering: debtors and creditors are sorted by amount descending, then by user id ascending as a tiebreak, which makes the output order deterministic and matches the expected arrays above.

- [ ] **Step 13: Typecheck and run the whole suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 14: Commit**

```bash
git add src/lib/balances.ts tests/balances.test.ts
git commit -m "feat: balance computation and greedy settle-up"
```

---

## Task 2: Frontend

Builds the whole UI against `shared/types.ts`, with a local fixture standing in for the server so it can be developed before the API exists. No money arithmetic beyond calling `shared/money.ts`.

**Files:**
- Create: `app/api.ts`, `app/App.tsx`, `app/styles.css`
- Create: `app/components/Login.tsx`, `BalanceCard.tsx`, `ActivityFeed.tsx`, `Sheet.tsx`, `ExpenseSheet.tsx`, `SettleSheet.tsx`
- Modify: `app/main.tsx` (replace the placeholder), `index.html` (add the stylesheet link)

- [ ] **Step 1: Write the API client**

Create `app/api.ts`:

```ts
import type {
  AppState,
  ApiError,
  ExpenseInput,
  SettlementInput,
  User,
} from "../shared/types";

/** Thrown for any non-2xx response. `message` is safe to show the user. */
export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

/** Distinguishes "your session ended" from a real failure. */
export const isUnauthorized = (error: unknown) =>
  error instanceof ApiFailure && error.status === 401;

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    // fetch only rejects for network-level failures.
    throw new ApiFailure("Can't reach the server. Check your connection.", 0);
  }

  if (!response.ok) {
    let message = "Something went wrong.";
    try {
      message = ((await response.json()) as ApiError).error ?? message;
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    throw new ApiFailure(message, response.status);
  }

  return (await response.json()) as T;
}

export const api = {
  login: (password: string) =>
    request<{ me: User }>("/login", { method: "POST", body: { password } }),
  logout: () => request<{ ok: true }>("/logout", { method: "POST" }),
  state: () => request<AppState>("/state"),
  createExpense: (input: ExpenseInput) =>
    request<AppState>("/expenses", { method: "POST", body: input }),
  updateExpense: (id: number, input: ExpenseInput) =>
    request<AppState>(`/expenses/${id}`, { method: "PUT", body: input }),
  deleteExpense: (id: number) =>
    request<AppState>(`/expenses/${id}`, { method: "DELETE" }),
  createSettlement: (input: SettlementInput) =>
    request<AppState>("/settlements", { method: "POST", body: input }),
  deleteSettlement: (id: number) =>
    request<AppState>(`/settlements/${id}`, { method: "DELETE" }),
};
```

- [ ] **Step 2: Write the stylesheet**

Create `app/styles.css`. Requirements, not a suggestion — the visual result is part of the deliverable:

- Define all colour, spacing, and radius values as custom properties on `:root`, with a `@media (prefers-color-scheme: dark)` block that redefines only the colours. No hard-coded colour outside `:root`.
- Teal accent (`#0f766e` light, lighter in dark mode), neutral grey-blue backgrounds, one elevated surface colour for cards and sheets.
- System font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.
- **All amounts use `font-variant-numeric: tabular-nums`** so columns of figures align.
- Mobile-first: a single column, `max-width: 32rem`, centred, with `padding-inline: 1rem`. No media queries for layout beyond that width cap.
- Minimum 44px touch targets on every button and input. 16px minimum font size on inputs (smaller triggers iOS zoom-on-focus).
- Respect the safe area: `padding-bottom: max(1rem, env(safe-area-inset-bottom))` on the sheet and the floating button.
- Sheets slide up from the bottom with a `transform` transition, wrapped in `@media (prefers-reduced-motion: reduce) { transition: none }`.
- A `.sr-only` class for screen-reader-only labels.

- [ ] **Step 3: Write the `Sheet` primitive**

Create `app/components/Sheet.tsx`. A bottom sheet used by both the expense and settle forms, so the dismiss behaviour is written once:

```tsx
import { useEffect, useRef, type ReactNode } from "react";

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A bottom sheet with a backdrop. Closes on backdrop click and on Escape,
 * and moves focus inside on open so keyboard and screen-reader users are not
 * left behind on the page underneath.
 */
export function Sheet({ title, onClose, children }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    // Focus the first control, or the panel itself if the form is empty.
    panel.current?.querySelector<HTMLElement>("input, button, select")?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="sheet"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `Login`**

Create `app/components/Login.tsx`. A single password field — no username, because the password identifies the person and the login screen should reveal nothing about who uses the app.

Requirements:
- One `<input type="password">`, `autoFocus`, `autoComplete="current-password"`, wrapped in a `<form>` so Enter submits.
- Calls `api.login(password)`; on success calls `onSignedIn()`.
- On failure shows `error.message` in an element with `role="alert"`. Clears the password field so a retry starts clean.
- Disables the submit button and shows "Signing in…" while the request is in flight.
- The app name and a one-line tagline above the field.

- [ ] **Step 5: Write `BalanceCard`**

Create `app/components/BalanceCard.tsx`.

Props: `{ me: User; users: User[]; balances: Balances; onSettle: (transfer: Transfer) => void }`.

Requirements:
- Build a `Map<number, string>` of user id → name once, and use it for every lookup. Fall back to `"Someone"` for an unknown id rather than rendering `undefined`.
- If `balances.transfers` is empty, render "All settled up" and nothing else.
- Phrase each transfer from the current user's point of view: `fromUser === me.id` → "You owe {name}"; `toUser === me.id` → "{name} owes you"; otherwise → "{from} owes {to}" (only reachable with three users).
- Show the amount via `formatUsd`, large and tabular.
- A "Settle up" button per transfer that calls `onSettle(transfer)`.

- [ ] **Step 6: Write `ActivityFeed`**

Create `app/components/ActivityFeed.tsx`.

Props: `{ me: User; users: User[]; expenses: Expense[]; settlements: Settlement[]; onSelectExpense: (e: Expense) => void; onDeleteSettlement: (s: Settlement) => void }`.

Requirements:
- Merge expenses and settlements into one list of discriminated-union items: `{ kind: "expense"; ... } | { kind: "settlement"; ... }`.
- Sort by `date` descending, then `createdAt` descending, so same-day entries keep a stable order.
- Group under month headings (`"October 2026"`), formatted by parsing the `YYYY-MM-DD` string into numbers and indexing a month-name array. **Do not use `new Date("2026-10-01")`** — it parses as UTC midnight and renders as September 30th for anyone west of UTC.
- Expense row: description, amount, and a subtitle `"{payer} paid · you owe {share}"`, or `"you paid · you get back {total − your share}"` when `paidBy === me.id`, or `"{payer} paid · not your expense"` when the user has no split. Tapping the row calls `onSelectExpense`.
- Settlement row: `"{from} paid {to}"` with the amount and the date, visually distinguished from expenses. Offers delete via `onDeleteSettlement`.
- Empty state: "No expenses yet. Tap + to add the first one."

- [ ] **Step 7: Write `ExpenseSheet`**

Create `app/components/ExpenseSheet.tsx`. Used for both create and edit — one form, two modes, so validation and layout exist once.

Props: `{ me: User; users: User[]; expense: Expense | null; onSubmit: (input: ExpenseInput) => Promise<void>; onDelete: (() => Promise<void>) | null; onClose: () => void }`.

Requirements:
- `expense === null` means create: amount empty, description empty, date today, `paidBy = me.id`, all users checked. Otherwise prefill from `expense`, with participants taken from `expense.splits.map(s => s.userId)` and amount from `formatCentsPlain`.
- Today's date must come from local time, not `toISOString()` (which is UTC and gives the wrong day in the evening in US timezones):
  ```ts
  const todayLocal = () => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
  };
  ```
- Amount input: `type="text"`, `inputMode="decimal"`, so the phone shows a numeric keypad without rejecting a typed `.`.
- Parse the amount with `parseDollarsToCents`. If it returns `null`, or the amount is `0`, or `> MAX_AMOUNT_CENTS`, or the description is blank, or no participant is checked — show an inline message and do not submit.
- Live preview under the checkboxes: `"$X.XX each"` using `formatUsd(Math.floor(cents / n))`, with "(uneven, rounded to the cent)" appended when `cents % n !== 0`.
- Keep the sheet open and preserve input if `onSubmit` rejects, showing the error. A dropped connection must not lose what the user typed.
- In edit mode, a "Delete" button that asks `window.confirm("Delete this expense?")` before calling `onDelete`.

- [ ] **Step 8: Write `SettleSheet`**

Create `app/components/SettleSheet.tsx`.

Props: `{ users: User[]; initial: Transfer; onSubmit: (input: SettlementInput) => Promise<void>; onClose: () => void }`.

Requirements:
- Prefill direction and amount from `initial` (the transfer the balance card suggested); date defaults to today, using the same local-date helper as `ExpenseSheet`.
- Sentence-shaped layout: `[from ▾] paid [to ▾]`, then the amount, then the date.
- Reject `fromUser === toUser` and a non-positive or unparseable amount with an inline message.
- Same keep-open-on-failure behaviour as `ExpenseSheet`.

- [ ] **Step 9: Write `App`**

Create `app/App.tsx`. The only stateful component: holds `AppState`, reloads it from every mutation response, and decides which view is showing.

Requirements:
- State: `state: AppState | null`, `status: "loading" | "signed-out" | "ready" | "error"`, `error: string | null`, and `sheet: { kind: "expense"; expense: Expense | null } | { kind: "settle"; initial: Transfer } | null`.
- On mount, call `api.state()`. A `401` means not signed in — show `Login` rather than an error; the session cookie is checked by asking the server, so no auth state is duplicated on the client.
- Mutations call the API and set `state` from the response wholesale. No local patching: the server owns the balance math.
- Any `401` from a later call drops back to `Login` (the session expired or the secret was rotated).
- Sign-out calls `api.logout()`, then clears state and shows `Login`.
- Header shows the app name and the current user's name as a menu button revealing "Sign out".
- A floating `+` button opens the create-expense sheet.
- Render `BalanceCard` and `ActivityFeed` from `state`.

- [ ] **Step 10: Replace the placeholder entry point**

Replace `app/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

createRoot(root).render(<App />);
```

- [ ] **Step 11: Verify it builds and typechecks**

Run: `npx tsc --noEmit && npx vite build`
Expected: no type errors; build writes `dist/client`.

- [ ] **Step 12: Check it renders with no server**

Run: `npx vite` and open the printed URL.
Expected: the login screen renders and is styled. Submitting a password shows a connection error (no Worker running yet) rather than a blank screen or an unhandled rejection.

- [ ] **Step 13: Commit**

```bash
git add app index.html
git commit -m "feat: mobile-first UI for expenses, balances, and settling up"
```

---

## Task 3: Backend API

Depends on Task 1's `src/lib/split.ts` and `src/lib/balances.ts`. Start only after Task 1 is committed.

**Files:**
- Create: `src/auth.ts`, `src/db.ts`, `src/validate.ts`, `src/state.ts`
- Modify: `src/index.ts` (replace the placeholder)
- Create: `tests/api.test.ts`

- [ ] **Step 1: Write `src/auth.ts`**

```ts
import type { User } from "../shared/types";

const COOKIE_NAME = "splitsies_session";
const MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

/** Imports a secret as an HMAC-SHA256 key. */
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function hmacBase64Url(secret: string, message: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(message),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncode(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Hashes a password for storage and lookup.
 *
 * Deterministic and unsalted by necessity: the password alone identifies the
 * user, so login must be able to look up a row by hash without first knowing
 * whose salt to use. The secret pepper is what makes this safe enough — a
 * leaked database is a column of HMACs that cannot be attacked offline
 * without a secret held only in Cloudflare's secret store. Accepted
 * trade-off: no key stretching. See the design doc's threat model.
 */
export async function hashPassword(password: string, pepper: string): Promise<string> {
  return hmacBase64Url(pepper, password);
}

/** Issues a signed session token: `<userId>.<issuedAtMs>.<signature>`. */
export async function signSession(userId: number, secret: string): Promise<string> {
  const payload = `${userId}.${Date.now()}`;
  return `${payload}.${await hmacBase64Url(secret, payload)}`;
}

/**
 * Verifies a session token and returns its user id.
 *
 * Returns null for anything malformed, mis-signed, or older than the maximum
 * age, so callers have a single falsy path to handle.
 */
export async function verifySession(
  token: string,
  secret: string,
): Promise<number | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [rawUserId, rawIssuedAt, signature] = parts as [string, string, string];

  const expected = await hmacBase64Url(secret, `${rawUserId}.${rawIssuedAt}`);
  if (!timingSafeEqual(signature, expected)) return null;

  const userId = Number(rawUserId);
  const issuedAt = Number(rawIssuedAt);
  if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(issuedAt)) return null;
  if (Date.now() - issuedAt > MAX_AGE_SECONDS * 1000) return null;

  return userId;
}

/** Constant-time string comparison, to avoid leaking a signature byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * `Set-Cookie` value for a new session.
 *
 * SameSite=Lax rather than Strict: Strict would drop the cookie when the app
 * is opened from a link in a messaging app, which is how it will usually be
 * opened. HttpOnly keeps it away from any script on the page.
 */
export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearedSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/** Reads the session token out of a request's Cookie header. */
export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=") || null;
  }
  return null;
}

export type { User };
```

- [ ] **Step 2: Write `src/db.ts`**

All SQL lives here, and this is the only file that maps snake_case columns to camelCase fields. Implement these exported functions:

```ts
import type { Expense, ExpenseInput, Settlement, SettlementInput, User } from "../shared/types";
import { splitEqually } from "./lib/split";

export async function listUsers(db: D1Database): Promise<User[]>;
export async function findUserById(db: D1Database, id: number): Promise<User | null>;
export async function findUserByPasswordHash(db: D1Database, hash: string): Promise<User | null>;
export async function listExpenses(db: D1Database): Promise<Expense[]>;
export async function listSettlements(db: D1Database): Promise<Settlement[]>;
export async function createExpense(db: D1Database, input: ExpenseInput, createdBy: number): Promise<void>;
export async function updateExpense(db: D1Database, id: number, input: ExpenseInput): Promise<boolean>;
export async function deleteExpense(db: D1Database, id: number): Promise<boolean>;
export async function createSettlement(db: D1Database, input: SettlementInput): Promise<void>;
export async function deleteSettlement(db: D1Database, id: number): Promise<boolean>;
```

Requirements:
- `listExpenses` must avoid N+1 queries: one `SELECT` for expenses, one `SELECT` for all splits, then group the splits in memory by `expense_id`. Order by `date DESC, created_at DESC, id DESC`.
- `createExpense` computes shares with `splitEqually(input.amountCents, input.participants)` and writes the expense row and its split rows in a single `db.batch([...])`. D1 has no interactive transactions, but `batch` is atomic — a half-written expense with no splits would corrupt every balance.
  Getting the new id inside a batch is awkward, so use `RETURNING id` on the insert via a first `db.prepare(...).first<{ id: number }>()`, then batch the split inserts; if the split batch throws, delete the orphaned expense row in the `catch` and rethrow.
- `updateExpense` returns `false` if no row has that id. Otherwise batch: the `UPDATE`, a `DELETE FROM expense_splits WHERE expense_id = ?`, and the new split inserts. Replacing rather than merging shares is what keeps edits from duplicating splits.
- `deleteExpense` returns `false` when nothing matched; splits go with it via `ON DELETE CASCADE`.
- `createdAt` values are `new Date().toISOString()`.

- [ ] **Step 3: Write `src/validate.ts`**

```ts
import type { ExpenseInput, SettlementInput } from "../shared/types";
import { MAX_AMOUNT_CENTS } from "../shared/money";

/** Returns a user-facing message, or null when the input is acceptable. */
export function validateExpense(input: unknown, userIds: Set<number>): string | null;
export function validateSettlement(input: unknown, userIds: Set<number>): string | null;
```

Both must treat the input as genuinely unknown — it arrives from `request.json()` and may be any shape at all. Check, in order: it is a non-null object; required fields are present and of the right type; then the value rules.

Rules for an expense, with the exact message to return:
- amount not a positive safe integer → `"Enter an amount greater than zero."`
- amount `> MAX_AMOUNT_CENTS` → `"That amount looks too large."`
- description blank after trimming → `"Add a short description."`
- trimmed description longer than 200 → `"Keep the description under 200 characters."`
- date not matching `/^\d{4}-\d{2}-\d{2}$/`, or not a real calendar date → `"Enter a valid date."`
- `paidBy` not in `userIds` → `"Unknown payer."`
- `participants` not a non-empty array, or containing a duplicate or unknown id → `"Choose at least one person to split with."`

Validate that the date is real by round-tripping it, which catches `2026-02-30`:

```ts
const [year, month, day] = date.split("-").map(Number) as [number, number, number];
const probe = new Date(Date.UTC(year, month - 1, day));
const isRealDate =
  probe.getUTCFullYear() === year &&
  probe.getUTCMonth() === month - 1 &&
  probe.getUTCDate() === day;
```

Rules for a settlement: the same amount and date rules, plus `fromUser` and `toUser` both in `userIds` and different from each other → `"A settlement needs two different people."`

- [ ] **Step 4: Write `src/state.ts`**

```ts
import type { AppState, User } from "../shared/types";
import { computeBalances } from "./lib/balances";
import { listExpenses, listSettlements, listUsers } from "./db";

/**
 * Assembles the whole client-visible state.
 *
 * Every mutation handler returns this, so the client replaces its state
 * wholesale and can never disagree with the server about what anyone owes.
 */
export async function buildState(db: D1Database, me: User): Promise<AppState> {
  const [users, expenses, settlements] = await Promise.all([
    listUsers(db),
    listExpenses(db),
    listSettlements(db),
  ]);

  return {
    me,
    users,
    expenses,
    settlements,
    balances: computeBalances(users, expenses, settlements),
  };
}
```

- [ ] **Step 5: Write `src/index.ts`**

Replace the placeholder with the Hono app. Route wiring only — all logic lives in the modules above.

Requirements:
- `const app = new Hono<{ Bindings: Env; Variables: { user: User } }>()`.
- `app.use("/api/*", ...)` auth middleware that skips `POST /api/login` and `POST /api/logout`: read the cookie, `verifySession`, `findUserById`, then `c.set("user", user)`. Any failure returns `c.json({ error: "Not signed in." }, 401)`.
- `POST /api/login`: read `{ password }`; a non-string or empty password gets the same `401` as a wrong one. `hashPassword(password, c.env.PASSWORD_PEPPER)`, `findUserByPasswordHash`. On no match, `c.json({ error: "Incorrect password." }, 401)`. On match, set the cookie via `c.header("set-cookie", sessionCookie(await signSession(user.id, c.env.SESSION_SECRET)))` and return `{ me: user }`.
- `POST /api/logout`: set `clearedSessionCookie()`, return `{ ok: true }`.
- `GET /api/state`: `buildState(c.env.DB, c.get("user"))`.
- Mutations: validate, act, then return `buildState(...)`. Validation failures are `400` with the validator's message. A missing id on edit or delete is `404` with `{ error: "That entry no longer exists." }`.
- `app.onError`: log with `console.error` (visible in `wrangler tail`) and return `c.json({ error: "Something went wrong." }, 500)`. Never leak an internal message to the client.
- `app.notFound` for unmatched `/api/*`: `c.json({ error: "Not found." }, 404)`.
- Export `default app`.

- [ ] **Step 6: Write the API tests**

Create `tests/api.test.ts`. Use `SELF.fetch` from `cloudflare:test` so the real Worker, router, and D1 are exercised together.

```ts
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
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/api.test.ts`
Expected: PASS. Fix the implementation, not the tests, unless a test is demonstrably asserting the wrong thing.

- [ ] **Step 8: Full verification**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; every test passes.

- [ ] **Step 9: Commit**

```bash
git add src tests/api.test.ts
git commit -m "feat: auth, expense and settlement API on D1"
```

---

## Task 4: Integration, Seeding, and Docs

- [ ] **Step 1: Add a seed helper for local development**

Create `scripts/seed.sql.example` holding commented `INSERT` statements for the two users, with `REPLACE_WITH_HASH` placeholders, and explain in `DEPLOYMENT.md` how to generate a hash.

Because the hash is `HMAC-SHA256(password, PASSWORD_PEPPER)` and the pepper is a Worker secret, the hash must be computed with the same pepper the Worker will use. Provide `scripts/hash-password.mjs`:

```js
// Usage: node scripts/hash-password.mjs <pepper> <password>
// Prints the base64url hash to paste into a seed INSERT.
const [pepper, password] = process.argv.slice(2);
if (!pepper || !password) {
  console.error("Usage: node scripts/hash-password.mjs <pepper> <password>");
  process.exit(1);
}
const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(pepper),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"],
);
const signature = await crypto.subtle.sign(
  "HMAC",
  key,
  new TextEncoder().encode(password),
);
const base64 = Buffer.from(signature).toString("base64");
console.log(base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
```

This must produce byte-identical output to `hashPassword` in `src/auth.ts`. Verify with a test in `tests/api.test.ts` or by comparing one value by hand.

- [ ] **Step 2: Run the app end to end locally**

```bash
npx wrangler d1 migrations apply splitsies --local
node scripts/hash-password.mjs local-dev-pepper anuj-local
# paste the hash into the INSERT below
npx wrangler d1 execute splitsies --local --command \
  "INSERT INTO users (name, password_hash, created_at) VALUES ('Anuj', '<hash>', '2026-10-11T00:00:00Z')"
npm run build
npx wrangler dev
```

Put `PASSWORD_PEPPER` and `SESSION_SECRET` in `.dev.vars` (already gitignored).

Expected: signing in with `anuj-local` works; adding an expense updates the balance; sign-out returns to the login screen; reloading after sign-in stays signed in.

- [ ] **Step 3: Confirm `/api/*` is not shadowed by the SPA fallback**

Run: `curl -i http://127.0.0.1:8787/api/state`
Expected: `401` with a JSON body. **If this returns HTML, `run_worker_first` is not working** and every API call is being answered by `index.html`.

Also run: `curl -i http://127.0.0.1:8787/some/deep/link`
Expected: `200` with the HTML shell, so client-side deep links work.

- [ ] **Step 4: Write `CLAUDE.md`**

Cover: what the app is and who uses it; the architecture in a paragraph; the file map; commands (dev, test, build, deploy, migrate); the conventions that matter (integer cents, balance math server-side only, all SQL in `db.ts`, types in `shared/types.ts`, mutations return full state); and a "Decisions" section summarising each decision from the design doc with its reasoning, linking to the spec for the long form. Note explicitly that `noUncheckedIndexedAccess` is on.

- [ ] **Step 5: Write `DEPLOYMENT.md`**

Cover, as copy-pasteable steps: prerequisites; `wrangler login`; `wrangler d1 create splitsies` and pasting the id into `wrangler.jsonc`; `wrangler d1 migrations apply splitsies --remote`; generating the two secrets with `openssl rand -base64 32` and setting them with `wrangler secret put`; generating password hashes and seeding users with `wrangler d1 execute --remote`; `npm run deploy`; attaching a custom domain in the dashboard (Workers & Pages → the Worker → Settings → Domains & Routes → Add custom domain) and the DNS record it creates; verifying with `curl`. Then a maintenance section: adding a third user, changing a password, rotating `SESSION_SECRET` (logs everyone out) versus rotating `PASSWORD_PEPPER` (invalidates all passwords, every hash must be regenerated), backing up with `wrangler d1 export`, and tailing logs with `wrangler tail`.

- [ ] **Step 6: Final verification**

Run: `npx tsc --noEmit && npx vitest run && npm run build && npx wrangler deploy --dry-run --outdir /tmp/splitsies-verify`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: add CLAUDE.md, DEPLOYMENT.md, and password seeding helper"
```

---

## Self-Review Notes

**Spec coverage check.** Every spec section maps to a task: data model → Task 0 (done); split model → Task 1; balance computation → Task 1; authentication → Task 3; API → Task 3; UI → Task 2; error handling → Tasks 2 and 3; testing → Tasks 1 and 3; deliverables → Task 4.

**Known gaps deliberately left to implementation judgement.** The CSS is specified by requirement rather than by literal stylesheet, and the five larger React components by behavioural requirement rather than full source. Writing 600 lines of literal CSS and JSX into a plan would be transcription rather than planning, and the requirement lists are precise about every decision that could be got wrong — date handling, tabular numerals, touch targets, keep-open-on-failure, and the exact user-facing strings for validation.

**Type consistency check.** `splitEqually(amountCents, participantIds)` and `computeBalances(users, expenses, settlements)` are used with those exact signatures in Tasks 1, 3, and 4. `ExpenseInput.participants` is the field name throughout. `Transfer` uses `fromUser`/`toUser`/`amountCents` in `shared/types.ts`, `balances.ts`, the tests, and both sheet components.
