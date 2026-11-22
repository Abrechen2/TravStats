import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { openDataLimiter } from "../../middleware/rateLimit";
import { prisma } from "../../db";
import { searchBrands } from "../../services/places/brandSearch";
import {
  clearListRule,
  getListRule,
  newOutletsForList,
  recentlyAutoAccepted,
  setListRule,
  suggestionsForPlace,
  undoAutoAccepted,
} from "../../services/places/brandRules";

/**
 * Smart lists (spec 2026-11-22-brand-lists.md): a place list that follows a chain.
 * Mounted ahead of `/api/v1/place-lists/:id` (like `curated`), because `smart` would
 * otherwise be read as a list id. Enveloped family `{ success, data }`, as the lists are.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};
const id = z.string().uuid();

const searchQuery = z.object({
  q: z.string().trim().min(1).max(80),
  lang: z.enum(["de", "en"]).default("en"),
});

router.get(
  "/brands",
  openDataLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      requireUser(req);
      const { q, lang } = searchQuery.parse(req.query);
      const result = await searchBrands(q, lang);
      if (result.ok) return res.json({ success: true, data: result.hits });
      switch (result.reason) {
        case "disabled":
          throw new AppError(
            "Open data services are switched off on this instance",
            409,
            "OPEN_DATA_DISABLED"
          );
        case "timeout":
          throw new AppError("Wikidata did not answer in time", 504, "UPSTREAM_TIMEOUT");
        case "rateLimited":
          throw new AppError("Wikidata is refusing more requests", 503, "UPSTREAM_RATE_LIMITED");
        default:
          throw new AppError("Wikidata did not answer", 502, "UPSTREAM_UNAVAILABLE");
      }
    } catch (error) {
      next(error);
    }
  }
);

const ruleBody = z
  .object({
    brands: z
      .array(
        z.object({
          brandWikidataId: z.string().regex(/^Q[1-9]\d*$/),
          brandName: z.string().trim().min(1).max(120),
        })
      )
      .min(1)
      .max(10),
    minDwellMinutes: z.number().int().min(1).max(1440),
    maxDwellMinutes: z.number().int().min(1).max(1440),
    maxDistanceM: z.number().int().min(10).max(500),
    autoAcceptDistanceM: z.number().int().min(10).max(500),
    autoAccept: z.boolean(),
  })
  .strict()
  .refine((b) => b.autoAcceptDistanceM <= b.maxDistanceM, {
    message: "autoAcceptDistanceM must not exceed maxDistanceM",
    path: ["autoAcceptDistanceM"],
  })
  .refine((b) => b.maxDwellMinutes >= b.minDwellMinutes, {
    message: "maxDwellMinutes must not be below minDwellMinutes",
    path: ["maxDwellMinutes"],
  });

router.get("/place/:placeId/suggestions", async (req: AuthRequest, res, next) => {
  try {
    const userId = requireUser(req);
    const placeId = id.parse(req.params.placeId);
    const own = await prisma.place.findFirst({
      where: { id: placeId, userId },
      select: { id: true },
    });
    if (!own) throw new AppError("Place not found", 404);
    res.json({ success: true, data: await suggestionsForPlace(userId, placeId) });
  } catch (error) {
    next(error);
  }
});

router.post("/auto/:stayId/undo", rejectDemo, async (req: AuthRequest, res, next) => {
  try {
    const result = await undoAutoAccepted(requireUser(req), id.parse(req.params.stayId));
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.get("/:listId/rule", async (req: AuthRequest, res, next) => {
  try {
    const rule = await getListRule(requireUser(req), id.parse(req.params.listId));
    res.json({ success: true, data: rule });
  } catch (error) {
    next(error);
  }
});

router.put("/:listId/rule", rejectDemo, async (req: AuthRequest, res, next) => {
  try {
    const body = ruleBody.parse(req.body);
    const { brands, ...settings } = body;
    const rule = await setListRule(requireUser(req), id.parse(req.params.listId), brands, settings);
    res.json({ success: true, data: rule });
  } catch (error) {
    next(error);
  }
});

router.delete("/:listId/rule", rejectDemo, async (req: AuthRequest, res, next) => {
  try {
    await clearListRule(requireUser(req), id.parse(req.params.listId));
    res.json({ success: true, data: null });
  } catch (error) {
    next(error);
  }
});

router.get("/:listId/suggestions", async (req: AuthRequest, res, next) => {
  try {
    const userId = requireUser(req);
    const listId = id.parse(req.params.listId);
    res.json({ success: true, data: await newOutletsForList(userId, listId) });
  } catch (error) {
    next(error);
  }
});

router.get("/:listId/auto", async (req: AuthRequest, res, next) => {
  try {
    const userId = requireUser(req);
    const listId = id.parse(req.params.listId);
    res.json({ success: true, data: await recentlyAutoAccepted(userId, listId) });
  } catch (error) {
    next(error);
  }
});

export default router;
