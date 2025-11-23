import { Router, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createFlightSchema, updateFlightSchema, flightQuerySchema } from '../schemas/flight';
import { AppError } from '../middleware/errorHandler';
import { calculateDistance, generateArcPoints } from '../utils/geo';
import { checkAndUpdateAchievements } from '../utils/achievements';
import { lookupFlightDetails } from '../services/flightLookup';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Lookup flight details from external providers (Aviationstack)
router.get('/lookup', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { flightNumber, date } = req.query;

    if (!flightNumber || typeof flightNumber !== 'string') {
      return res.status(400).json({ error: 'flightNumber is required' });
    }

    const lookup = await lookupFlightDetails(
      flightNumber,
      typeof date === 'string' ? date : undefined
    );

    if (!lookup) {
      return res.status(404).json({ error: 'No flight data found' });
    }

    res.json(lookup);
  } catch (error) {
    next(error);
  }
});

// Create flight
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const data = createFlightSchema.parse(req.body);

    const flight = await prisma.flight.create({
      data: {
        userId,
        airline: data.airline,
        flightNumber: data.flightNumber,
        callsign: data.callsign,
        aircraft: data.aircraft,
        depIcao: data.departure.icao,
        depIata: data.departure.iata,
        depName: data.departure.name,
        depLat: data.departure.lat,
        depLon: data.departure.lon,
        arrIcao: data.arrival.icao,
        arrIata: data.arrival.iata,
        arrName: data.arrival.name,
        arrLat: data.arrival.lat,
        arrLon: data.arrival.lon,
        departureTime: new Date(data.departureTime),
        arrivalTime: new Date(data.arrivalTime),
        status: data.status,
        notes: data.notes,
        ticketPrice: data.ticketPrice,
        currency: data.currency,
        category: data.category,
        tags: data.tags,
      },
    });

    // Check achievements after creating a flown flight (don't wait for it)
    if (data.status === 'flown') {
      checkAndUpdateAchievements(userId).catch(err =>
        console.error('Failed to check achievements:', err)
      );
    }

    res.status(201).json(flight);
  } catch (error) {
    next(error);
  }
});

// Get flights with filters
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const query = flightQuerySchema.parse(req.query);

    const where: any = { userId };

    if (query.airline) {
      where.airline = { contains: query.airline, mode: 'insensitive' };
    }
    if (query.flightNumber) {
      where.flightNumber = { contains: query.flightNumber, mode: 'insensitive' };
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.fromDate || query.toDate) {
      where.departureTime = {};
      if (query.fromDate) {
        where.departureTime.gte = new Date(query.fromDate);
      }
      if (query.toDate) {
        where.departureTime.lte = new Date(query.toDate);
      }
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
    const query = flightQuerySchema.parse(req.query);

    const where: any = { userId };

    if (query.airline) {
      where.airline = { contains: query.airline, mode: 'insensitive' };
    }
    if (query.flightNumber) {
      where.flightNumber = { contains: query.flightNumber, mode: 'insensitive' };
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.fromDate || query.toDate) {
      where.departureTime = {};
      if (query.fromDate) {
        where.departureTime.gte = new Date(query.fromDate);
      }
      if (query.toDate) {
        where.departureTime.lte = new Date(query.toDate);
      }
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

    const updateData: any = {};
    if (data.airline) updateData.airline = data.airline;
    if (data.flightNumber) updateData.flightNumber = data.flightNumber;
    if (data.callsign !== undefined) updateData.callsign = data.callsign;
    if (data.aircraft !== undefined) updateData.aircraft = data.aircraft;
    if (data.status) updateData.status = data.status;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.ticketPrice !== undefined) updateData.ticketPrice = data.ticketPrice;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.category) updateData.category = data.category;
    if (data.tags !== undefined) updateData.tags = data.tags;

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

    // Check achievements if status changed to flown
    if (data.status === 'flown' && existingFlight.status !== 'flown') {
      checkAndUpdateAchievements(userId).catch(err =>
        console.error('Failed to check achievements:', err)
      );
    }

    res.json(flight);
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
