import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { Prisma } from "../../prisma";
import {
  PLACE_CATEGORY_MAX_PER_USER,
  collidesWithBuiltInCategory,
  isReservedPlaceCategoryName,
  isPlaceCategory,
} from "../../shared/placeCategories";

/** The category a place falls back to when its custom category is deleted. */
export const FALLBACK_PLACE_CATEGORY = "other";

/**
 * A place may carry a built-in key, one of the user's own category names, or —
 * on an edit — the value it already has. The last case matters: an imported
 * place keeps a label of its own (a Takeout place's "food"), and a form that
 * sends the place back unchanged must not start failing on it.
 */
export async function assertPlaceCategoryAllowed(
  userId: string,
  category: string,
  current: string | null = null
): Promise<void> {
  if (isPlaceCategory(category) || category === current) return;
  const own = await prisma.placeCategoryDef.findUnique({
    where: { userId_name: { userId, name: category } },
    select: { id: true },
  });
  if (!own) {
    throw new AppError("Unknown place category", 400, "PLACE_CATEGORY_UNKNOWN");
  }
}

export async function createPlaceCategoryDef(
  userId: string,
  input: { name: string; icon?: string | null }
) {
  if (collidesWithBuiltInCategory(input.name)) {
    throw new AppError("A built-in category already has this name", 409, "PLACE_CATEGORY_BUILT_IN");
  }
  if (isReservedPlaceCategoryName(input.name)) {
    throw new AppError(
      "This name is reserved for the category filter",
      409,
      "PLACE_CATEGORY_RESERVED"
    );
  }
  try {
    // The count and the insert are one critical section per user: two creates
    // arriving together would otherwise both read 49 and both write the 50th.
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('place_categories'), hashtext(${userId}))`;
      const count = await tx.placeCategoryDef.count({ where: { userId } });
      if (count >= PLACE_CATEGORY_MAX_PER_USER) {
        throw new AppError("Too many place categories", 400, "PLACE_CATEGORY_LIMIT");
      }
      return tx.placeCategoryDef.create({
        data: { userId, name: input.name, icon: input.icon ?? null },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("This category already exists", 409, "PLACE_CATEGORY_EXISTS");
    }
    throw error;
  }
}

/**
 * Deleting a category keeps its places readable: they fold to
 * `FALLBACK_PLACE_CATEGORY` in the same transaction, so there is no moment a
 * place carries a name nothing defines. Returns how many places moved.
 */
export async function deletePlaceCategoryDef(userId: string, id: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const def = await tx.placeCategoryDef.findFirst({ where: { id, userId } });
    if (!def) throw new AppError("Place category not found", 404, "PLACE_CATEGORY_NOT_FOUND");
    const moved = await tx.place.updateMany({
      where: { userId, category: def.name },
      data: { category: FALLBACK_PLACE_CATEGORY },
    });
    await tx.placeCategoryDef.delete({ where: { id } });
    return moved.count;
  });
}
