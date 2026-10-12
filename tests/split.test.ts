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
