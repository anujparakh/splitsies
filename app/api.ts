import type {
  AppState,
  ApiError,
  ExpenseInput,
  SettlementInput,
  User,
} from "../shared/types";

/** Thrown for any non-2xx response. `message` is safe to show the user. */
export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

/** Distinguishes "your session ended" from a real failure. */
export const isUnauthorized = (error: unknown) =>
  error instanceof ApiFailure && error.status === 401;

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    // fetch only rejects for network-level failures.
    throw new ApiFailure("Can't reach the server. Check your connection.", 0);
  }

  if (!response.ok) {
    let message = "Something went wrong.";
    try {
      message = ((await response.json()) as ApiError).error ?? message;
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    throw new ApiFailure(message, response.status);
  }

  return (await response.json()) as T;
}

export const api = {
  login: (password: string) =>
    request<{ me: User }>("/login", { method: "POST", body: { password } }),
  logout: () => request<{ ok: true }>("/logout", { method: "POST" }),
  state: () => request<AppState>("/state"),
  createExpense: (input: ExpenseInput) =>
    request<AppState>("/expenses", { method: "POST", body: input }),
  updateExpense: (id: number, input: ExpenseInput) =>
    request<AppState>(`/expenses/${id}`, { method: "PUT", body: input }),
  deleteExpense: (id: number) =>
    request<AppState>(`/expenses/${id}`, { method: "DELETE" }),
  createSettlement: (input: SettlementInput) =>
    request<AppState>("/settlements", { method: "POST", body: input }),
  deleteSettlement: (id: number) =>
    request<AppState>(`/settlements/${id}`, { method: "DELETE" }),
};
