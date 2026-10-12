import { useState } from "react";
import type { SettlementInput, Transfer, User } from "../../shared/types";
import { formatCentsPlain, parseDollarsToCents } from "../../shared/money";
import { Sheet } from "./Sheet";

interface SettleSheetProps {
  users: User[];
  initial: Transfer;
  onSubmit: (input: SettlementInput) => Promise<void>;
  onClose: () => void;
}

/** Today's calendar day in the viewer's local time, never UTC. */
function todayLocal(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function SettleSheet({ users, initial, onSubmit, onClose }: SettleSheetProps) {
  const [fromUser, setFromUser] = useState(initial.fromUser);
  const [toUser, setToUser] = useState(initial.toUser);
  const [amount, setAmount] = useState(formatCentsPlain(initial.amountCents));
  const [date, setDate] = useState(todayLocal());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    if (fromUser === toUser) {
      setError("A settlement needs two different people.");
      return;
    }
    const cents = parseDollarsToCents(amount);
    if (cents === null || cents <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({ fromUser, toUser, amountCents: cents, date });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet title="Settle up" onClose={onClose}>
      <form onSubmit={handleSubmit} className="sheet-form">
        <div className="sentence-row">
          <select
            aria-label="Who paid"
            value={fromUser}
            onChange={(event) => setFromUser(Number(event.target.value))}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <span>paid</span>
          <select
            aria-label="Who was paid"
            value={toUser}
            onChange={(event) => setToUser(Number(event.target.value))}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="settle-amount">Amount</label>
          <input
            id="settle-amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
          />
        </div>

        <div className="field">
          <label htmlFor="settle-date">Date</label>
          <input
            id="settle-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="sheet-actions">
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? "Saving…" : "Settle up"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
