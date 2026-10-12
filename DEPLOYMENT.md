# Deploying Splitsies

Splitsies is a single Cloudflare Worker that serves both the React app and the
API, backed by a D1 database. One `npm run deploy` ships everything.

Everything here fits inside Cloudflare's free tier. For reference, the free
plan allows 100,000 Worker requests/day (requests for static assets — the app's
HTML, JS, and CSS — are free and unlimited and don't count), 10 ms CPU per
request, and for D1: 5 GB of storage, 5 million rows read/day, and 100,000 rows
written/day. A three-person expense tracker uses a fraction of a percent of this.

---

## Prerequisites

- Node.js 20 or newer.
- A Cloudflare account.
- A domain already added to that Cloudflare account (its nameservers pointing
  at Cloudflare). You don't need a DNS record for the app yet — step 7 creates
  it for you.

```bash
git clone <your-repo> splitsies
cd splitsies
npm install
npx wrangler login
```

`wrangler login` opens a browser to authorize the CLI.

---

## 1. Create the database

```bash
npx wrangler d1 create splitsies
```

It prints a block like this:

```
[[d1_databases]]
binding = "DB"
database_name = "splitsies"
database_id = "a1b2c3d4-0000-0000-0000-abcdef123456"
```

Copy the `database_id` into `wrangler.jsonc`, replacing
`PLACEHOLDER_RUN_WRANGLER_D1_CREATE`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "splitsies",
    "database_id": "a1b2c3d4-0000-0000-0000-abcdef123456",
    "migrations_dir": "migrations"
  }
]
```

This id is not a secret — it's safe to commit.

## 2. Create the schema

```bash
npx wrangler d1 migrations apply splitsies --remote
```

`--remote` targets the real database. Without it you'd migrate only the local
copy used by `wrangler dev`.

Verify:

```bash
npx wrangler d1 execute splitsies --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table'"
```

Expect `users`, `expenses`, `expense_splits`, and `settlements`.

## 3. Generate and set the two secrets

Splitsies needs two independent random keys. Generate them:

```bash
openssl rand -base64 32   # this one becomes PASSWORD_PEPPER
openssl rand -base64 32   # this one becomes SESSION_SECRET
```

**Save the `PASSWORD_PEPPER` value somewhere safe before continuing** — a
password manager is ideal. You need it again every time you add a user or
change a password, and it cannot be read back out of Cloudflare.

```bash
npx wrangler secret put PASSWORD_PEPPER
# paste the first value when prompted

npx wrangler secret put SESSION_SECRET
# paste the second value when prompted
```

| Secret | What it does | If you lose or rotate it |
| --- | --- | --- |
| `PASSWORD_PEPPER` | Key for hashing passwords. Password hashes are derived from it, so it's what makes a leaked database useless to an attacker. | Every stored hash becomes meaningless. Nobody can sign in until you regenerate and reseed every user's hash. |
| `SESSION_SECRET` | Signs session cookies. | Everyone is signed out and signs in again. Harmless. |

## 4. Choose passwords

The password is the *entire* credential — there's no username — so pick
something that won't be guessed. Each person needs a **different** password;
the password is what identifies the user, and the database enforces uniqueness.

A three-word passphrase is easy to type on a phone and far stronger than a
short complex password:

```bash
# Suggests a passphrase like "ember-tunnel-wharf"
node -e "const w=['amber','brisk','cobalt','dune','ember','fjord','glint','harbor','inlet','juniper','kelp','lumen','marsh','nimbus','onyx','pewter','quartz','ridge','sable','tundra','umber','vellum','wharf','xenon','yarrow','zephyr','basalt','cinder','drift','elm','frost','gale','hollow','ivory','jetty','knoll','loom','mica','nook','opal','prism','quill','rune','slate','thistle','vista','willow','wisp','tunnel','orchard'];console.log(Array.from({length:3},()=>w[Math.floor(Math.random()*w.length)]).join('-'))"
```

## 5. Seed the users

Turn each password into a hash, using the **same pepper** you set in step 3:

```bash
node scripts/hash-password.mjs "<your-PASSWORD_PEPPER>" "<anuj's-password>"
node scripts/hash-password.mjs "<your-PASSWORD_PEPPER>" "<ruchi's-password>"
```

Each prints one line, like `xUfDrJ5WjzaPRwSDA_QRLFT9iT4Ml1Is7UYaU1PPYYU`.

Copy the template and fill in the hashes:

```bash
cp scripts/seed.sql.example scripts/seed.sql
# edit scripts/seed.sql, replacing the REPLACE_WITH_*_HASH placeholders
```

`scripts/seed.sql` is gitignored, because a hash is a password equivalent.

Apply it:

```bash
npx wrangler d1 execute splitsies --remote --file ./scripts/seed.sql
```

Verify the users exist (this deliberately doesn't print the hashes):

```bash
npx wrangler d1 execute splitsies --remote \
  --command "SELECT id, name FROM users ORDER BY id"
```

## 6. Deploy

```bash
npm run deploy
```

This builds the React app into `dist/client` and uploads it together with the
Worker. It prints a `*.workers.dev` URL — open it and sign in with one of the
passwords to confirm everything works before attaching your domain.

## 7. Attach your domain

In the Cloudflare dashboard:

1. **Compute (Workers)** → **Workers & Pages** → **splitsies**
2. **Settings** → **Domains & Routes** → **Add** → **Custom domain**
3. Enter the hostname you want, e.g. `splitsies.example.com`
4. **Add domain**

Cloudflare creates the DNS record and issues the TLS certificate
automatically — there's nothing to configure in the DNS tab yourself. It's
usually live within a minute or two.

Verify:

```bash
curl -i https://splitsies.example.com/api/state
```

Expect **`401`** with `{"error":"Not signed in."}`. That's the right answer: the
API is reachable and refusing anonymous access.

If you get HTML instead of JSON, the `run_worker_first` setting in
`wrangler.jsonc` isn't taking effect and the app's HTML shell is answering API
calls. Confirm that block is intact and redeploy.

Then open `https://splitsies.example.com` in a phone browser and sign in.

