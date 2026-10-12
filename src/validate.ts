/**
 * Validation for request bodies arriving from `request.json()`, which may be
 * any shape at all. Each validator checks shape before values, and returns a
 * user-facing message — or `null` when the input is acceptable — so the
 * caller can respond `400` with that exact string.
 */
import { isCategoryId } from "../shared/categories";
import { MAX_AMOUNT_CENTS } from "../shared/money";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Returns a user-facing message, or null when the input is acceptable. */
export function validateExpense(input: unknown, userIds: Set<number>): string | null {
  if (typeof input !== "object" || input === null) {
    return "Enter an amount greater than zero.";
  }
  const body = input as Record<string, unknown>;

  const { amountCents, category, description, date, paidBy, participants } = body;

  if (!isPositiveSafeInteger(amountCents)) {
    return "Enter an amount greater than zero.";
  }
  if (amountCents > MAX_AMOUNT_CENTS) {
    return "That amount looks too large.";
  }

  if (typeof description !== "string" || description.trim().length === 0) {
    return "Add a short description.";
  }
  if (description.trim().length > 200) {
    return "Keep the description under 200 characters.";
  }

  // Absent is fine — db.ts stores DEFAULT_CATEGORY. Present but unrecognised
  // is a bug in the caller, not something to silently paper over.
  if (category !== undefined && !isCategoryId(category)) {
    return "Pick a category from the list.";
  }

  if (typeof date !== "string" || !isRealDate(date)) {
    return "Enter a valid date.";
  }

  if (typeof paidBy !== "number" || !userIds.has(paidBy)) {
    return "Unknown payer.";
  }

  if (
    !Array.isArray(participants) ||
    participants.length === 0 ||
    !participants.every((p) => typeof p === "number") ||
    new Set(participants).size !== participants.length ||
    !participants.every((p) => userIds.has(p))
  ) {
    return "Choose at least one person to split with.";
  }

  return null;
}

export function validateSettlement(input: unknown, userIds: Set<number>): string | null {
  if (typeof input !== "object" || input === null) {
    return "Enter an amount greater than zero.";
  }
  const body = input as Record<string, unknown>;

  const { amountCents, date, fromUser, toUser } = body;

  if (!isPositiveSafeInteger(amountCents)) {
    return "Enter an amount greater than zero.";
  }
  if (amountCents > MAX_AMOUNT_CENTS) {
    return "That amount looks too large.";
  }

  if (typeof date !== "string" || !isRealDate(date)) {
    return "Enter a valid date.";
  }

  if (typeof fromUser !== "number" || typeof toUser !== "number") {
    return "A settlement needs two different people.";
  }
  if (!userIds.has(fromUser) || !userIds.has(toUser) || fromUser === toUser) {
    return "A settlement needs two different people.";
  }

  return null;
}
