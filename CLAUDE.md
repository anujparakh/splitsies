# CLAUDE.md

Guidance for working in this repository.

## What this is

Splitsies is a private shared-expense tracker — a minimal Splitwise — for a
single group of 2–3 friends. It exists because Splitwise moved the features this
group actually used behind a paywall.

It is deliberately small. Before adding anything, check the "Non-Goals" section
of the design doc: multiple groups, receipts, categories, reports, recurring
expenses, and non-USD currencies are all explicitly out of scope. The value of
this codebase is that it stays comprehensible.

**Design doc:** `docs/superpowers/specs/2026-10-11-splitsies-design.md` — the
authority on what the app does and why. Every non-obvious decision is recorded
there with its reasoning.
**Implementation plan:** `docs/superpowers/plans/2026-10-11-splitsies.md`.
**Deployment:** `DEPLOYMENT.md`.

## Architecture

One Cloudflare Worker serves both the React SPA (as static assets) and a Hono
JSON API under `/api/*`, backed by D1 (SQLite).

```
  Browser ──▶ Cloudflare Worker ──┬──▶ static assets (the built SPA)
                                  └──▶ Hono /api/* ──▶ D1
```

Single Worker, single origin, single `wrangler deploy`. That is what lets
session cookies be plain `SameSite=Lax` with no CORS configuration — the main
reason this isn't split into a Pages project plus an API Worker.

`wrangler.jsonc` sets `run_worker_first: ["/api/*"]`. **This line is load-bearing.**
Static assets are normally matched before the Worker runs, and
`not_found_handling: "single-page-application"` makes unmatched paths return
`index.html`. Without `run_worker_first`, every API call would be answered with
the app's HTML shell. If the API starts returning HTML, look here first.

## Commands

```bash
npm test                 # vitest, in real workerd against a real local D1
npm run test:watch
npx tsc --noEmit         # typecheck (CI-equivalent)
npm run build            # build the SPA into dist/client
npm run deploy           # build + wrangler deploy
npm run dev              # Vite dev server on :5173, proxying /api to :8787
npm run preview          # build + wrangler dev — exactly what production serves
npx wrangler dev         # the Worker + local D1 on :8787
npx wrangler tail        # live production logs
npm run migrate:local    # apply migrations to the local D1
npm run migrate:remote   # apply migrations to production
npm run cf-typegen       # regenerate worker-configuration.d.ts after config changes
```

Local development is two terminals: `npx wrangler dev` for the API and
`npm run dev` for the app. See `DEPLOYMENT.md` for the one-time local setup
(`.dev.vars` plus a seeded user).

## File map

```
wrangler.jsonc              Worker, static assets, and D1 configuration
migrations/0001_init.sql    The schema. Add a new numbered file; never edit this one.

shared/                     Imported by BOTH the Worker and the client
  types.ts                  The API contract. The single source of truth for shapes.
  money.ts                  Cents ↔ dollar-string conversion

src/                        The Worker
  index.ts                  Hono route wiring. No business logic.
  auth.ts                   Password hashing, session cookie signing, middleware
  db.ts                     ALL SQL, and the only snake_case ↔ camelCase mapping
  validate.ts               Validation of untrusted request bodies
  state.ts                  Assembles the AppState response
  lib/
    split.ts                Equal split with deterministic remainder
    balances.ts             Net positions and greedy settle-up

app/                        The React client
  main.tsx                  Mount
  App.tsx                   The only stateful component: auth gate + AppState
  api.ts                    Typed fetch wrapper
  styles.css                Design tokens and all styling
  components/               Login, BalanceCard, ActivityFeed, Sheet,
                            ExpenseSheet, SettleSheet

scripts/
  hash-password.mjs         Generates a password hash for seeding a user
  seed.sql.example          Template for seeding users

tests/                      money, split, balances, api
```

## Conventions that matter

**Money is always integer cents.** `amountCents`, `shareCents`, `netCents`.
Never a float, never a dollar number. `0.1` is not representable in binary
floating point, and repeated addition of inexact values makes balances drift
until they can never reach zero. Dollars exist only as strings at the UI edge,
via `shared/money.ts`.

**Balance math lives server-side, in `src/lib/balances.ts`, and nowhere else.**
The client does no money arithmetic beyond formatting and the "$X.XX each"
preview in the expense form. If you find yourself computing what someone owes
in a component, stop.

