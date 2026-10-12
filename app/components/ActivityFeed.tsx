import { Fragment, useMemo } from "react";
import type { Expense, Settlement, User } from "../../shared/types";
import { categoryLabel } from "../../shared/categories";
import { formatUsd } from "../../shared/money";
import { CategoryIcon } from "./CategoryIcon";
import { CloseIcon, ReceiptIcon, SettlementIcon } from "./icons";

interface ActivityFeedProps {
  me: User;
  users: User[];
  expenses: Expense[];
  settlements: Settlement[];
  onSelectExpense: (expense: Expense) => void;
  onDeleteSettlement: (settlement: Settlement) => void;
}

type FeedItem =
  | { kind: "expense"; expense: Expense; date: string; createdAt: string }
  | { kind: "settlement"; settlement: Settlement; date: string; createdAt: string };

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Parses a `YYYY-MM-DD` string into numeric parts without timezone games. */
function parseDateParts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return { year, month, day };
}

function monthHeading(date: string): string {
  const { year, month } = parseDateParts(date);
  return `${MONTH_NAMES[month - 1] ?? "Unknown"} ${year}`;
}

function shortDate(date: string): string {
  const { month, day } = parseDateParts(date);
  const name = MONTH_NAMES[month - 1] ?? "";
  return `${name.slice(0, 3)} ${day}`;
}

/** Sortable key: same-day entries keep a stable order by `createdAt`. */
function sortKey(item: FeedItem): string {
  return `${item.date}T${item.createdAt}`;
}

export function ActivityFeed({
  me,
  users,
  expenses,
  settlements,
  onSelectExpense,
  onDeleteSettlement,
}: ActivityFeedProps) {
  const nameById = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);
  const nameOf = (id: number) => nameById.get(id) ?? "Someone";

  const groups = useMemo(() => {
    const items: FeedItem[] = [
      ...expenses.map((expense): FeedItem => ({
        kind: "expense",
        expense,
        date: expense.date,
        createdAt: expense.createdAt,
      })),
      ...settlements.map((settlement): FeedItem => ({
        kind: "settlement",
        settlement,
        date: settlement.date,
        createdAt: settlement.createdAt,
      })),
    ];

    items.sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0));

    const byMonth = new Map<string, FeedItem[]>();
    for (const item of items) {
      const { year, month } = parseDateParts(item.date);
      const key = `${year}-${String(month).padStart(2, "0")}`;
      const bucket = byMonth.get(key);
      if (bucket) bucket.push(item);
      else byMonth.set(key, [item]);
    }
    return [...byMonth.entries()];
  }, [expenses, settlements]);

  if (expenses.length === 0 && settlements.length === 0) {
    return (
      <div className="feed-empty">
        <ReceiptIcon size={32} />
        <p>No expenses yet. Tap + to add the first one.</p>
      </div>
    );
  }

  return (
    <>
      {groups.map(([key, items]) => (
        <Fragment key={key}>
          <h2 className="feed-month">{monthHeading(items[0]!.date).toUpperCase()}</h2>
          <div className="feed-group">
            {items.map((item) =>
              item.kind === "expense" ? (
                <ExpenseRow
                  key={`expense-${item.expense.id}`}
                  expense={item.expense}
                  me={me}
                  nameOf={nameOf}
                  onSelect={onSelectExpense}
                />
              ) : (
                <SettlementRow
                  key={`settlement-${item.settlement.id}`}
                  settlement={item.settlement}
                  nameOf={nameOf}
                  onDelete={onDeleteSettlement}
                />
              ),
            )}
          </div>
        </Fragment>
      ))}
    </>
  );
}

function ExpenseRow({
  expense,
  me,
  nameOf,
  onSelect,
}: {
  expense: Expense;
  me: User;
  nameOf: (id: number) => string;
  onSelect: (expense: Expense) => void;
}) {
  const mySplit = expense.splits.find((s) => s.userId === me.id);
  const payerName = nameOf(expense.paidBy);

  let subtitle: string;
  if (expense.paidBy === me.id) {
    const mine = mySplit?.shareCents ?? 0;
    subtitle = `you paid · you get back ${formatUsd(expense.amountCents - mine)}`;
  } else if (mySplit) {
    subtitle = `${payerName} paid · you owe ${formatUsd(mySplit.shareCents)}`;
  } else {
    subtitle = `${payerName} paid · not your expense`;
  }

  return (
    <button type="button" className="feed-row" onClick={() => onSelect(expense)}>
      <span className="feed-row-avatar" title={categoryLabel(expense.category)}>
        <CategoryIcon category={expense.category} />
        <span className="sr-only">{categoryLabel(expense.category)}</span>
      </span>
      <span className="feed-row-main">
        <span className="feed-row-title">{expense.description}</span>
        <span className="feed-row-subtitle">{subtitle}</span>
      </span>
      <span className="feed-row-amount">{formatUsd(expense.amountCents)}</span>
    </button>
  );
}

function SettlementRow({
  settlement,
  nameOf,
  onDelete,
}: {
  settlement: Settlement;
  nameOf: (id: number) => string;
  onDelete: (settlement: Settlement) => void;
}) {
  return (
    <div className="feed-row feed-row-static feed-row-settlement">
      <span className="feed-row-avatar feed-row-avatar-settlement">
        <SettlementIcon />
        <span className="sr-only">Settlement</span>
      </span>
      <span className="feed-row-main">
        <span className="feed-row-title">
          {nameOf(settlement.fromUser)} paid {nameOf(settlement.toUser)}
        </span>
        <span className="feed-row-subtitle">Settlement · {shortDate(settlement.date)}</span>
      </span>
      <span className="feed-row-amount">{formatUsd(settlement.amountCents)}</span>
      <button
        type="button"
        className="feed-row-delete"
        aria-label="Delete settlement"
        onClick={() => onDelete(settlement)}
      >
        <CloseIcon size={18} />
      </button>
    </div>
  );
}
