import { Router, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createFlightSchema, updateFlightSchema, flightQuerySchema } from '../schemas/flight';
import type { FlightQueryInput } from '../schemas/flight';
import { AppError } from '../middleware/errorHandler';
import { calculateDistance, generateArcPoints } from '../utils/geo';
import { checkAndUpdateAchievements } from '../utils/achievements';
import { enrichFlightAirports } from '../services/airportLookup';
import { flightCreationLimiter } from '../middleware/rateLimit';
import { lookupFlightDetails } from '../services/flightLookup';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Normalize query params coming from axios (arrays are sent as foo[] by default)
const normalizeQueryParams = (query: Record<string, any>) => {
  const normalized: Record<string, any> = {};

  Object.entries(query).forEach(([key, value]) => {
    const normalizedKey = key.endsWith('[]') ? key.slice(0, -2) : key;
    normalized[normalizedKey] = value;
  });

  return normalized;
};

// Convert a potentially pipe/comma separated string or array into a clean string array
const splitMultiValue = (value?: string | string[]) => {
  if (!value) return [];

  const raw = Array.isArray(value) ? value : value.split(',');

  return raw
    .flatMap(v => v.split('|'))
    .map(v => v.trim())
    .filter(Boolean);
};

const buildFlightWhere = (
  query: (FlightQueryInput & { tags?: string[] }),
  userId: string
) => {
  const andConditions: any[] = [{ userId }];
  let noResults = false;

  // Airlines (allow multiple selections)
  const airlines = splitMultiValue(query.airline);
  if (airlines.length === 1) {
    andConditions.push({ airline: { contains: airlines[0], mode: 'insensitive' } });
  } else if (airlines.length > 1) {
    andConditions.push({
      OR: airlines.map(airline => ({
        airline: { contains: airline, mode: 'insensitive' },
      })),
    });
  }

  if (query.flightNumber) {
    andConditions.push({ flightNumber: { contains: query.flightNumber, mode: 'insensitive' } });
  }

  if (query.departureAirport) {
    andConditions.push({
      OR: [
        { depIata: { contains: query.departureAirport, mode: 'insensitive' } },
        { depIcao: { contains: query.departureAirport, mode: 'insensitive' } },
        { depName: { contains: query.departureAirport, mode: 'insensitive' } },
      ],
    });
  }

  if (query.arrivalAirport) {
    andConditions.push({
      OR: [
        { arrIata: { contains: query.arrivalAirport, mode: 'insensitive' } },
        { arrIcao: { contains: query.arrivalAirport, mode: 'insensitive' } },
        { arrName: { contains: query.arrivalAirport, mode: 'insensitive' } },
      ],
    });
  }

  // Status (allow multiple selections, explicit empty means no results)
  const statuses = splitMultiValue(query.status) as Array<'scheduled' | 'flown' | 'cancelled'>;
  if (Array.isArray(query.status) && query.status.length === 0) {
    noResults = true;
  } else if (statuses.length === 1) {
    andConditions.push({ status: statuses[0] });
  } else if (statuses.length > 1) {
    andConditions.push({ status: { in: statuses } });
  }

  if (query.category) {
    andConditions.push({ category: query.category });
  }

  // Tags
  const tags = query.tags || [];
  if (tags.length > 0) {
    andConditions.push({ tags: { hasEvery: tags } });
  }

  // Price range
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const price: any = {};
    if (query.minPrice !== undefined) price.gte = query.minPrice;
    if (query.maxPrice !== undefined) price.lte = query.maxPrice;
    andConditions.push({ price });
  }

  // Date range
  if (query.fromDate || query.toDate) {
    const departureTime: any = {};
    if (query.fromDate) departureTime.gte = new Date(query.fromDate);
    if (query.toDate) departureTime.lte = new Date(query.toDate);
    andConditions.push({ departureTime });
  }

  return {
    where: { AND: andConditions },
    noResults,
  };
};

// Lookup flight details from external providers
router.get('/lookup', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { flightNumber, date } = req.query;

    if (!flightNumber || typeof flightNumber !== 'string') {
      return res.status(400).json({ error: 'flightNumber is required' });
    }

    const lookup = await lookupFlightDetails(
      flightNumber,
      typeof date === 'string' ? date : undefined,
      req.userId!
    );

    if (!lookup) {
      return res.status(404).json({ error: 'No flight data found' });
    }

    res.json(lookup);
  } catch (error) {
    next(error);
  }
});

