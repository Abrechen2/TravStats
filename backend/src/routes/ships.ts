import { Router, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { invalidateCruiseEntityCache } from "../services/cruiseEntityResolver";
import logger from "../utils/logger";

const router = Router();
router.use(authenticate);
// Read-only PATs may search ships (GET) but not create them (POST).
router.use(requireWriteScope);

const listQuerySchema = z.object({
  q: z.string().max(100).optional(),
  cruiseLine: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const createShipSchema = z.object({
  name: z.string().min(1).max(120),
  imo: z.string().max(10).optional(),
  cruiseLine: z.string().min(1).max(120),
  yearBuilt: z.number().int().min(1800).max(2100).optional(),
  grossTonnage: z.number().int().min(0).optional(),
  capacity: z.number().int().min(0).optional(),
});

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const { q, cruiseLine, limit } = parsed.data;

    const where: Prisma.ShipWhereInput = {};
    if (cruiseLine) where.cruiseLine = cruiseLine;
    if (q && q.length > 0) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { cruiseLine: { contains: q, mode: "insensitive" } },
        { imo: { equals: q } },
      ];
    }

    // `total` rides along so list UIs can say "100 of N" instead of looking
    // like a catalogue that ends mid-alphabet.
    const [ships, total] = await Promise.all([
      prisma.ship.findMany({
        where,
        take: limit,
        orderBy: { name: "asc" },
      }),
      prisma.ship.count({ where }),
    ]);

    if (q && q.length > 0) {
      ships.sort((a, b) => {
        const ax = a.imo === q ? 0 : 1;
        const bx = b.imo === q ? 0 : 1;
        return ax - bx;
      });
    }

    res.json({ success: true, data: ships, total });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createShipSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const ship = await prisma.ship.create({
      data: { ...parsed.data, isUserAdded: true },
    });
    invalidateCruiseEntityCache();
    logger.info({ operation: "ship_create", shipId: ship.id, userId: req.userId });
    res.status(201).json({ success: true, data: ship });
  } catch (err) {
    next(err);
  }
});

export default router;
