/**
 * All SQL lives here, and this is the only file that maps snake_case D1
 * columns to the camelCase fields defined in `shared/types.ts`.
 */
import type {
  Expense,
  ExpenseInput,
  ExpenseSplit,
  Settlement,
  SettlementInput,
  User,
} from "../shared/types";
import { splitEqually } from "./lib/split";

interface UserRow {
  id: number;
  name: string;
}

interface UserRowWithHash extends UserRow {
  password_hash: string;
}

interface ExpenseRow {
  id: number;
  description: string;
  amount_cents: number;
  date: string;
  paid_by: number;
  created_by: number;
  created_at: string;
}

interface SplitRow {
  expense_id: number;
  user_id: number;
  share_cents: number;
}

interface SettlementRow {
  id: number;
  from_user: number;
  to_user: number;
  amount_cents: number;
  date: string;
  created_at: string;
}

export async function listUsers(db: D1Database): Promise<User[]> {
  const { results } = await db
    .prepare("SELECT id, name FROM users ORDER BY id ASC")
    .all<UserRow>();
  return results.map((r) => ({ id: r.id, name: r.name }));
}

export async function findUserById(db: D1Database, id: number): Promise<User | null> {
  const row = await db
    .prepare("SELECT id, name FROM users WHERE id = ?")
    .bind(id)
    .first<UserRow>();
  return row ? { id: row.id, name: row.name } : null;
}

export async function findUserByPasswordHash(
  db: D1Database,
  hash: string,
): Promise<User | null> {
  const row = await db
    .prepare("SELECT id, name, password_hash FROM users WHERE password_hash = ?")
    .bind(hash)
    .first<UserRowWithHash>();
  return row ? { id: row.id, name: row.name } : null;
}

export async function listExpenses(db: D1Database): Promise<Expense[]> {
  const [expensesResult, splitsResult] = await Promise.all([
    db
      .prepare(
        "SELECT id, description, amount_cents, date, paid_by, created_by, created_at FROM expenses ORDER BY date DESC, created_at DESC, id DESC",
      )
      .all<ExpenseRow>(),
    db
      .prepare("SELECT expense_id, user_id, share_cents FROM expense_splits")
      .all<SplitRow>(),
  ]);

  const splitsByExpense = new Map<number, ExpenseSplit[]>();
  for (const row of splitsResult.results) {
    const list = splitsByExpense.get(row.expense_id) ?? [];
    list.push({ userId: row.user_id, shareCents: row.share_cents });
    splitsByExpense.set(row.expense_id, list);
  }

  return expensesResult.results.map((row) => ({
    id: row.id,
    description: row.description,
    amountCents: row.amount_cents,
    date: row.date,
    paidBy: row.paid_by,
    createdBy: row.created_by,
    createdAt: row.created_at,
    splits: splitsByExpense.get(row.id) ?? [],
  }));
}

export async function listSettlements(db: D1Database): Promise<Settlement[]> {
  const { results } = await db
    .prepare(
      "SELECT id, from_user, to_user, amount_cents, date, created_at FROM settlements ORDER BY date DESC, created_at DESC, id DESC",
    )
    .all<SettlementRow>();

  return results.map((row) => ({
    id: row.id,
    fromUser: row.from_user,
    toUser: row.to_user,
    amountCents: row.amount_cents,
    date: row.date,
    createdAt: row.created_at,
  }));
}

export async function createExpense(
  db: D1Database,
  input: ExpenseInput,
  createdBy: number,
): Promise<void> {
  const splits = splitEqually(input.amountCents, input.participants);
  const createdAt = new Date().toISOString();

  const inserted = await db
    .prepare(
      "INSERT INTO expenses (description, amount_cents, date, paid_by, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(input.description, input.amountCents, input.date, input.paidBy, createdBy, createdAt)
    .first<{ id: number }>();

  if (!inserted) throw new Error("failed to insert expense row");
  const expenseId = inserted.id;

  try {
    await db.batch(
      splits.map((s) =>
        db
          .prepare(
            "INSERT INTO expense_splits (expense_id, user_id, share_cents) VALUES (?, ?, ?)",
          )
          .bind(expenseId, s.userId, s.shareCents),
      ),
    );
  } catch (err) {
    // The expense row was written but its splits were not: delete it rather
    // than leave an expense with no splits silently corrupting every balance.
    await db.prepare("DELETE FROM expenses WHERE id = ?").bind(expenseId).run();
    throw err;
  }
}

export async function updateExpense(
  db: D1Database,
  id: number,
  input: ExpenseInput,
): Promise<boolean> {
  const existing = await db
    .prepare("SELECT id FROM expenses WHERE id = ?")
    .bind(id)
    .first<{ id: number }>();
  if (!existing) return false;

  const splits = splitEqually(input.amountCents, input.participants);

  await db.batch([
    db
      .prepare(
        "UPDATE expenses SET description = ?, amount_cents = ?, date = ?, paid_by = ? WHERE id = ?",
      )
      .bind(input.description, input.amountCents, input.date, input.paidBy, id),
    db.prepare("DELETE FROM expense_splits WHERE expense_id = ?").bind(id),
    ...splits.map((s) =>
      db
        .prepare(
          "INSERT INTO expense_splits (expense_id, user_id, share_cents) VALUES (?, ?, ?)",
        )
        .bind(id, s.userId, s.shareCents),
    ),
  ]);

  return true;
}

export async function deleteExpense(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM expenses WHERE id = ?").bind(id).run();
  return result.meta.rows_written > 0;
}

export async function createSettlement(
  db: D1Database,
  input: SettlementInput,
): Promise<void> {
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO settlements (from_user, to_user, amount_cents, date, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(input.fromUser, input.toUser, input.amountCents, input.date, createdAt)
    .run();
}

export async function deleteSettlement(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM settlements WHERE id = ?").bind(id).run();
  return result.meta.rows_written > 0;
}
