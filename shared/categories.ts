/**
 * The fixed set of expense categories.
 *
 * Shared because the Worker validates against these ids and the client renders
 * their labels. Icons deliberately live in the client
 * (`app/components/CategoryIcon.tsx`) — the Worker has no business knowing
 * what anything looks like.
 *
 * Stored in the database as the plain `id` text rather than a foreign key to a
 * `categories` table: this set is a fixed part of the interface, not user
 * data. Nobody needs to add a category at runtime, and a lookup table would
 * mean a join on every read to recover a string we already have.
 *
 * Categories are for scanning the activity feed at a glance. Nothing aggregates
 * or reports on them — see the design doc's Non-Goals.
 */

export const CATEGORIES = [
  { id: "food", label: "Food" },
  { id: "groceries", label: "Groceries" },
  { id: "entertainment", label: "Entertainment" },
  { id: "transport", label: "Transport" },
  { id: "home", label: "Home" },
  { id: "travel", label: "Travel" },
  { id: "health", label: "Health" },
  { id: "other", label: "Other" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

/**
 * Pre-selected when adding an expense, because it is by far the most common
 * one for this group. Also the column default in the schema, so an expense can
 * never end up with no category at all.
 */
export const DEFAULT_CATEGORY: CategoryId = "food";

const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));

/** Narrows untrusted input (a request body, an old database row) to a CategoryId. */
export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === "string" && CATEGORY_IDS.has(value);
}

/**
 * Human-readable label for a category id.
 *
 * Falls back to the "Other" label rather than throwing, so a row written by a
 * future version of the app can still be displayed by an older client.
 */
export function categoryLabel(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? "Other";
}
