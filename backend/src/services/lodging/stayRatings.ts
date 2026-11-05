/**
 * How a stay's category ratings are merged, validated and laid out as columns.
 *
 * `stay.ratings` (JSON map) is the record; `ratingRoom` / `ratingBreakfast` /
 * `ratingService` are mirrored from it for one release so a rollback, the trip
 * exchange and the evidence pages keep working; `ratingOverall` is derived from
 * the map and never from the user's active category set (see
 * `shared/ratingDerivation.ts`).
 */

import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { customCategoryId, isBuiltInCategory } from "../../shared/ratingCategories";
import { deriveStayOverallRating, storedRatingsOf } from "../../shared/ratingDerivation";

export interface SentRatings {
  ratingRoom?: number | null;
  ratingBreakfast?: number | null;
  ratingService?: number | null;
  ratingOverall?: number | null;
  /** key -> value; an explicit null clears that category. */
  ratings?: Record<string, number | null> | undefined;
}

/**
 * Lay what was SENT over what is STORED. `undefined` leaves a category alone,
 * an explicit `null` clears it (the PATCH trap documented in `stayWrites.ts`).
 * The legacy field names are applied first so an explicit `ratings` entry for
 * the same category wins.
 */
export function mergeRatings(
  stored: Record<string, number>,
  sent: SentRatings
): Record<string, number> {
  const next: Record<string, number> = { ...stored };
  const apply = (key: string, value: number | null | undefined): void => {
    if (value === undefined) return;
    if (value === null) delete next[key];
    else next[key] = value;
  };
  apply("room", sent.ratingRoom);
  apply("breakfast", sent.ratingBreakfast);
  apply("service", sent.ratingService);
  for (const [key, value] of Object.entries(sent.ratings ?? {})) apply(key, value);
  return next;
}

/** The columns a merged map writes: the map itself, the mirrored columns, the derived overall. */
export function ratingColumns(
  merged: Record<string, number>,
  currentOverall: number | null
): {
  ratings: Prisma.InputJsonValue | typeof Prisma.DbNull;
  ratingRoom: number | null;
  ratingBreakfast: number | null;
  ratingService: number | null;
  ratingOverall: number | null;
} {
  return {
    ratings:
      Object.keys(merged).length === 0
        ? Prisma.DbNull
        : (merged as unknown as Prisma.InputJsonValue),
    ratingRoom: merged.room ?? null,
    ratingBreakfast: merged.breakfast ?? null,
    ratingService: merged.service ?? null,
    ratingOverall: deriveStayOverallRating({ ratings: merged, current: currentOverall }),
  };
}

export { storedRatingsOf };

/**
 * A key must be a built-in category or one of the CALLER'S own categories
 * (deleted ones included: an edit re-sends the values it already carries).
 * Anything else is refused rather than stored — a typo'd key would otherwise
 * sit in the map and move the overall for ever.
 */
export async function assertRatingKeysValid(
  userId: string,
  ratings: Record<string, number | null> | undefined
): Promise<void> {
  if (!ratings) return;
  const customIds: string[] = [];
  for (const key of Object.keys(ratings)) {
    if (isBuiltInCategory(key)) continue;
    const id = customCategoryId(key);
    if (id === null) throw new AppError(`Unknown rating category "${key}"`, 400);
    customIds.push(id);
  }
  if (customIds.length === 0) return;
  const owned = await prisma.lodgingRatingCategory.count({
    where: { userId, id: { in: customIds } },
  });
  if (owned !== new Set(customIds).size) {
    throw new AppError("Unknown rating category", 400);
  }
}
