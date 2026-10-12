import { useMemo } from "react";
import type { Balances, Transfer, User } from "../../shared/types";
import { formatUsd } from "../../shared/money";

interface BalanceCardProps {
  me: User;
  users: User[];
  balances: Balances;
  onSettle: (transfer: Transfer) => void;
}

/**
 * The one number that matters: what the current user owes, or is owed,
 * phrased from their point of view. Collapses to "All settled up" at zero.
 */
export function BalanceCard({ me, users, balances, onSettle }: BalanceCardProps) {
  const nameById = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);
  const nameOf = (id: number) => nameById.get(id) ?? "Someone";

  if (balances.transfers.length === 0) {
    return (
      <div className="balance-card">
        <p className="all-settled">All settled up</p>
      </div>
    );
  }

  return (
    <div className="balance-card">
      {balances.transfers.map((transfer, index) => {
        const amount = formatUsd(transfer.amountCents);
        let label: string;
        if (transfer.fromUser === me.id) {
          label = `You owe ${nameOf(transfer.toUser)}`;
        } else if (transfer.toUser === me.id) {
          label = `${nameOf(transfer.fromUser)} owes you`;
        } else {
          label = `${nameOf(transfer.fromUser)} owes ${nameOf(transfer.toUser)}`;
        }

        return (
          <div className="balance-row" key={`${transfer.fromUser}-${transfer.toUser}-${index}`}>
            <span className="balance-label">{label}</span>
            <span className="balance-amount">{amount}</span>
            <button
              type="button"
              className="settle-button"
              onClick={() => onSettle(transfer)}
            >
              Settle up
            </button>
          </div>
        );
      })}
    </div>
  );
}
