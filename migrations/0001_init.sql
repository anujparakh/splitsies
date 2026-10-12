-- Splitsies initial schema.
-- All money is INTEGER cents. Never floats: 0.1 is not representable in binary
-- floating point, and repeated addition of inexact values makes balances drift.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  -- base64url(HMAC-SHA256(password, PASSWORD_PEPPER)).
  -- UNIQUE because the password alone identifies the user at login, so two
  -- users sharing a password would make identity ambiguous. Seeding a duplicate
  -- fails loudly here instead of silently shadowing someone.
  password_hash TEXT NOT NULL UNIQUE,
  -- One of the ids in shared/accents.ts. Per user rather than per device, so
  -- the choice follows someone between their phone and their laptop.
  accent        TEXT NOT NULL DEFAULT 'teal',
  created_at    TEXT NOT NULL
);

CREATE TABLE expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  description  TEXT    NOT NULL,
  -- One of the ids in shared/categories.ts. Plain text rather than a foreign
  -- key to a categories table: the set is a fixed part of the UI, not user
  -- data, and a lookup table would mean a join to recover a string we already
  -- have. The DEFAULT means an expense can never end up with no category.
  category     TEXT    NOT NULL DEFAULT 'food',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  -- 'YYYY-MM-DD'. A calendar day, not an instant: attaching a UTC time to "the
  -- day we bought groceries" only creates off-by-one display bugs.
  date         TEXT    NOT NULL,
  paid_by      INTEGER NOT NULL REFERENCES users(id),
  created_by   INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT    NOT NULL
);

-- Shares are materialized rows rather than a "split equally" rule re-evaluated
-- at read time. Adding a third user later must not silently rewrite the history
-- of expenses that only two people shared.
CREATE TABLE expense_splits (
  expense_id  INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  share_cents INTEGER NOT NULL CHECK (share_cents >= 0),
  PRIMARY KEY (expense_id, user_id)
);

CREATE TABLE settlements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user    INTEGER NOT NULL REFERENCES users(id),  -- handed over the money
  to_user      INTEGER NOT NULL REFERENCES users(id),  -- received it
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  date         TEXT    NOT NULL,
  created_at   TEXT    NOT NULL,
  CHECK (from_user <> to_user)
);

CREATE INDEX idx_expenses_date       ON expenses(date DESC);
CREATE INDEX idx_splits_expense      ON expense_splits(expense_id);
CREATE INDEX idx_splits_user         ON expense_splits(user_id);
CREATE INDEX idx_settlements_date    ON settlements(date DESC);