// Create flight (rate limited to prevent abuse)
router.post('/', flightCreationLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const data = createFlightSchema.parse(req.body);

    // Enrich airport data with missing information from database
    const enriched = await enrichFlightAirports({
      departure: {
        iata: data.departure.iata ?? undefined,
        icao: data.departure.icao ?? undefined,
        name: data.departure.name ?? undefined,
        lat: data.departure.lat,
        lon: data.departure.lon,
      },
      arrival: {
        iata: data.arrival.iata ?? undefined,
        icao: data.arrival.icao ?? undefined,
        name: data.arrival.name ?? undefined,
        lat: data.arrival.lat,
        lon: data.arrival.lon,
      },
    });

    const flight = await prisma.flight.create({
      data: {
        userId,
        airline: data.airline,
        flightNumber: data.flightNumber,
        callsign: data.callsign,
        aircraft: data.aircraft,
        // Use enriched departure data (fills in missing IATA/ICAO/names)
        depIcao: enriched.departure.icao,
        depIata: enriched.departure.iata,
        depName: enriched.departure.name,
        depLat: enriched.departure.lat,
        depLon: enriched.departure.lon,
        // Use enriched arrival data (fills in missing IATA/ICAO/names)
        arrIcao: enriched.arrival.icao,
        arrIata: enriched.arrival.iata,
        arrName: enriched.arrival.name,
        arrLat: enriched.arrival.lat,
        arrLon: enriched.arrival.lon,
        departureTime: new Date(data.departureTime),
        arrivalTime: new Date(data.arrivalTime),
        status: data.status,
        notes: data.notes,
        price: data.price,
        taxes: data.taxes,
        fees: data.fees,
        currency: data.currency,
        category: data.category,
        tags: data.tags ?? [],
        receiptUrl: data.receiptUrl,
      },
    });

    // Check achievements after creating a flown flight and return newly unlocked ones
    let newAchievements: any[] = [];
    if (data.status === 'flown') {
      try {
        newAchievements = await checkAndUpdateAchievements(userId);
      } catch (err: any) {
        // Import logger locally to avoid circular dependencies
        import('../utils/logger').then(({ default: logger }) => {
          logger.error({ type: 'achievement_check_failed', userId, error: err.message });
        });
      }
    }

    res.status(201).json({
      flight,
      newAchievements: newAchievements.length > 0 ? newAchievements : undefined
    });
  } catch (error) {
    next(error);
  }
});

// Get flights with filters
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const normalizedQuery = normalizeQueryParams(req.query as Record<string, any>);
    const parsedQuery = flightQuerySchema.parse(normalizedQuery);
    const tagsArray = splitMultiValue(parsedQuery.tags as any);
    const query = {
      ...parsedQuery,
      tags: tagsArray,
      limit: Math.min(parsedQuery.limit ?? 100, 500),
    };
    const { where, noResults } = buildFlightWhere(query, userId);

    if (noResults) {
      return res.json({
        flights: [],
        total: 0,
        limit: query.limit,
        offset: query.offset,
      });
    }

    const [flights, total] = await Promise.all([
      prisma.flight.findMany({
        where,
        orderBy: { departureTime: 'desc' },
        skip: query.offset,
        take: query.limit,
      }),
      prisma.flight.count({ where }),
    ]);

    res.json({
      flights,
      total,
      limit: query.limit,
      offset: query.offset,
    });
  } catch (error) {
    next(error);
  }
});

// Get flights as GeoJSON
router.get('/geo', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const normalizedQuery = normalizeQueryParams(req.query as Record<string, any>);
    const parsedQuery = flightQuerySchema.parse(normalizedQuery);
    const tagsArray = splitMultiValue(parsedQuery.tags as any);
    const query = {
      ...parsedQuery,
      tags: tagsArray,
      limit: Math.min(parsedQuery.limit ?? 100, 500),
    };
    const { where, noResults } = buildFlightWhere(query, userId);

    if (noResults) {
      return res.json({
        type: 'FeatureCollection',
        features: [],
      });
    }

    const flights = await prisma.flight.findMany({
      where,
      orderBy: { departureTime: 'desc' },
      skip: query.offset,
      take: query.limit,
    });

    const features = flights.map(flight => {
      const arcPoints = generateArcPoints(
        [flight.depLon, flight.depLat],
        [flight.arrLon, flight.arrLat]
      );

      return {
        type: 'Feature',
        properties: {
          id: flight.id,
          airline: flight.airline,
          flightNumber: flight.flightNumber,
          callsign: flight.callsign,
          aircraft: flight.aircraft,
          departureAirport: {
            icao: flight.depIcao,
            iata: flight.depIata,
            name: flight.depName,
          },
          arrivalAirport: {
            icao: flight.arrIcao,
            iata: flight.arrIata,
            name: flight.arrName,
          },
          departureTime: flight.departureTime,
          arrivalTime: flight.arrivalTime,
          status: flight.status,
          category: flight.category,
          tags: flight.tags || [],
          price: flight.price,
          currency: flight.currency,
          taxes: flight.taxes,
          fees: flight.fees,
          distance: calculateDistance(
            flight.depLat,
            flight.depLon,
            flight.arrLat,
            flight.arrLon
          ),
        },
        geometry: {
          type: 'LineString',
          coordinates: arcPoints,
        },
      };
    });

    res.json({
      type: 'FeatureCollection',
      features,
    });
  } catch (error) {
    next(error);
  }
});

