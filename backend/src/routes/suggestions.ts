import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { authenticate, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { normalizeAircraft } from "../utils/aircraftNormalize";

// No rate limiter: both routes are search-as-you-type and both are capped at
// SUGGESTION_CAP rows from local tables, with no external call anywhere. The
// geocoding typeaheads (`/geo/search`, `/ports/geocode`) ARE limited, and the
// difference is exactly that they spend someone else's quota per keystroke
// while these spend an indexed query.
const router = Router();

router.use(authenticate);

const SUGGESTION_CAP = 50;

const listQuerySchema = z.object({
  q: z.string().max(100).optional(),
});

/**
 * GET /api/v1/suggestions/airlines
 * Returns a deduplicated, sorted, capped list of airline names:
 * DB catalogue matches (optionally filtered by `q`) + the user's own
 * flight entries (also filtered by `q` when present).
 */
router.get(
  "/airlines",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const { q } = parsed.data;
      const userId = req.userId!;

      const [dbAirlines, userAirlines] = await Promise.all([
        prisma.airline.findMany({
          where: q ? { name: { contains: q, mode: "insensitive" } } : {},
          take: SUGGESTION_CAP,
          orderBy: { name: "asc" },
          select: { name: true },
        }),
        // groupBy, not `distinct`: without the nativeDistinct preview Prisma
        // fetches every row and de-duplicates in Node (forgejo#343).
        prisma.flight.groupBy({
          by: ["airline"],
          where: {
            userId,
            airline: q ? { not: null, contains: q, mode: "insensitive" } : { not: null },
          },
        }),
      ]);

      const qLower = q?.toLowerCase();
      const nameSet = new Set(dbAirlines.map((a) => a.name));
      for (const row of userAirlines) {
        if (!row.airline) continue;
        if (qLower && !row.airline.toLowerCase().includes(qLower)) continue;
        nameSet.add(row.airline);
      }

      const sorted = Array.from(nameSet)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, SUGGESTION_CAP);

      res.json({ suggestions: sorted });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/suggestions/aircraft
 * Returns a deduplicated, sorted, capped list of aircraft type names:
 * DB catalogue matches (optionally filtered by `q`) + the user's own
 * flight entries (normalized, also filtered by `q` when present).
 */
router.get(
  "/aircraft",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const { q } = parsed.data;
      const userId = req.userId!;

      const [dbAircraft, userAircraft] = await Promise.all([
        prisma.aircraft.findMany({
          where: q ? { name: { contains: q, mode: "insensitive" } } : {},
          take: SUGGESTION_CAP,
          orderBy: { name: "asc" },
          select: { name: true },
        }),
        // `q` is matched on the NORMALISED name below, which SQL cannot see.
        prisma.flight.groupBy({
          by: ["aircraft"],
          where: { userId, aircraft: { not: null } },
        }),
      ]);

      const qLower = q?.toLowerCase();
      const nameSet = new Set(dbAircraft.map((a) => a.name));
      for (const row of userAircraft) {
        if (!row.aircraft) continue;
        const normalized = normalizeAircraft(row.aircraft);
        if (qLower && !normalized.toLowerCase().includes(qLower)) continue;
        nameSet.add(normalized);
      }

      const sorted = Array.from(nameSet)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, SUGGESTION_CAP);

      res.json({ suggestions: sorted });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
