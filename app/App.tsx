import { useCallback, useEffect, useState } from "react";
import type { AppState, Expense, ExpenseInput, Settlement, SettlementInput, Transfer } from "../shared/types";
import { api, isUnauthorized } from "./api";
import { ActivityFeed } from "./components/ActivityFeed";
import { BalanceCard } from "./components/BalanceCard";
import { ExpenseSheet } from "./components/ExpenseSheet";
import { Login } from "./components/Login";
import { SettleSheet } from "./components/SettleSheet";
import { CaretDownIcon, PlusIcon, SignOutIcon } from "./components/icons";
import { ACCENTS, DEFAULT_ACCENT, type AccentId } from "../shared/accents";

/**
 * Swatch colours for the picker only.
 *
 * These duplicate the light-mode `--color-accent` values in styles.css, and
 * must stay in step with them. They cannot read the CSS tokens, because each
 * swatch shows the colour it *would* apply rather than the one in effect.
 */
const SWATCH_COLOR: Record<AccentId, string> = {
  teal: "#0f766e",
  blue: "#1d4ed8",
  green: "#15803d",
  violet: "#6d28d9",
  pink: "#be185d",
  amber: "#a16207",
};

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

  // Apply the signed-in user's accent to <html>, which is where the CSS
  // palettes hang off `data-accent`. Reset to the default when signed out so
  // the login screen doesn't keep the last person's colour.
  const accent = state?.me.accent ?? DEFAULT_ACCENT;
  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  const handleChooseAccent = useCallback(async (next: AccentId) => {
    // Optimistic: the swatch responds instantly, and the authoritative state
    // from the server replaces it a moment later.
    setState((prev) => (prev ? { ...prev, me: { ...prev.me, accent: next } } : prev));
    try {
      setState(await api.setAccent(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that colour.");
    }
  }, []);

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
            {state.me.name}
            <CaretDownIcon size={16} />
          </button>
          {menuOpen && (
            <div className="menu-popover">
              <button type="button" onClick={handleSignOut}>
                <SignOutIcon size={18} />
                Sign out
              </button>
              <div className="accent-picker">
                <span className="accent-picker-label" id="accent-label">
                  Colour
                </span>
                <div className="accent-swatches" role="group" aria-labelledby="accent-label">
                  {ACCENTS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="accent-swatch"
                      style={{ "--swatch": SWATCH_COLOR[a.id] } as React.CSSProperties}
                      aria-pressed={a.id === accent}
                      aria-label={a.label}
                      title={a.label}
                      onClick={() => handleChooseAccent(a.id)}
                    />
                  ))}
                </div>
              </div>
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
        <PlusIcon size={26} />
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