// Get single flight
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const flight = await prisma.flight.findFirst({
      where: { id, userId },
    });

    if (!flight) {
      throw new AppError('Flight not found', 404);
    }

    res.json(flight);
  } catch (error) {
    next(error);
  }
});

// Update flight
router.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const data = updateFlightSchema.parse(req.body);

    // Check if flight exists and belongs to user
    const existingFlight = await prisma.flight.findFirst({
      where: { id, userId },
    });

    if (!existingFlight) {
      throw new AppError('Flight not found', 404);
    }

    // Enrich airport data if departure or arrival is being updated
    if (data.departure || data.arrival) {
      const enriched = await enrichFlightAirports({
        departure: data.departure ? {
          iata: data.departure.iata ?? undefined,
          icao: data.departure.icao ?? undefined,
          name: data.departure.name ?? undefined,
          lat: data.departure.lat,
          lon: data.departure.lon,
        } : {
          iata: existingFlight.depIata ?? undefined,
          icao: existingFlight.depIcao ?? undefined,
          name: existingFlight.depName ?? undefined,
          lat: existingFlight.depLat,
          lon: existingFlight.depLon,
        },
        arrival: data.arrival ? {
          iata: data.arrival.iata ?? undefined,
          icao: data.arrival.icao ?? undefined,
          name: data.arrival.name ?? undefined,
          lat: data.arrival.lat,
          lon: data.arrival.lon,
        } : {
          iata: existingFlight.arrIata ?? undefined,
          icao: existingFlight.arrIcao ?? undefined,
          name: existingFlight.arrName ?? undefined,
          lat: existingFlight.arrLat,
          lon: existingFlight.arrLon,
        },
      });

      // Only update airport data if enrichment was performed
      if (data.departure) {
        data.departure.icao = enriched.departure.icao;
        data.departure.iata = enriched.departure.iata;
        data.departure.name = enriched.departure.name;
        data.departure.lat = enriched.departure.lat;
        data.departure.lon = enriched.departure.lon;
      }

      if (data.arrival) {
        data.arrival.icao = enriched.arrival.icao;
        data.arrival.iata = enriched.arrival.iata;
        data.arrival.name = enriched.arrival.name;
        data.arrival.lat = enriched.arrival.lat;
        data.arrival.lon = enriched.arrival.lon;
      }
    }

    const updateData: any = {};
    if (data.airline) updateData.airline = data.airline;
    if (data.flightNumber) updateData.flightNumber = data.flightNumber;
    if (data.callsign !== undefined) updateData.callsign = data.callsign;
    if (data.aircraft !== undefined) updateData.aircraft = data.aircraft;
    if (data.status) updateData.status = data.status;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.price !== undefined) updateData.price = data.price;
    if (data.taxes !== undefined) updateData.taxes = data.taxes;
    if (data.fees !== undefined) updateData.fees = data.fees;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.receiptUrl !== undefined) updateData.receiptUrl = data.receiptUrl;

    if (data.departure) {
      updateData.depIcao = data.departure.icao;
      updateData.depIata = data.departure.iata;
      updateData.depName = data.departure.name;
      updateData.depLat = data.departure.lat;
      updateData.depLon = data.departure.lon;
    }

    if (data.arrival) {
      updateData.arrIcao = data.arrival.icao;
      updateData.arrIata = data.arrival.iata;
      updateData.arrName = data.arrival.name;
      updateData.arrLat = data.arrival.lat;
      updateData.arrLon = data.arrival.lon;
    }

    if (data.departureTime) updateData.departureTime = new Date(data.departureTime);
    if (data.arrivalTime) updateData.arrivalTime = new Date(data.arrivalTime);

    const flight = await prisma.flight.update({
      where: { id },
      data: updateData,
    });

    // Check achievements if status changed to flown and return newly unlocked ones
    let newAchievements: any[] = [];
    if (data.status === 'flown' && existingFlight.status !== 'flown') {
      try {
        newAchievements = await checkAndUpdateAchievements(userId);
      } catch (err: any) {
        // Import logger locally to avoid circular dependencies
        import('../utils/logger').then(({ default: logger }) => {
          logger.error({ type: 'achievement_check_failed', userId, error: err.message });
        });
      }
    }

    res.json({
      flight,
      newAchievements: newAchievements.length > 0 ? newAchievements : undefined
    });
  } catch (error) {
    next(error);
  }
});

// Delete flight
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    // Check if flight exists and belongs to user
    const existingFlight = await prisma.flight.findFirst({
      where: { id, userId },
    });

    if (!existingFlight) {
      throw new AppError('Flight not found', 404);
    }

    await prisma.flight.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
