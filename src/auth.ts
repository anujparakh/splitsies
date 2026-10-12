import type { User } from "../shared/types";

const COOKIE_NAME = "splitsies_session";
const MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

/** Imports a secret as an HMAC-SHA256 key. */
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function hmacBase64Url(secret: string, message: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(message),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncode(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Hashes a password for storage and lookup.
 *
 * Deterministic and unsalted by necessity: the password alone identifies the
 * user, so login must be able to look up a row by hash without first knowing
 * whose salt to use. The secret pepper is what makes this safe enough — a
 * leaked database is a column of HMACs that cannot be attacked offline
 * without a secret held only in Cloudflare's secret store. Accepted
 * trade-off: no key stretching. See the design doc's threat model.
 */
export async function hashPassword(password: string, pepper: string): Promise<string> {
  return hmacBase64Url(pepper, password);
}

/** Issues a signed session token: `<userId>.<issuedAtMs>.<signature>`. */
export async function signSession(userId: number, secret: string): Promise<string> {
  const payload = `${userId}.${Date.now()}`;
  return `${payload}.${await hmacBase64Url(secret, payload)}`;
}

/**
 * Verifies a session token and returns its user id.
 *
 * Returns null for anything malformed, mis-signed, or older than the maximum
 * age, so callers have a single falsy path to handle.
 */
export async function verifySession(
  token: string,
  secret: string,
): Promise<number | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [rawUserId, rawIssuedAt, signature] = parts as [string, string, string];

  const expected = await hmacBase64Url(secret, `${rawUserId}.${rawIssuedAt}`);
  if (!timingSafeEqual(signature, expected)) return null;

  const userId = Number(rawUserId);
  const issuedAt = Number(rawIssuedAt);
  if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(issuedAt)) return null;
  if (Date.now() - issuedAt > MAX_AGE_SECONDS * 1000) return null;

  return userId;
}

/** Constant-time string comparison, to avoid leaking a signature byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * `Set-Cookie` value for a new session.
 *
 * SameSite=Lax rather than Strict: Strict would drop the cookie when the app
 * is opened from a link in a messaging app, which is how it will usually be
 * opened. HttpOnly keeps it away from any script on the page.
 */
export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearedSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/** Reads the session token out of a request's Cookie header. */
export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=") || null;
  }
  return null;
}

export type { User };
