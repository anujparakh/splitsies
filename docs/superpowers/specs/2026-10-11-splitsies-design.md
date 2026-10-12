# Splitsies — Design

**Date:** 2026-10-11
**Status:** Approved

A minimal shared-expense tracker for one group of 2–3 people, replacing Splitwise
for a use case that Splitwise now puts behind a paywall. Self-hosted on Cloudflare's
free tier.

## Goals

- One group, 2–3 named users (initially "Ruchi" and "Anuj").
- Record expenses: amount, description, category, date, who paid, who shares the cost.
- Show each person's net balance and a minimal list of who owes whom.
- Record settlements so balances can be cleared after a real-world payback.
- Password-gated, per-user passwords, session persisted in a cookie, with sign-out.
- Mobile-first, simple, modern, elegant.
- USD only. No currency conversion.

## Non-Goals

Explicitly out of scope, to be revisited only if a real need appears:

- Multiple groups, user self-registration, invitations, or roles.
- Receipt photos, comments, reminders, notifications, email.
- Recurring expenses, budgets, reports, charts. Expenses carry a category for
  at-a-glance scanning, but nothing aggregates or reports on it.
- Percentage or exact-amount splits (see "Split model" below).
- Non-USD currencies, currency conversion.
- Password reset or change flows in the UI (passwords are set by an operator SQL
  command, documented in `DEPLOYMENT.md`).

## Architecture

A **single Cloudflare Worker with Static Assets** serves both the React SPA and the
JSON API under `/api/*`. One `wrangler deploy`, one origin, one custom domain.

```
                    ┌──────────────────────────────────────┐
  Browser  ──────▶  │  Cloudflare Worker (one deployment)  │
                    │                                      │
                    │   /           → static assets (SPA)  │
                    │   /assets/*   → static assets        │
                    │   /api/*      → Hono router ─────────┼──▶ D1 (SQLite)
                    └──────────────────────────────────────┘
```

**Decision: one Worker instead of Pages + a separate API Worker.** Two origins
(`splitsies.example.com` and `api.splitsies.example.com`) would require CORS
configuration and `SameSite=None` cross-site cookies, which is the largest source of
incidental complexity available to an app this small. A single origin gets
`SameSite=Lax` cookies that work with no configuration. Cloudflare also now directs
new projects to Workers Static Assets rather than Pages.

**Decision: requests to static assets are free and unlimited on Cloudflare**, so only
`/api/*` calls consume the 100,000 requests/day free-tier budget. At 3 users this is
roughly 0.1% of quota.

### Stack

| Layer    | Choice                              | Why                                                                      |
| -------- | ----------------------------------- | ------------------------------------------------------------------------ |
| Runtime  | Cloudflare Workers                  | Required by the hosting constraint.                                      |
| Router   | Hono                                | ~14 kB, first-class Workers support, native typing of D1/env bindings.  |
| Database | Cloudflare D1 (SQLite)              | Relational data (expenses → splits). Free tier dwarfs the need.          |
| Frontend | React + TypeScript + Vite           | Familiar, excellent Workers-static-assets integration.                   |
| Styling  | Plain CSS with custom properties    | One screen. A utility framework or CSS-in-JS would cost more than saved. |
| Tests    | Vitest (+ `@cloudflare/vitest-pool-workers`) | Unit-test the money math; integration-test auth and writes.    |

## Data Model

All money is stored as **integer cents** (`amount_cents`), never as a float. Floats
cannot represent `0.10` exactly, and repeated addition of inexact values makes
balances drift. Conversion to a dollar string happens only at the display edge.

```sql
users (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL UNIQUE,   -- base64url HMAC-SHA256(password, PASSWORD_PEPPER)
  created_at    TEXT    NOT NULL           -- ISO-8601 UTC
);

expenses (
  id           INTEGER PRIMARY KEY,
  description  TEXT    NOT NULL,
  -- One of the ids in CATEGORIES (shared/categories.ts). Stored as text, not a
  -- foreign key: the set is a fixed part of the UI, not user data.
  category     TEXT    NOT NULL DEFAULT 'food',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  date         TEXT    NOT NULL,           -- "YYYY-MM-DD", the day of the expense
  paid_by      INTEGER NOT NULL REFERENCES users(id),
  created_by   INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT    NOT NULL
);

expense_splits (
  expense_id  INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  share_cents INTEGER NOT NULL CHECK (share_cents >= 0),
  PRIMARY KEY (expense_id, user_id)
);

settlements (
  id           INTEGER PRIMARY KEY,
  from_user    INTEGER NOT NULL REFERENCES users(id),  -- who handed over money
  to_user      INTEGER NOT NULL REFERENCES users(id),  -- who received it
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  date         TEXT    NOT NULL,
  created_at   TEXT    NOT NULL
);
```

