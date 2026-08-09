import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import {
  invalidateAirlineCatalogCache,
  preloadAirlineCatalog,
} from "../services/airlineCatalogCache";
import logger from "../utils/logger";

const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

const listQuerySchema = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createAirlineSchema = z.object({
  iata: z.string().min(2).max(3).optional(),
  icao: z.string().min(3).max(4).optional(),
  name: z.string().min(1).max(120),
  callsign: z.string().max(120).optional(),
  country: z.string().max(120).optional(),
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
            { iata: { equals: q.toUpperCase() } },
            { icao: { equals: q.toUpperCase() } },
          ],
        }
      : {};

    // `total` rides along so list UIs can say "50 of 1125" instead of
    // looking like a catalogue that ends mid-alphabet.
    const [airlines, total] = await Promise.all([
      prisma.airline.findMany({
        where,
        take: limit,
        orderBy: { name: "asc" },
      }),
      prisma.airline.count({ where }),
    ]);
    res.json({ success: true, data: airlines, total });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createAirlineSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const airline = await prisma.airline.create({
      data: {
        ...parsed.data,
        iata: parsed.data.iata?.toUpperCase() ?? null,
        icao: parsed.data.icao?.toUpperCase() ?? null,
        isUserAdded: true,
      },
    });
    invalidateAirlineCatalogCache();
    await preloadAirlineCatalog();
    logger.info({ operation: "airline_create", airlineId: airline.id, userId: req.userId });
    res.status(201).json({ success: true, data: airline });
  } catch (err) {
    next(err);
  }
});

export default router;
