import { Router, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { portGeocodeLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import { invalidateCruiseEntityCache } from "../services/cruiseEntityResolver";
import { expandPortSearchTerms } from "../services/portExonyms";
import { geocodePort } from "../services/portGeocoder";
import logger from "../utils/logger";

const router = Router();
router.use(authenticate);
// Read-only PATs may search/geocode ports (GET) but not create them (POST).
router.use(requireWriteScope);

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

    // No search term → simple structured listing (optionally region-scoped).
    if (!q || q.length === 0) {
      // `total` rides along so list UIs can say "100 of 12059" instead of
      // looking like a catalogue that ends mid-alphabet.
      const [ports, total] = await Promise.all([
        prisma.port.findMany({
          where: region ? { region } : {},
          take: limit,
          orderBy: { name: "asc" },
        }),
        prisma.port.count({ where: region ? { region } : {} }),
      ]);
      res.json({ success: true, data: ports, total });
      return;
    }

    // Search is diacritic-INSENSITIVE: users type ASCII ("Malaga", "Warnemunde",
    // "Tromso") but the catalog stores accented names ("Málaga", "Warnemünde",
    // "Tromsø"). Plain ILIKE never matches across the fold, so we run both the
    // column and the needle through Postgres `unaccent` (enabled via migration).
    // German exonyms ("Lissabon" → "Lisbon") still expand to extra needles.
    const upper = q.toUpperCase();
    const needles = [q, ...expandPortSearchTerms(q)];
    const likeConditions = needles.flatMap((term) => {
      const pattern = `%${term}%`;
      return [
        Prisma.sql`unaccent(name) ILIKE unaccent(${pattern})`,
        Prisma.sql`unaccent(coalesce(city, '')) ILIKE unaccent(${pattern})`,
      ];
    });
    // Exact UNLOCODE match (e.g. "ITTAR") is always a candidate.
    likeConditions.push(Prisma.sql`unlocode = ${upper}`);

    const ports = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT id, name, city, country, unlocode, lat, lon, timezone, region,
             is_user_added AS "isUserAdded"
      FROM ports
      WHERE (${Prisma.join(likeConditions, " OR ")})
        ${region ? Prisma.sql`AND region = ${region}` : Prisma.empty}
      ORDER BY (unlocode = ${upper}) DESC, name ASC
      LIMIT ${limit}
    `);

    // Same total for the search branch — the raw-SQL WHERE is reused verbatim.
    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT count(*) AS count FROM ports
      WHERE (${Prisma.join(likeConditions, " OR ")})
        ${region ? Prisma.sql`AND region = ${region}` : Prisma.empty}
    `);
    res.json({ success: true, data: ports, total: Number(count) });
  } catch (err) {
    next(err);
  }
});

// External geocoder fallback: when the local catalog has no match, the
// frontend calls this to resolve an arbitrary place name (e.g. "Taranto",
// which isn't in the vendored CSV) to coordinates so the user can add it as a
// port without typing lat/lon by hand. Results carry source:"geocoder" and no
// id — the client POSTs the chosen one back to /ports to persist it.
router.get("/geocode", portGeocodeLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const { q } = parsed.data;
    if (!q || q.trim().length < 2) {
      res.json({ success: true, data: [] });
      return;
    }
    const ports = await geocodePort(q);
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