---

## Local development

Two terminals. First, a one-time local setup:

```bash
# Local secrets. .dev.vars is gitignored; these do not need to be strong.
cat > .dev.vars <<'EOF'
PASSWORD_PEPPER=local-dev-pepper
SESSION_SECRET=local-dev-session-secret
EOF

npx wrangler d1 migrations apply splitsies --local

# Seed a local user with an easy password
HASH=$(node scripts/hash-password.mjs local-dev-pepper local)
npx wrangler d1 execute splitsies --local --command \
  "INSERT INTO users (name, password_hash, created_at) VALUES ('Anuj', '$HASH', datetime('now'))"
```

Then, to work on it:

```bash
# Terminal 1 — the API, on :8787
npx wrangler dev

# Terminal 2 — the app with hot reload, on :5173, proxying /api to :8787
npm run dev
```

Open the `:5173` URL and sign in with the password `local`. The Vite proxy is
configured in `vite.config.ts`.

To preview exactly what production serves (built assets, no hot reload):

```bash
npm run preview
```

Run the tests with `npm test`. They execute inside the real Workers runtime
against a local D1 created from `migrations/`, so a broken migration fails the
suite.

---

## Maintenance

### Add a third person

```bash
HASH=$(node scripts/hash-password.mjs "<your-PASSWORD_PEPPER>" "<their-password>")
npx wrangler d1 execute splitsies --remote --command \
  "INSERT INTO users (name, password_hash, created_at) VALUES ('Sam', '$HASH', datetime('now'))"
```

No redeploy needed — they can sign in immediately, and the app picks up the new
person everywhere. Past expenses are unaffected: each expense stores the exact
shares it was created with, so adding someone never retroactively changes who
owed what.

### Change someone's password

```bash
HASH=$(node scripts/hash-password.mjs "<your-PASSWORD_PEPPER>" "<new-password>")
npx wrangler d1 execute splitsies --remote --command \
  "UPDATE users SET password_hash = '$HASH' WHERE name = 'Ruchi'"
```

Their existing session stays valid — the cookie is independent of the password.
To also force them to sign in again, rotate `SESSION_SECRET` (below).

### Remove someone's access

```bash
npx wrangler d1 execute splitsies --remote --command \
  "UPDATE users SET password_hash = 'disabled-' || hex(randomblob(16)) WHERE name = 'Sam'"
```

This leaves their expense history and balances intact while making the account
unreachable, which is what you want — deleting the row would orphan every
expense they paid for. Then rotate `SESSION_SECRET` to kill their active
session.

### Sign everybody out

```bash
openssl rand -base64 32
npx wrangler secret put SESSION_SECRET   # paste the new value
```

Takes effect immediately; no redeploy. This is the panic button if a phone is
lost. Passwords still work, so everyone just signs in again.

### Rotate `PASSWORD_PEPPER`

Only necessary if you believe the pepper itself leaked. It invalidates **every**
password at once, so do all three steps together:

1. `openssl rand -base64 32`, then `npx wrangler secret put PASSWORD_PEPPER`.
2. Regenerate every user's hash with the new pepper
   (`node scripts/hash-password.mjs "<new-pepper>" "<password>"`).
3. `UPDATE users SET password_hash = '<new-hash>' WHERE name = '<name>'` for each.

Between steps 1 and 3 nobody can sign in.

### Back up the data

```bash
npx wrangler d1 export splitsies --remote --output ./splitsies-backup.sql
```

Worth doing occasionally — the free tier has no point-in-time recovery. The
file contains password hashes, so keep it somewhere private.

Restore into a fresh database with:

```bash
npx wrangler d1 execute splitsies --remote --file ./splitsies-backup.sql
```

### Watch the logs

```bash
npx wrangler tail
```

Streams live requests and anything the Worker writes to `console.error`. The
`500` handler logs the real error here while returning only a generic message
to the browser.

### Check usage against the free tier

Cloudflare dashboard → **Compute (Workers)** → **splitsies** → **Metrics** for
requests and CPU time, and **Storage & Databases** → **D1** → **splitsies** for
reads, writes, and storage.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `/api/state` returns HTML instead of JSON | `run_worker_first: ["/api/*"]` is missing from the `assets` block in `wrangler.jsonc`. The SPA fallback is answering API routes. Restore it and redeploy. |
| Every password is rejected | The hashes were generated with a different pepper than the `PASSWORD_PEPPER` secret. Regenerate them (see "Change someone's password"). |
| `Error 1027` / requests failing after heavy use | The 100,000 requests/day free limit was hit. It resets at midnight UTC. Implausible with three users; check for a runaway loop or a bot. |
| `D1_ERROR: no such table: users` | Migrations weren't applied to the remote database. Run `npx wrangler d1 migrations apply splitsies --remote`. |
| Signed out on every page load | The browser is rejecting the cookie. The app must be served over HTTPS, since the cookie is set `Secure`. Use the `workers.dev` URL or your custom domain, not a plain-HTTP host. |
| `wrangler deploy` says the database doesn't exist | `database_id` in `wrangler.jsonc` is still the placeholder. Do step 1. |