**Every mutation returns the complete new `AppState`.** Handlers call
`buildState()` and return all of it. The client replaces its state wholesale
instead of patching locally, so the UI cannot drift out of sync with the
server's idea of who owes what. The payload is a few kilobytes — this trade is
deliberate.

**All SQL lives in `src/db.ts`.** It is also the only place that translates
between the database's snake_case columns and the API's camelCase fields. A
query anywhere else is a bug.

**Types come from `shared/types.ts`.** Never redefine an API shape locally.
Changing it there surfaces a type error on both the server and client at once,
which is the entire point.

**Splits are materialized rows, not a rule.** Each expense stores the exact
share for each participant. Adding a third user must never retroactively
rewrite who owed what on past expenses.

**Dates are `YYYY-MM-DD` strings, treated as calendar days.** Two traps, both
of which have a helper or a note in the code:
- Never `new Date("2026-10-01")` — it parses as *UTC* midnight and renders as
  September 30th for anyone west of UTC. Parse the parts into numbers.
- Never `toISOString()` to get today — it's UTC, so it's already tomorrow in
  the evening. Use the local-date helper in `ExpenseSheet`.

**`noUncheckedIndexedAccess` is on,** so `array[0]` is `T | undefined`. This is
the most common source of type errors here. `verbatimModuleSyntax` is also on:
type-only imports must use `import type`.

## Authentication

The **password alone identifies the user** — there is no username field. Login
hashes the submitted password and looks up whichever user owns that hash.

- `password_hash` is `base64url(HMAC-SHA256(password, PASSWORD_PEPPER))`,
  deterministic and unsalted *by necessity*: you cannot look up a user by a
  per-user salt you don't yet know. `UNIQUE`, so two people cannot share a
  password.
- The secret pepper is what makes this safe enough. A leaked database is a
  column of HMACs that cannot be attacked offline without a secret held only in
  Cloudflare's secret store. There is **no key stretching** — an accepted,
  documented trade-off; see the spec's threat model.
- `scripts/hash-password.mjs` must stay byte-identical to `hashPassword()` in
  `src/auth.ts`. A test asserts this. If they diverge, a freshly seeded
  deployment locks everyone out.
- Sessions are stateless signed cookies: `<userId>.<issuedAt>.<HMAC>`, signed
  with `SESSION_SECRET`, `HttpOnly; Secure; SameSite=Lax`, 90 days. No sessions
  table. Individual sessions can't be revoked — rotating `SESSION_SECRET` logs
  everyone out, which is the intended panic button.
- `SameSite=Lax` rather than `Strict` so the cookie survives following a link
  into the app from a messaging app.

Login returns an identical generic `401` whether the password was missing,
malformed, or simply wrong, so a response never reveals whether a password
belongs to somebody.

## Testing

Tests run inside the real Workers runtime via `@cloudflare/vitest-plugin`,
against a local D1 built from `migrations/`. A broken migration fails the suite
rather than production.

The weight is on the money math, which is where a bug is both likely and
genuinely costly — uneven cent distribution, settlements, and transfer
minimization. `tests/api.test.ts` covers auth rejection, the full expense
lifecycle, and validation, driving the real Worker through `SELF.fetch`.

Two invariants worth preserving in any new test:
- Shares always sum to exactly the expense amount.
- Nets always sum to exactly zero.

When changing balance or split behaviour, change the test first — it is the
specification.

## Adding a feature

1. Re-read the design doc's Non-Goals. Most ideas are already decided against.
2. Shapes go in `shared/types.ts` first, so both sides agree.
3. New SQL goes in `src/db.ts`; a new migration file goes in `migrations/`,
   numbered sequentially. Never edit an applied migration.
4. Money logic goes in `src/lib/`, with tests written first.
5. Routes in `src/index.ts` stay thin: validate, act, return `buildState()`.
6. Record any non-obvious decision in the design doc, with the reasoning. The
   point of these docs is that the *why* survives.

## Free-tier budget

Cloudflare's free plan allows 100,000 Worker requests/day (static asset
requests are free and unlimited and don't count), 10 ms CPU per request, and
for D1: 5 GB storage, 5M rows read/day, 100,000 rows written/day.

Three users consume a fraction of a percent of this. The only thing that ever
came close to a limit was password hashing: the original design used PBKDF2 at
100k iterations, which plausibly exceeds the 10 ms CPU ceiling. The switch to a
single peppered HMAC — driven by making the password identify the user — makes
login cost microseconds and removes the concern entirely.
