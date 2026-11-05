import { Router, Response, NextFunction } from "express";

import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { createPlaceCategorySchema } from "../schemas/place";
import {
  createPlaceCategoryDef,
  deletePlaceCategoryDef,
} from "../services/places/placeCategoryDefs";

/**
 * The user's own place categories (enveloped, like `/places`). Built-in
 * categories are not rows: the client knows them, this lists only the extras.
 * No rate limiter: a person holds a handful, and the count is capped.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const rows = await prisma.placeCategoryDef.findMany({
      where: { userId },
      orderBy: { name: "asc" },
    });
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = createPlaceCategorySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const row = await createPlaceCategoryDef(userId, parsed.data);
    res.status(201).json({ success: true, data: row });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const movedPlaces = await deletePlaceCategoryDef(userId, req.params.id);
    res.json({ success: true, data: { movedPlaces } });
  } catch (error) {
    next(error);
  }
});

export default router;
