import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { prisma } from "../../db";
import { type AuthRequest, requireUser } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import {
  DEFAULT_RATING_CATEGORIES,
  MAX_CUSTOM_CATEGORIES,
  MAX_CUSTOM_CATEGORY_NAME,
  RATING_CATEGORIES,
  customCategoryKey,
} from "../../shared/ratingCategories";

/**
 * The lodging rating categories of the signed-in account:
 *
 *  - `GET    /lodging/rating-categories`        the built-in vocabulary, the
 *    switched-on subset, and the user's own categories (deleted ones included,
 *    flagged, so a stay that still carries a value can name it);
 *  - `PUT    /lodging/rating-categories/active` switch built-in ones on/off;
 *  - `POST   /lodging/rating-categories/custom` add an own category;
 *  - `PATCH  /lodging/rating-categories/custom/:id` rename it;
 *  - `DELETE /lodging/rating-categories/custom/:id` delete it - SOFT: values
 *    already given on stays stay readable under its name and keep counting in
 *    those stays' overall; it is just no longer offered.
 *
 * Switching a category off or deleting one never rewrites a stay: the overall
 * is derived from the values a stay HAS (`shared/ratingDerivation.ts`).
 * Mounted before `/:id` in the lodging router.
 */
const router = Router();

const activeSchema = z.object({
  categories: z
    .array(z.enum(RATING_CATEGORIES))
    .refine((list) => new Set(list).size === list.length, "Duplicate category"),
});

const nameSchema = z.object({
  name: z.string().trim().min(1).max(MAX_CUSTOM_CATEGORY_NAME),
});

interface CustomDto {
  id: string;
  key: string;
  name: string;
  deleted: boolean;
}

async function snapshot(userId: string): Promise<{
  builtIn: readonly string[];
  active: string[];
  custom: CustomDto[];
}> {
  const [settings, custom] = await Promise.all([
    prisma.userSettings.findUnique({
      where: { userId },
      select: { lodgingRatingCategories: true },
    }),
    prisma.lodgingRatingCategory.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    builtIn: RATING_CATEGORIES,
    // Canonical vocabulary order, whatever order the user clicked them in.
    active: RATING_CATEGORIES.filter((key) =>
      (settings?.lodgingRatingCategories ?? [...DEFAULT_RATING_CATEGORIES]).includes(key)
    ),
    custom: custom.map((c) => ({
      id: c.id,
      key: customCategoryKey(c.id),
      name: c.name,
      deleted: c.deletedAt !== null,
    })),
  };
}

function nameTaken(existing: string[], name: string): boolean {
  return existing.some((n) => n.toLowerCase() === name.toLowerCase());
}

router.get("/rating-categories", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await snapshot(requireUser(req)) });
  } catch (err) {
    next(err);
  }
});

router.put(
  "/rating-categories/active",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUser(req);
      const parsed = activeSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError("Invalid rating categories", 400);
      await prisma.userSettings.upsert({
        where: { userId },
        update: { lodgingRatingCategories: parsed.data.categories },
        create: { userId, lodgingRatingCategories: parsed.data.categories, data: {} },
      });
      res.json({ success: true, data: await snapshot(userId) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/rating-categories/custom",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUser(req);
      const parsed = nameSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError("Invalid category name", 400);
      const { name } = parsed.data;
      const mine = await prisma.lodgingRatingCategory.findMany({ where: { userId } });
      const live = mine.filter((c) => c.deletedAt === null);
      if (
        nameTaken(
          live.map((c) => c.name),
          name
        )
      ) {
        throw new AppError("A category with this name already exists", 409);
      }
      if (live.length >= MAX_CUSTOM_CATEGORIES) {
        throw new AppError("Too many own categories", 400);
      }
      // A deleted category of the same name comes back instead of a twin
      // appearing: the values stays still carry under it are the same judgement.
      const revived = mine.find(
        (c) => c.deletedAt !== null && c.name.toLowerCase() === name.toLowerCase()
      );
      if (revived) {
        await prisma.lodgingRatingCategory.update({
          where: { id: revived.id },
          data: { deletedAt: null, name },
        });
      } else {
        await prisma.lodgingRatingCategory.create({ data: { userId, name } });
      }
      res.status(201).json({ success: true, data: await snapshot(userId) });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/rating-categories/custom/:id",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUser(req);
      const parsed = nameSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError("Invalid category name", 400);
      const { name } = parsed.data;
      const mine = await prisma.lodgingRatingCategory.findMany({ where: { userId } });
      const target = mine.find((c) => c.id === req.params.id && c.deletedAt === null);
      if (!target) throw new AppError("Category not found", 404);
      const others = mine.filter((c) => c.id !== target.id && c.deletedAt === null);
      if (
        nameTaken(
          others.map((c) => c.name),
          name
        )
      ) {
        throw new AppError("A category with this name already exists", 409);
      }
      await prisma.lodgingRatingCategory.update({ where: { id: target.id }, data: { name } });
      res.json({ success: true, data: await snapshot(userId) });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  "/rating-categories/custom/:id",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUser(req);
      const { count } = await prisma.lodgingRatingCategory.updateMany({
        where: { id: req.params.id, userId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw new AppError("Category not found", 404);
      res.json({ success: true, data: await snapshot(userId) });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
