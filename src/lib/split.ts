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
