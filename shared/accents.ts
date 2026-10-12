/**
 * Accent colours each person can pick for themselves.
 *
 * Stored per user in the database rather than in localStorage, so the choice
 * follows someone from their phone to their laptop instead of being a
 * per-device setting they have to make twice.
 *
 * Only the id lives here and in the database. The actual colour values are
 * defined once in `app/styles.css` under `:root[data-accent="..."]`, because
 * the Worker has no reason to know what "pink" looks like — and keeping the
 * hex values in CSS is what lets each accent carry a full light and dark
 * palette without duplicating it in TypeScript.
 */

export const ACCENTS = [
  { id: "teal", label: "Teal" },
  { id: "blue", label: "Blue" },
  { id: "green", label: "Green" },
  { id: "violet", label: "Violet" },
  { id: "pink", label: "Pink" },
  { id: "amber", label: "Amber" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];

export const DEFAULT_ACCENT: AccentId = "teal";

const ACCENT_IDS = new Set<string>(ACCENTS.map((a) => a.id));

/** Narrows untrusted input (a request body, an old database row) to an AccentId. */
export function isAccentId(value: unknown): value is AccentId {
  return typeof value === "string" && ACCENT_IDS.has(value);
}
