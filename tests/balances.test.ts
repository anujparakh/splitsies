import { describe, expect, it } from "vitest";
import type { Expense, Settlement, User } from "../shared/types";
import { computeBalances } from "../src/lib/balances";

const USERS: User[] = [
  { id: 1, name: "Anuj", accent: "teal" },
  { id: 2, name: "Ruchi", accent: "teal" },
];

const THREE: User[] = [...USERS, { id: 3, name: "Sam", accent: "teal" }];

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
    category: "food",
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
