import { useCallback, useEffect, useState } from "react";
import type { AppState, Expense, ExpenseInput, Settlement, SettlementInput, Transfer } from "../shared/types";
import { api, isUnauthorized } from "./api";
import { ActivityFeed } from "./components/ActivityFeed";
import { BalanceCard } from "./components/BalanceCard";
import { ExpenseSheet } from "./components/ExpenseSheet";
import { Login } from "./components/Login";
import { SettleSheet } from "./components/SettleSheet";

type Status = "loading" | "signed-out" | "ready" | "error";

type SheetState =
  | { kind: "expense"; expense: Expense | null }
  | { kind: "settle"; initial: Transfer }
  | null;

/**
 * The only stateful component. Holds the server's `AppState` and reloads it
 * wholesale from every mutation response, so the client can never disagree
 * with the server about what anyone owes.
 */
export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api
      .state()
      .then((s) => {
        setState(s);
        setStatus("ready");
      })
      .catch((err) => {
        if (isUnauthorized(err)) {
          setStatus("signed-out");
        } else {
          setError(err instanceof Error ? err.message : "Something went wrong.");
          setStatus("error");
        }
      });
  }, []);

  const handleSignedIn = useCallback(() => {
    setStatus("loading");
    setError(null);
    api
      .state()
      .then((s) => {
        setState(s);
        setStatus("ready");
      })
      .catch((err) => {
        if (isUnauthorized(err)) {
          setStatus("signed-out");
        } else {
          setError(err instanceof Error ? err.message : "Something went wrong.");
          setStatus("error");
        }
      });
  }, []);

  const handleSignOut = useCallback(async () => {
    setMenuOpen(false);
    try {
      await api.logout();
    } catch {
      // Sign the user out of the UI regardless of whether the request landed.
    }
    setState(null);
    setStatus("signed-out");
  }, []);

  /** Runs a mutation and applies its fresh state; re-throws so forms can show the error. */
  const applyMutation = useCallback(async (run: () => Promise<AppState>) => {
    try {
      const next = await run();
      setState(next);
    } catch (err) {
      if (isUnauthorized(err)) {
        setState(null);
        setStatus("signed-out");
      }
      throw err;
    }
  }, []);

  const handleCreateOrUpdateExpense = useCallback(
    async (input: ExpenseInput) => {
      if (sheet?.kind === "expense" && sheet.expense) {
        const id = sheet.expense.id;
        await applyMutation(() => api.updateExpense(id, input));
      } else {
        await applyMutation(() => api.createExpense(input));
      }
      setSheet(null);
    },
    [applyMutation, sheet],
  );

  const handleDeleteExpense = useCallback(async () => {
    if (sheet?.kind !== "expense" || !sheet.expense) return;
    const id = sheet.expense.id;
    await applyMutation(() => api.deleteExpense(id));
    setSheet(null);
  }, [applyMutation, sheet]);

  const handleSettle = useCallback(
    async (input: SettlementInput) => {
      await applyMutation(() => api.createSettlement(input));
      setSheet(null);
    },
    [applyMutation],
  );

  const handleDeleteSettlement = useCallback(
    (settlement: Settlement) => {
      applyMutation(() => api.deleteSettlement(settlement.id)).catch(() => {
        // The feed re-renders from the latest known state; nothing more to do here.
      });
    },
    [applyMutation],
  );

  if (status === "loading") {
    return <div className="app-loading">Loading…</div>;
  }

  if (status === "signed-out") {
    return <Login onSignedIn={handleSignedIn} />;
  }

  if (status === "error" || !state) {
    return (
      <div className="app-shell">
        <p className="banner-error" role="alert">
          {error ?? "Something went wrong."}
        </p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Splitsies</h1>
        <div className="menu-wrap">
          <button
            type="button"
            className="menu-button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            {state.me.name} ▾
          </button>
          {menuOpen && (
            <div className="menu-popover">
              <button type="button" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="app-main">
        <BalanceCard
          me={state.me}
          users={state.users}
          balances={state.balances}
          onSettle={(initial) => setSheet({ kind: "settle", initial })}
        />
        <ActivityFeed
          me={state.me}
          users={state.users}
          expenses={state.expenses}
          settlements={state.settlements}
          onSelectExpense={(expense) => setSheet({ kind: "expense", expense })}
          onDeleteSettlement={handleDeleteSettlement}
        />
      </main>

      <button
        type="button"
        className="fab"
        aria-label="Add expense"
        onClick={() => setSheet({ kind: "expense", expense: null })}
      >
        +
      </button>

      {sheet?.kind === "expense" && (
        <ExpenseSheet
          me={state.me}
          users={state.users}
          expense={sheet.expense}
          onSubmit={handleCreateOrUpdateExpense}
          onDelete={sheet.expense ? handleDeleteExpense : null}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === "settle" && (
        <SettleSheet
          users={state.users}
          initial={sheet.initial}
          onSubmit={handleSettle}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