Indexes on `expenses(date)`, `expense_splits(expense_id)`, and `settlements(date)`.

**Decision: splits are materialized rows, not a rule re-evaluated at read time.**
Storing "split equally among members" and recomputing it would silently rewrite
history the moment a third user is added. Materialized shares make every past
expense immutable with respect to later membership changes.

**Decision: `date` is a `YYYY-MM-DD` string, not a timestamp.** An expense happened
on a calendar day in the user's local life; attaching a UTC time to it only creates
off-by-one display bugs. `created_at` keeps the real timestamp for ordering.

**Decision: `ON DELETE CASCADE` on splits** requires `PRAGMA foreign_keys = ON`,
which D1 enables by default.

### Split model

An expense form offers a participant checkbox per user, **pre-checked for everyone**.
The total splits **equally among checked participants**. There are no percentage or
exact-amount splits — if a cost is lopsided, it is two expenses.

Equal division rarely divides evenly ($10 ÷ 3 = $3.333…). The remainder is handled by
giving one extra cent to the first *r* participants in ascending `user_id` order,
where *r* is the remainder in cents:

```
$10.00 ÷ 3  →  user 1: $3.34,  user 2: $3.33,  user 3: $3.33
```

**Decision: shares must always sum exactly to `amount_cents`**, enforced by an
assertion in the split helper and covered by tests. Rounding each share independently
would lose or invent pennies, and balances would never quite reach zero.

## Balance Computation

Computed **server-side only, in one module** (`src/lib/balances.ts`), so there is
exactly one definition of truth. The client renders what it is given and does no
money arithmetic beyond formatting.

For each user, the net position in cents:

```
net(u) =   Σ amount_cents of expenses where paid_by = u     (money u put in)
         − Σ share_cents of expense_splits where user_id = u (u's share of costs)
         + Σ amount_cents of settlements where from_user = u (u paid someone back)
         − Σ amount_cents of settlements where to_user = u   (u was paid back)
```

A positive net means the group owes that person; negative means they owe the group.
Nets always sum to zero, which is asserted in tests.

Nets become concrete "X owes Y $Z" transfers by a greedy pass: repeatedly match the
largest debtor against the largest creditor and transfer the smaller of the two
magnitudes. For 2–3 people this yields the minimum number of transfers.

**Decision: greedy rather than optimal min-cash-flow.** Minimizing transfers is
NP-hard in general, but greedy is provably optimal for n ≤ 3 and near-optimal beyond.
Not worth another line of code here.

## Authentication

**Credentials: the password alone identifies the user.** There is no username field.
Login sends only a password; the server hashes it and looks up whichever user owns
that hash. Each person has their own distinct password, seeded by a migration, and
adding a third person is one `INSERT` with no redeploy.

**Decision: hashes are `base64url(HMAC-SHA256(password, PASSWORD_PEPPER))`**, where
`PASSWORD_PEPPER` is a Worker secret, with a `UNIQUE` index on `password_hash`.

Because the password must *identify* the user, the hash has to be deterministic — a
per-user salt is unusable when you don't yet know which user you're dealing with. That
rules out PBKDF2-with-salt and makes login a single indexed
`SELECT ... WHERE password_hash = ?`: one cheap crypto operation, no iteration over
users, and CPU time in the microseconds rather than anywhere near the free plan's
10 ms ceiling.

The secret pepper is what carries the security here, and it covers the threat that
actually matters: an attacker who obtains the D1 contents gets a column of HMACs that
cannot be attacked offline at all without a secret held only in Cloudflare's secret
store. A plain salted SHA-256 would instead hand them a brute-forceable target. The
accepted costs, both deliberate:

