import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import {
  findOrCreateAirport,
  findNearestAirport,
  enrichAirportData
} from '../services/airportLookup';
import { authenticate, AuthRequest } from '../middleware/auth';
import { airportSearchLimiter } from '../middleware/rateLimit';

const router = Router();

// Search airports (no auth required for better UX, but rate limited)
router.get('/search', airportSearchLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      return res.json([]);
    }

    const searchTerm = q.toLowerCase();

    const airports = await prisma.airport.findMany({
      where: {
        OR: [
          { iata: { contains: searchTerm, mode: 'insensitive' } },
          { icao: { contains: searchTerm, mode: 'insensitive' } },
          { name: { contains: searchTerm, mode: 'insensitive' } },
          { city: { contains: searchTerm, mode: 'insensitive' } },
        ],
      },
      take: 10,
      orderBy: [
        { iata: 'asc' },
      ],
    });

    res.json(airports);
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
router.post('/enrich', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { iata, icao, lat, lon } = req.body;

    if (!iata && !icao && (lat === undefined || lon === undefined)) {
      return res.status(400).json({
        error: 'Provide either IATA, ICAO, or coordinates (lat/lon)',
      });
    }

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

export default router;
