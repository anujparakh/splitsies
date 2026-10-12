import { useState } from "react";
import type { CategoryId, Expense, ExpenseInput, User } from "../../shared/types";
import { CATEGORIES, DEFAULT_CATEGORY } from "../../shared/categories";
import { MAX_AMOUNT_CENTS, formatCentsPlain, formatUsd, parseDollarsToCents } from "../../shared/money";
import { CategoryIcon } from "./CategoryIcon";
import { TrashIcon } from "./icons";
import { Sheet } from "./Sheet";

interface ExpenseSheetProps {
  me: User;
  users: User[];
  expense: Expense | null;
  onSubmit: (input: ExpenseInput) => Promise<void>;
  onDelete: (() => Promise<void>) | null;
  onClose: () => void;
}

/** Today's calendar day in the viewer's local time, never UTC. */
function todayLocal(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Create and edit share one form, so validation and layout exist once. */
export function ExpenseSheet({ me, users, expense, onSubmit, onDelete, onClose }: ExpenseSheetProps) {
  const [amount, setAmount] = useState(expense ? formatCentsPlain(expense.amountCents) : "");
  const [description, setDescription] = useState(expense?.description ?? "");
  const [category, setCategory] = useState<CategoryId>(expense?.category ?? DEFAULT_CATEGORY);
  const [date, setDate] = useState(expense?.date ?? todayLocal());
  const [paidBy, setPaidBy] = useState(expense?.paidBy ?? me.id);
  const [participants, setParticipants] = useState<Set<number>>(
    new Set(expense ? expense.splits.map((s) => s.userId) : users.map((u) => u.id)),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleParticipant = (id: number) => {
    setParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const cents = parseDollarsToCents(amount);
    if (cents === null || cents === 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (cents > MAX_AMOUNT_CENTS) {
      setError("That amount looks too large.");
      return;
    }
    if (description.trim() === "") {
      setError("Add a short description.");
      return;
    }
    if (participants.size === 0) {
      setError("Choose at least one person to split with.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        description: description.trim(),
        category,
        amountCents: cents,
        date,
        paidBy,
        participants: [...participants],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || submitting) return;
    if (!window.confirm("Delete this expense?")) return;
    setSubmitting(true);
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const previewCents = parseDollarsToCents(amount);
  const n = participants.size;
  const showPreview = previewCents !== null && previewCents > 0 && n > 0;
  const each = showPreview ? Math.floor(previewCents / n) : 0;
  const uneven = showPreview && previewCents % n !== 0;

  return (
    <Sheet title={expense ? "Edit expense" : "Add expense"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="sheet-form">
        <div className="field">
          <label htmlFor="expense-amount">Amount</label>
          <input
            id="expense-amount"
            type="text"
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
          />
        </div>

        <div className="field">
          <label htmlFor="expense-description">Description</label>
          <input
            id="expense-description"
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Groceries"
          />
        </div>

        <fieldset className="field category-field">
          <legend>Category</legend>
          <div className="category-grid">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`category-chip${c.id === category ? " category-chip-selected" : ""}`}
                aria-pressed={c.id === category}
                onClick={() => setCategory(c.id)}
              >
                <CategoryIcon category={c.id} size={22} />
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="expense-date">Date</label>
          <input
            id="expense-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="expense-paidby">Paid by</label>
          <select
            id="expense-paidby"
            value={paidBy}
            onChange={(event) => setPaidBy(Number(event.target.value))}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Split with</label>
          <div className="participants-list">
            {users.map((u) => (
              <label className="checkbox-row" key={u.id}>
                <input
                  type="checkbox"
                  checked={participants.has(u.id)}
                  onChange={() => toggleParticipant(u.id)}
                />
                {u.name}
              </label>
            ))}
          </div>
          {showPreview && (
            <p className="amount-preview">
              {formatUsd(each)} each{uneven ? " (uneven, rounded to the cent)" : ""}
            </p>
          )}
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="sheet-actions">
          {onDelete && (
            <button type="button" className="danger-button" onClick={handleDelete} disabled={submitting}>
              <TrashIcon size={18} />
              Delete
            </button>
          )}
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
