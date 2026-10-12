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
