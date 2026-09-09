import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import {
  findOrCreateAirport,
  findNearestAirport,
  enrichAirportData
} from '../services/airportLookup';
import { authenticate, requireWriteScope, AuthRequest } from '../middleware/auth';
import { airportSearchBurstLimiter, airportSearchLimiter } from '../middleware/rateLimit';
import { createAirportSchema } from '../schemas/airportData';
import { deriveTimezone } from '../services/airportLookup';
import { invalidateAirportCache } from '../services/airportCache';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';

const enrichAirportSchema = z.object({
  iata: z.string().length(3).toUpperCase().optional(),
  icao: z.string().length(4).toUpperCase().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
}).refine(
  (data) => data.iata || data.icao || (data.lat !== undefined && data.lon !== undefined),
  { message: 'Provide either IATA, ICAO, or coordinates (lat/lon)' }
);

const router = Router();

// Search airports — unauthenticated by design so the signup-flow autocomplete
// works before a user has credentials. The OurAirports dataset itself is
// public, so there's no secrecy to defend; the two stacked rate-limit buckets
// (15-min sustained + 1-min burst) bound enumeration / DB-pressure abuse.
router.get(
  '/search',
  airportSearchBurstLimiter,
  airportSearchLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string' || q.length > 100) {
      return res.json([]);
    }

    const searchTerm = q.toLowerCase();
    // Opt-in, and off by default. A closed airport is findable by its exact
    // code either way (the Munich-Riem contract below), but not by NAME — and
    // that is what an importer of old bookings has: a 2004 confirmation says
    // "Berlin", never "TXL", so Berlin-Tegel could not be attached at all
    // (#287). Lifting the filter for everyone is what UAT finding C13 already
    // rejected: "GRU" then fills the list with closed heliports whose
    // identifiers merely contain the letters, burying the real airports.
    const includeClosed = req.query.includeClosed === 'true';
    // The OpenAPI spec has always documented `limit` (1..50) on this route
    // while the handler hardcoded 10 and ignored it — the reporter of #287
    // passed `limit=3` and got ten rows. Read it, clamp it, and the spec is
    // true again.
    const requestedLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(50, Math.max(1, requestedLimit))
      : 10;

    // Exact IATA/ICAO matches first (active airport, then any closed
    // predecessor that shares the code — e.g. Munich Airport + Munich-Riem
    // both keyed MUC/EDDM), then partial matches below.
    const exactMatches = await prisma.airport.findMany({
      where: {
        OR: [
          { iata: { equals: searchTerm, mode: 'insensitive' } },
          { icao: { equals: searchTerm, mode: 'insensitive' } },
        ],
      },
      orderBy: { isClosed: 'asc' },
    });
    const exactIds = exactMatches.map((a) => a.id);

    const partialMatches = await prisma.airport.findMany({
      where: {
        AND: [
          // Exclude exact matches to avoid duplicates
          ...(exactIds.length > 0 ? [{ id: { notIn: exactIds } }] : []),
          // Closed airports stay findable via their EXACT code (the
          // Munich-Riem contract above) but are excluded from fuzzy
          // matching: "GRU" used to fill the list with closed US heliports
          // whose identifiers merely contained the letters (UAT finding
          // C13), burying the airports anyone actually searches for.
          // `includeClosed=true` is the caller saying it wants them anyway.
          ...(includeClosed ? [] : [{ isClosed: false }]),
          {
            OR: [
              { iata: { contains: searchTerm, mode: 'insensitive' } },
              { icao: { contains: searchTerm, mode: 'insensitive' } },
              { name: { contains: searchTerm, mode: 'insensitive' } },
              { city: { contains: searchTerm, mode: 'insensitive' } },
            ],
          },
        ],
      },
      take: Math.max(0, limit - exactMatches.length),
      // Open before closed, so opting in never pushes a live airport down the
      // list — the closed ones are an addition, not a reordering.
      orderBy: [{ isClosed: 'asc' }, { iata: 'asc' }],
    });

    res.json([...exactMatches, ...partialMatches].slice(0, limit));
  } catch (error) {
    next(error);
  }
});

// Get airport by IATA/ICAO code - with automatic external lookup and DB save (rate limited)
router.get('/:code', airportSearchLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params;

    // Try to find in DB, or fetch from external API and save
    const airport = await findOrCreateAirport(code);

    if (!airport) {
      return res.status(404).json({ error: 'Airport not found' });
    }

    res.json(airport);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/airports/nearest?lat=50.033&lon=8.570&maxDistance=5
// Find nearest airport by coordinates (requires authentication)
router.get('/coords/nearest', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const maxDistance = req.query.maxDistance
      ? parseFloat(req.query.maxDistance as string)
      : 5;

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: 'Invalid latitude or longitude' });
    }

    const airport = await findNearestAirport(lat, lon, maxDistance);

    if (!airport) {
      return res.status(404).json({
        error: `No airport found within ${maxDistance}km of coordinates`,
      });
    }

    res.json(airport);
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/airports/enrich
// Enrich airport data with missing information (requires authentication)
router.post('/enrich', authenticate, requireWriteScope, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { iata, icao, lat, lon } = enrichAirportSchema.parse(req.body);

    const enriched = await enrichAirportData({ iata, icao, lat, lon });

    if (!enriched) {
      return res.status(404).json({
        error: 'No matching airport found',
      });
    }

    res.json(enriched);
  } catch (error) {
    next(error);
  }
});

// Manual airport creation (#191) — the flight-side mirror of the ship/port
// create endpoints: authenticated (not admin-gated, same as ships/ports),
// flagged isUserAdded so the CSV re-seed never overwrites the row, timezone
// derived from the coordinates via geo-tz.
router.post('/', authenticate, requireWriteScope, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createAirportSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const data = parsed.data;

    if (!data.iata && !data.icao && !data.name) {
      throw new AppError('An airport needs at least a name', 400);
    }

    // Reject code collisions against ACTIVE airports — the composite
    // (code, isClosed) uniqueness would raise anyway, but a 409 with a clear
    // message beats a P2002 surfacing as a 500.
    if (data.iata) {
      const clash = await prisma.airport.findFirst({ where: { iata: data.iata, isClosed: false } });
      if (clash) throw new AppError(`An active airport with IATA ${data.iata} already exists`, 409);
    }
    if (data.icao) {
      const clash = await prisma.airport.findFirst({ where: { icao: data.icao, isClosed: false } });
      if (clash) throw new AppError(`An active airport with ICAO ${data.icao} already exists`, 409);
    }

    const airport = await prisma.airport.create({
      data: {
        name: data.name,
        iata: data.iata ?? null,
        icao: data.icao ?? null,
        city: data.city ?? null,
        country: data.country ?? null,
        lat: data.lat,
        lon: data.lon,
        altitude: data.altitude ?? null,
        timezone: deriveTimezone(data.lat, data.lon),
        isUserAdded: true,
      },
    });

    // The negative-result cache may hold "no such airport" for these codes.
    if (airport.iata) invalidateAirportCache(airport.iata);
    if (airport.icao) invalidateAirportCache(airport.icao);

    logger.info({ operation: 'airport_create_manual', airportId: airport.id, userId: req.userId });
    res.status(201).json({ success: true, data: airport });
  } catch (err) {
    next(err);
  }
});

export default router;