- **No two users may share a password** — the `UNIQUE` index enforces this, and
  seeding a duplicate fails loudly rather than silently shadowing a user.
- **Rotating `PASSWORD_PEPPER` invalidates every password**, requiring all hashes to
  be reseeded. Documented in `DEPLOYMENT.md`.
- **No key stretching.** If the pepper leaks *together with* the database, passwords
  fall quickly to a dictionary attack. This is accepted under the threat model below;
  the mitigation is to use passwords that aren't dictionary words.

**Decision: login returns `401` with the same generic message whether the password
matched no user or was malformed**, so the response never reveals whether a given
password belongs to somebody.

**Sessions.** Login sets a stateless **HMAC-SHA256 signed cookie**:

```
splitsies_session = <userId>.<issuedAtMs>.<base64url HMAC-SHA256(userId.issuedAtMs, SESSION_SECRET)>
```

Attributes: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7776000` (90 days).
Every `/api/*` request except `login` passes through middleware that verifies the
signature, rejects cookies older than 90 days, and attaches the user to the request
context.

**Decision: signed stateless cookie instead of a sessions table.** No storage, no
expiry sweep, no extra query per request. The cost is that individual sessions cannot
be revoked — rotating `SESSION_SECRET` logs everyone out at once, which is the
documented panic button and is entirely adequate for three people.

**Decision: `SameSite=Lax`, not `Strict`.** `Strict` would drop the cookie when
following a link to the app from a messaging app, which is the normal way this app
will be opened.

**Threat model.** This protects a small private expense list from casual internet
discovery and from the merely curious. It is not hardened against a determined
attacker. Accepted gaps: no key stretching on the password hash (see above), no rate
limiting on login (Cloudflare sits in front; three users), no password reset flow, no
2FA, no per-session revocation, no CSRF token (mitigated by `SameSite=Lax` plus
JSON-only request bodies). Because a single password is the whole credential, it
should be long and not a dictionary word — `DEPLOYMENT.md` recommends a generated
passphrase.

## API

Deliberately small. One read endpoint, because the app is one screen and a single
round trip keeps it feeling instant.

| Method & path             | Purpose                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| `POST /api/login`         | `{password}` → identifies the user, sets session cookie, returns `me`.  |
| `POST /api/logout`        | Clears the cookie.                                                      |
| `GET /api/state`          | `{me, users, expenses, settlements, balances}` — everything to render.   |
| `POST /api/expenses`      | Create. Returns fresh state.                                            |
| `PUT /api/expenses/:id`   | Edit. Returns fresh state.                                              |
| `DELETE /api/expenses/:id`| Delete (cascades splits). Returns fresh state.                          |
| `POST /api/settlements`   | Create. Returns fresh state.                                            |
| `DELETE /api/settlements/:id` | Delete. Returns fresh state.                                        |

**Decision: every mutation returns the complete new state.** The client replaces its
state wholesale instead of patching it locally, so the UI cannot drift out of sync
with the server's balance math. The payload is a few kilobytes.

**Decision: expenses are editable; settlements are delete-only.** Edit reuses the
create path's validation and split-materialization helpers plus the same form
component, so it costs little. A settlement is a statement that money changed hands;
amending one is less clear than deleting and re-recording it.

**Decision: expense edits are atomic via D1 `batch()`.** D1 has no interactive
transactions, but `batch()` runs statements atomically, which is enough to update the
row and replace its split rows together.

**Validation** (one shared module, used by both create and edit):

- `amount_cents` is an integer > 0 and < 100,000,000 ($1M sanity bound).
- `description` is 1–200 characters after trimming.
- `date` matches `YYYY-MM-DD` and is a real calendar date.
- `paid_by` and every participant id exist in `users`.
- At least one participant.

Failures return `400` with `{error: "<human-readable message>"}`. Auth failures
return `401`. Unknown ids return `404`. The client surfaces `error` verbatim.

## UI

Mobile-first; a single column that simply centres and gains breathing room on wider
screens. Two views.

**Login.** App name, a single password field (auto-focused, `type="password"`,
submits on Enter), and a sign-in button. No username field — the password identifies
the person, so the login screen reveals nothing about who uses the app. A failure
shows an inline, deliberately uninformative "Incorrect password." On success the app
greets the user by the name the password resolved to, confirming the right identity
was picked up.

**Home.**

```
┌─────────────────────────────┐
│ Splitsies          [ Anuj ▾ ]│  ← sign-out in the menu
├─────────────────────────────┤
│                             │
│   Ruchi owes you            │  ← balance card; the one number that matters
│   $42.50                    │
│                             │
│   [ Settle up ]             │
├─────────────────────────────┤
│  OCTOBER                    │
│  Groceries           $84.20 │
│  Anuj paid · you owe $42.10 │
│  ─────────────────────────  │
│  Ruchi paid you      $20.00 │
│  Settlement · Oct 8         │
└─────────────────────────────┘
                        ( + )    ← add expense
```

The balance card reads from the current user's perspective and collapses to "All
settled up" at zero. With three users it lists each pairwise transfer as its own line.

The activity feed interleaves expenses and settlements in reverse chronological order
by `date`, then `created_at`, grouped under month headings. Tapping an expense opens
it for edit or delete; tapping a settlement offers delete.

**Add/edit expense** (a sheet, not a separate page): amount (numeric keypad,
auto-focused), description, date (defaults to today), paid-by selector (defaults to
the current user), and participant checkboxes (default all checked) showing a live
"$X.XX each" preview.

**Settle up** (a sheet): direction defaulting to the transfer the balance card
suggests, amount pre-filled with the full outstanding balance, and a date.

**Design language.** One accent colour, a neutral background, generous whitespace, a
system font stack, 16 px minimum body text, and 44 px minimum touch targets. Amounts
are set in tabular numerals so columns align. Light and dark themes via
`prefers-color-scheme`, with colours defined once as CSS custom properties.

**Decision: no client-side router.** Two views and two sheets are plain React state.
A router would be more code than it removes.

**Decision: no global state library.** One `useState` holding the server's state
object, refreshed from every mutation response.

## Error Handling

- **Offline or failed mutation:** the sheet stays open, keeps its input, and shows the
  error with a retry. Nothing is lost to a dropped connection.
- **Expired or tampered cookie:** any `401` from `/api/*` drops the client back to the
  login view.
- **Unexpected server error:** `500` with a generic message; details go to
  `console.error` for `wrangler tail`. No internals leak to the client.
- **Expense deleted on another device:** `404` on edit, surfaced as "This expense no
  longer exists," followed by a state refresh.
- **Concurrent edits:** last write wins. With three users this is a non-problem, and
  the alternative (version columns, conflict UI) is unjustifiable here.

## Testing

Weighted towards the money math, which is the only place a bug is both likely and
genuinely costly.

**Unit (`src/lib/*.test.ts`), the priority:**

- Equal split of evenly divisible totals.
- Remainder distribution: $10 ÷ 3, $0.01 ÷ 2, $0.05 ÷ 3. Shares always sum to the
  total.
- Single participant takes the whole amount.
- `net()` across expenses, mixed payers, and settlements; nets always sum to zero.
- Settlement of a full balance yields all-zero nets.
- Greedy transfers: two-person debt, three-person circular debt, already-settled.
- Cent/dollar parsing and formatting, including `"0.1"`, `"1,234.56"`, and junk input.

**Integration (`@cloudflare/vitest-pool-workers`, against a real D1):**

- `/api/state` without a cookie → `401`.
- Login with an unrecognised password → `401`; each user's own password → `200`,
  a `Set-Cookie`, and the correct user identity resolved from the password alone.
- A forged or truncated cookie signature → `401`.
- Create an expense → it appears in state with correct splits and balances.
- Edit an expense → splits are replaced, not duplicated.
- Delete an expense → its splits are gone (cascade).
- Validation rejects a zero amount, a blank description, a malformed date, and an
  empty participant list.

**Manual, before first real use:** the login/sign-out cycle on a phone, cookie
persistence across a browser restart, and the add-expense flow one-handed.

## Deliverables

- The application, deployable with `wrangler deploy`.
- `CLAUDE.md` — architecture, conventions, commands, and the recorded decisions.
- `DEPLOYMENT.md` — D1 creation and migration, secret generation, user seeding,
  custom-domain setup, and how to add a user, change a password, or rotate the pepper
  later.
