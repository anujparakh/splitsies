# Splitsies

A small, private shared-expense tracker — the parts of Splitwise a group of
friends actually uses, without the paywall. One group, two or three people,
US dollars, no ads, no upsell.

Runs as a single Cloudflare Worker with a D1 database, comfortably inside the
free tier.

## What it does

- **Log an expense** — amount, description, category, date, who paid, and who
  it's split between. Splits equally among whoever is ticked.
- **See who owes what** — one balance at the top of the screen, phrased from
  your point of view: *"Ruchi owes you $42.10."*
- **Settle up** — record a real-world payback and watch the balance go to zero.
- **Edit or delete** anything you got wrong.
- **Sign in with just a password.** No usernames: your password identifies you.
- **Pick your own colour** — six accents, stored per person, so it follows you
  between your phone and your laptop. Light and dark themes follow your device.

Built mobile-first, since that's where expenses actually get entered.

## Screens

The whole app is one screen plus a login: a balance card, a month-grouped
activity feed with a category icon on every row, and a `+` button that opens
the add-expense sheet.

## Tech

| | |
| --- | --- |
| Hosting | One Cloudflare Worker, serving the app and the API on one origin |
| Backend | Hono + D1 (SQLite) |
| Frontend | React 19 + TypeScript + Vite, plain CSS |
| Tests | Vitest, running inside the real Workers runtime against a real D1 |

Money is stored as integer cents throughout; balance math happens only on the
server. Icons are generated from [Phosphor](https://phosphoricons.com) at build
time rather than pulled in as a runtime dependency.

## Running it locally

You need Node 20+ and a Cloudflare account (`npx wrangler login` once — the
free tier is plenty).

**One-time setup:**

```bash
npm install

# Local secrets. .dev.vars is gitignored and these don't need to be strong.
cat > .dev.vars <<'EOF'
PASSWORD_PEPPER=local-dev-pepper
SESSION_SECRET=local-dev-session-secret
EOF

# Create the local database
npx wrangler d1 migrations apply splitsies --local

# Seed two users. The password is what identifies them, so each needs
# a different one. Hashes must use the same pepper as .dev.vars above.
ANUJ=$(node scripts/hash-password.mjs local-dev-pepper anuj-local)
RUCHI=$(node scripts/hash-password.mjs local-dev-pepper ruchi-local)
npx wrangler d1 execute splitsies --local --command \
  "INSERT INTO users (name, password_hash, created_at) VALUES
   ('Anuj','$ANUJ',datetime('now')),('Ruchi','$RUCHI',datetime('now'))"
```

**Day to day**, two terminals:

```bash
npx wrangler dev     # terminal 1 — the Worker + local D1 on :8787
npm run dev          # terminal 2 — the app with hot reload on :5173
```

Open <http://localhost:5173> and sign in with `anuj-local` or `ruchi-local`.
Vite proxies `/api` to the Worker, so both halves work together.

To see exactly what production serves — real build, no hot reload — use
`npm run preview` and open <http://localhost:8787>.

**Useful commands:**

```bash
npm test                 # the full suite (runs in workerd against a real D1)
npm run test:watch
npx tsc --noEmit         # typecheck
npm run build            # build the client into dist/client
npm run deploy           # build and deploy to Cloudflare
```

**Resetting the local database** if you change a migration:

```bash
rm -rf .wrangler/state/v3/d1
npx wrangler d1 migrations apply splitsies --local
# then re-seed the users as above
```

## Deploying

See **[DEPLOYMENT.md](DEPLOYMENT.md)** — creating the D1 database, setting the
two secrets, seeding real users, attaching a custom domain, and the maintenance
tasks afterwards (adding a person, changing a password, backups, logs).

## Documentation

- **[CLAUDE.md](CLAUDE.md)** — architecture, conventions, and the rules worth
  knowing before changing anything.
- **[docs/superpowers/specs/](docs/superpowers/specs/)** — the design document:
  what the app does, what it deliberately doesn't, and why each decision was
  made. Start here if something looks odd; it's probably on purpose.

## A note on security

This is light protection for a private expense list among friends, not a
hardened application. Passwords are hashed with a secret pepper held in
Cloudflare's secret store, which makes a leaked database useless on its own,
but there's no key stretching, no rate limiting, and no 2FA. Use a long
passphrase. The threat model is written out in full in the design doc.
