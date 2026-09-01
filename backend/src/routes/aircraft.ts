import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import {
  invalidateAircraftCatalogCache,
  preloadAircraftCatalog,
} from "../services/aircraftCatalogCache";
import logger from "../utils/logger";

// No rate limiter, for the same reason as its sibling `airlines.ts`: an
// authenticated typeahead served from the in-process catalog cache plus a
// one-row insert. No external call, no unbounded scan.
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

const listQuerySchema = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createAircraftSchema = z.object({
  icao: z.string().min(3).max(4).optional(),
  name: z.string().min(1).max(120),
});

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const { q, limit } = parsed.data;

    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { icao: { equals: q.toUpperCase() } },
          ],
        }
      : {};

    // `total` rides along so list UIs can say "50 of 236" instead of
    // looking like a catalogue that ends mid-alphabet.
    const [aircraft, total] = await Promise.all([
      prisma.aircraft.findMany({
        where,
        take: limit,
        orderBy: { name: "asc" },
      }),
      prisma.aircraft.count({ where }),
    ]);
    res.json({ success: true, data: aircraft, total });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createAircraftSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const aircraft = await prisma.aircraft.create({
      data: {
        ...parsed.data,
        icao: parsed.data.icao?.toUpperCase() ?? null,
        isUserAdded: true,
      },
    });
    invalidateAircraftCatalogCache();
    await preloadAircraftCatalog();
    logger.info({ operation: "aircraft_create", aircraftId: aircraft.id, userId: req.userId });
    res.status(201).json({ success: true, data: aircraft });
  } catch (err) {
    next(err);
  }
});

export default router;
