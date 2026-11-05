/**
 * The vocabulary of lodging rating categories (spec
 * `docs/superpowers/specs/2026-08-25-lodging-rating-categories-design.md`).
 *
 * Two kinds exist and share one key space on a stay's `ratings` map:
 *  - BUILT-IN keys below, owned by the code, switched on/off per user
 *    (`UserSettings.lodgingRatingCategories`);
 *  - OWN categories a user names (`LodgingRatingCategory` rows), keyed
 *    `custom:<uuid>`.
 *
 * MIRRORED in `backend/src/shared/ratingCategories.ts` ("change both
 * together"; `ratingCategories.mirror.test.ts` on the frontend side compares
 * the key list). No code path may name a built-in category literally outside
 * the legacy-column mapping — iterate `RATING_CATEGORIES`.
 */

export const RATING_CATEGORIES = [
  "room",
  "bed",
  "bathroom",
  "cleanliness",
  "breakfast",
  "service",
  "location",
  "parking",
  "wifi",
  "quiet",
] as const;

export type RatingCategory = (typeof RATING_CATEGORIES)[number];

/** What an account shows before its owner switches anything: today's three. */
export const DEFAULT_RATING_CATEGORIES: readonly RatingCategory[] = [
  "room",
  "breakfast",
  "service",
];

/** Key prefix of an own category inside a stay's `ratings` map. */
export const CUSTOM_CATEGORY_PREFIX = "custom:";

/** Longest own-category name; long enough for "Aussicht vom Balkon", short enough for a chip. */
export const MAX_CUSTOM_CATEGORY_NAME = 40;

/** Own categories per account — a settings list, not a database. */
export const MAX_CUSTOM_CATEGORIES = 20;

/**
 * Most live own categories a trip IMPORT may leave an account with (it may go
 * past the hand-adding limit rather than drop a value). The trip-file schema
 * allows as many own ratings on a stay as can be stored.
 */
export const MAX_IMPORT_CATEGORIES = 100;

/**
 * The three categories that still have their own `lodging_stays` column. The
 * columns stay in place for one release (rollback must not lose a judgement)
 * and are mirrored from the `ratings` map on every write.
 */
export const LEGACY_COLUMN_CATEGORIES = ["room", "breakfast", "service"] as const;

export function isBuiltInCategory(key: string): key is RatingCategory {
  return (RATING_CATEGORIES as readonly string[]).includes(key);
}

export function customCategoryKey(id: string): string {
  return `${CUSTOM_CATEGORY_PREFIX}${id}`;
}

export function customCategoryId(key: string): string | null {
  return key.startsWith(CUSTOM_CATEGORY_PREFIX) ? key.slice(CUSTOM_CATEGORY_PREFIX.length) : null;
}
