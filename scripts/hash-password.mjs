#!/usr/bin/env node
/**
 * Computes a Splitsies password hash for seeding a user into D1.
 *
 * Usage: node scripts/hash-password.mjs <pepper> <password>
 *
 * This MUST produce byte-identical output to `hashPassword()` in src/auth.ts,
 * which is base64url(HMAC-SHA256(password, PASSWORD_PEPPER)). The hash is what
 * identifies a user at login, so a mismatch here means nobody can sign in.
 * `npm test` includes a test asserting the two agree.
 *
 * The pepper must be the same value you set as the PASSWORD_PEPPER secret.
 */

const [pepper, password] = process.argv.slice(2);

if (!pepper || !password) {
  console.error("Usage: node scripts/hash-password.mjs <pepper> <password>");
  console.error("");
  console.error("  <pepper>    the PASSWORD_PEPPER secret value");
  console.error("  <password>  the password this user will type to sign in");
  process.exit(1);
}

const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(pepper),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"],
);

const signature = await crypto.subtle.sign(
  "HMAC",
  key,
  new TextEncoder().encode(password),
);

const base64url = Buffer.from(signature)
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");

console.log(base64url);
