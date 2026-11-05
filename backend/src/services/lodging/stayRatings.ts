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
import {
  customCategoryId,
  customCategoryKey,
  isBuiltInCategory,
} from "../../shared/ratingCategories";
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

/**
 * Most own categories a trip IMPORT may leave an account with. The
 * per-account limit (`MAX_CUSTOM_CATEGORIES`) governs adding by hand; an import
 * may go past it, because the alternative was dropping a value the file
 * carries - and a value must never vanish silently. Past this ceiling the
 * import is REFUSED with a message, not trimmed.
 */
export const MAX_IMPORT_CATEGORIES = 100;

/**
 * Own categories by NAME, for a trip file that crosses accounts. A name that
 * matches one of the account's live categories (case-insensitive) is used, a
 * deleted one of that name is revived, otherwise it is created - the same
 * rules as `POST /lodging/rating-categories/custom`, except for the limit (see
 * `MAX_IMPORT_CATEGORIES`). Every name in the result has a key: nothing is
 * dropped. `mine` is kept current as names are handled, so two spellings that
 * differ only by case resolve to the SAME category and one revival is one row.
 */
export async function ensureOwnCategoriesByName(
  userId: string,
  names: string[]
): Promise<Map<string, string>> {
  const wanted = [...new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('lodging_rating_categories'), hashtext(${userId}))`;
    const mine = await tx.lodgingRatingCategory.findMany({ where: { userId } });
    for (const name of wanted) {
      const same = (c: { name: string }): boolean => c.name.toLowerCase() === name.toLowerCase();
      const liveHit = mine.find((c) => c.deletedAt === null && same(c));
      if (liveHit) {
        out.set(name, customCategoryKey(liveHit.id));
        continue;
      }
      if (mine.filter((c) => c.deletedAt === null).length >= MAX_IMPORT_CATEGORIES) {
        throw new AppError("The file carries too many own rating categories", 400);
      }
      const dead = mine.find((c) => c.deletedAt !== null && same(c));
      const row = dead
        ? await tx.lodgingRatingCategory.update({
            where: { id: dead.id },
            data: { deletedAt: null, name },
          })
        : await tx.lodgingRatingCategory.create({ data: { userId, name } });
      if (dead) mine[mine.indexOf(dead)] = row;
      else mine.push(row);
      out.set(name, customCategoryKey(row.id));
    }
  });
  return out;
}
