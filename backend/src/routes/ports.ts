import { Router, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { authenticate, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { invalidateCruiseEntityCache } from "../services/cruiseEntityResolver";
import { expandPortSearchTerms } from "../services/portExonyms";
import logger from "../utils/logger";

const router = Router();
router.use(authenticate);

const listQuerySchema = z.object({
  q: z.string().max(100).optional(),
  region: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const createPortSchema = z.object({
  name: z.string().min(1).max(120),
  city: z.string().max(120).optional(),
  country: z.string().max(120).optional(),
  unlocode: z.string().max(10).optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  timezone: z.string().max(60).optional(),
  region: z.string().max(40).optional(),
});

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const { q, region, limit } = parsed.data;

    const where: Prisma.PortWhereInput = {};
    if (region) where.region = region;
    if (q && q.length > 0) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { unlocode: { equals: q.toUpperCase() } },
      ];
      // German exonyms ("Lissabon") expand to the English catalog names
      // ("Lisbon") so DE users get hits instead of duplicate custom ports.
      for (const term of expandPortSearchTerms(q)) {
        where.OR.push({ name: { contains: term, mode: "insensitive" } });
        where.OR.push({ city: { contains: term, mode: "insensitive" } });
      }
    }

    const ports = await prisma.port.findMany({
      where,
      take: limit,
      orderBy: { name: "asc" },
    });

    if (q && q.length > 0) {
      const upper = q.toUpperCase();
      ports.sort((a, b) => {
        const ax = a.unlocode === upper ? 0 : 1;
        const bx = b.unlocode === upper ? 0 : 1;
        return ax - bx;
      });
    }

    res.json({ success: true, data: ports });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createPortSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const port = await prisma.port.create({
      data: { ...parsed.data, isUserAdded: true },
    });
    invalidateCruiseEntityCache();
    logger.info({ operation: "port_create", portId: port.id, userId: req.userId });
    res.status(201).json({ success: true, data: port });
  } catch (err) {
    next(err);
  }
});

export default router;
