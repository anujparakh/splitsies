/**
 * The API contract, shared by the Worker and the React client.
 *
 * This is the single source of truth for request and response shapes. The
 * Worker imports it to type its handlers; the client imports it to type its
 * fetches. Changing a shape here surfaces as a type error on both sides at
 * once, which is the whole point of keeping it in one file.
 *
 * Wire format is camelCase; the D1 columns are snake_case. The mapping happens
 * in `src/db.ts` and nowhere else.
 */

export interface User {
  id: number;
  name: string;
}

export interface ExpenseSplit {
  userId: number;
  /** This user's share of the expense, in cents. */
  shareCents: number;
}

export interface Expense {
  id: number;
  description: string;
  amountCents: number;
  /** Calendar day, `YYYY-MM-DD`. */
  date: string;
  /** User who fronted the money. */
  paidBy: number;
  createdBy: number;
  /** ISO-8601 UTC, used only to break ties when two expenses share a date. */
  createdAt: string;
  /** Materialized shares. Always sums exactly to `amountCents`. */
  splits: ExpenseSplit[];
}

export interface Settlement {
  id: number;
  /** User who handed over the money. */
  fromUser: number;
  /** User who received it. */
  toUser: number;
  amountCents: number;
  date: string;
  createdAt: string;
}

/** A user's net position, in cents. Positive means the group owes them. */
export interface Balance {
  userId: number;
  netCents: number;
}

/** A concrete instruction: `fromUser` should pay `toUser` this much. */
export interface Transfer {
  fromUser: number;
  toUser: number;
  amountCents: number;
}

export interface Balances {
  /** One entry per user. Always sums to zero across all users. */
  nets: Balance[];
  /** Minimal set of payments that would bring every net to zero. */
  transfers: Transfer[];
}

/**
 * Everything the home screen needs, in one response.
 *
 * Every mutation returns a fresh `AppState` rather than a patch, so the client
 * can replace its state wholesale and never drift out of sync with the
 * server's balance math.
 */
export interface AppState {
  me: User;
  users: User[];
  /** Newest first: `date` descending, then `createdAt` descending. */
  expenses: Expense[];
  /** Newest first, same ordering rule. */
  settlements: Settlement[];
  balances: Balances;
}

/** Body of `POST /api/expenses` and `PUT /api/expenses/:id`. */
export interface ExpenseInput {
  description: string;
  amountCents: number;
  date: string;
  paidBy: number;
  /** User ids sharing the cost. Must be non-empty. Split equally. */
  participants: number[];
}

/** Body of `POST /api/settlements`. */
export interface SettlementInput {
  fromUser: number;
  toUser: number;
  amountCents: number;
  date: string;
}

/** Body of `POST /api/login`. The password alone identifies the user. */
export interface LoginInput {
  password: string;
}

/** Shape of every non-2xx response body. `error` is safe to show the user. */
export interface ApiError {
  error: string;
}
