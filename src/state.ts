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
