import { Hono } from "hono";
import type { ExpenseInput, SettlementInput, User } from "../shared/types";
import {
  clearedSessionCookie,
  hashPassword,
  readSessionCookie,
  sessionCookie,
  signSession,
  verifySession,
} from "./auth";
import {
  createExpense,
  createSettlement,
  deleteExpense,
  deleteSettlement,
  findUserById,
  findUserByPasswordHash,
  listUsers,
  updateExpense,
} from "./db";
import { buildState } from "./state";
import { validateExpense, validateSettlement } from "./validate";

const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();

// Every /api/* request except login/logout must carry a valid session cookie.
app.use("/api/*", async (c, next) => {
  if (
    (c.req.path === "/api/login" || c.req.path === "/api/logout") &&
    c.req.method === "POST"
  ) {
    return next();
  }

  const token = readSessionCookie(c.req.raw);
  const userId = token ? await verifySession(token, c.env.SESSION_SECRET) : null;
  const user = userId !== null ? await findUserById(c.env.DB, userId) : null;

  if (!user) {
    return c.json({ error: "Not signed in." }, 401);
  }

  c.set("user", user);
  await next();
});

app.post("/api/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const password =
    body !== null && typeof body === "object" && "password" in body
      ? (body as Record<string, unknown>).password
      : null;

  if (typeof password !== "string" || password.length === 0) {
    return c.json({ error: "Incorrect password." }, 401);
  }

  const hash = await hashPassword(password, c.env.PASSWORD_PEPPER);
  const user = await findUserByPasswordHash(c.env.DB, hash);

  if (!user) {
    return c.json({ error: "Incorrect password." }, 401);
  }

  c.header("set-cookie", sessionCookie(await signSession(user.id, c.env.SESSION_SECRET)));
  return c.json({ me: user });
});

app.post("/api/logout", (c) => {
  c.header("set-cookie", clearedSessionCookie());
  return c.json({ ok: true });
});

app.get("/api/state", async (c) => {
  return c.json(await buildState(c.env.DB, c.get("user")));
});

app.post("/api/expenses", async (c) => {
  const body = await c.req.json().catch(() => null);
  const users = await listUsers(c.env.DB);
  const userIds = new Set(users.map((u) => u.id));

  const error = validateExpense(body, userIds);
  if (error) return c.json({ error }, 400);

  const input = body as ExpenseInput;

  await createExpense(c.env.DB, input, c.get("user").id);
  return c.json(await buildState(c.env.DB, c.get("user")));
});

app.put("/api/expenses/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  const users = await listUsers(c.env.DB);
  const userIds = new Set(users.map((u) => u.id));

  const error = validateExpense(body, userIds);
  if (error) return c.json({ error }, 400);

  const input = body as ExpenseInput;

  const updated = await updateExpense(c.env.DB, id, input);
  if (!updated) {
    return c.json({ error: "That entry no longer exists." }, 404);
  }
  return c.json(await buildState(c.env.DB, c.get("user")));
});

app.delete("/api/expenses/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const deleted = await deleteExpense(c.env.DB, id);
  if (!deleted) {
    return c.json({ error: "That entry no longer exists." }, 404);
  }
  return c.json(await buildState(c.env.DB, c.get("user")));
});

app.post("/api/settlements", async (c) => {
  const body = await c.req.json().catch(() => null);
  const users = await listUsers(c.env.DB);
  const userIds = new Set(users.map((u) => u.id));

  const error = validateSettlement(body, userIds);
  if (error) return c.json({ error }, 400);

  const input = body as SettlementInput;

  await createSettlement(c.env.DB, input);
  return c.json(await buildState(c.env.DB, c.get("user")));
});

app.delete("/api/settlements/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const deleted = await deleteSettlement(c.env.DB, id);
  if (!deleted) {
    return c.json({ error: "That entry no longer exists." }, 404);
  }
  return c.json(await buildState(c.env.DB, c.get("user")));
});

app.notFound((c) => c.json({ error: "Not found." }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Something went wrong." }, 500);
});

export default app;
