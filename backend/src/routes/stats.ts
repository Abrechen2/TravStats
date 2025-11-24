import { Router, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { calculateDistance } from '../utils/geo';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get summary statistics
router.get('/summary', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { fromDate, toDate } = req.query;

    const where: any = { userId };

    if (fromDate || toDate) {
      where.departureTime = {};
      if (fromDate) {
        where.departureTime.gte = new Date(fromDate as string);
      }
      if (toDate) {
        where.departureTime.lte = new Date(toDate as string);
      }
    }

    const flights = await prisma.flight.findMany({
      where,
    });

    let totalDistance = 0;
    let totalFlightTime = 0;
    let totalCost = 0;

    flights.forEach(flight => {
      const distance = calculateDistance(
        flight.depLat,
        flight.depLon,
        flight.arrLat,
        flight.arrLon
      );
      totalDistance += distance;

      const flightTime =
        (flight.arrivalTime.getTime() - flight.departureTime.getTime()) / 1000 / 60; // minutes
      totalFlightTime += flightTime;

      const costParts = [flight.price, flight.taxes, flight.fees].filter(
        (v): v is number => typeof v === 'number'
      );
      if (costParts.length > 0) {
        totalCost += costParts.reduce((a, b) => a + b, 0);
      }
    });

    const avgDistance = flights.length > 0 ? totalDistance / flights.length : 0;

    // Count by status
    const byStatus = flights.reduce((acc, flight) => {
      acc[flight.status] = (acc[flight.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Count by airline
    const byAirline = flights.reduce((acc, flight) => {
      const airline = flight.airline || 'Unknown';
      acc[airline] = (acc[airline] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const byCategory = flights.reduce((acc, flight) => {
      const cat = flight.category || 'unassigned';
      acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    res.json({
      totalFlights: flights.length,
      totalDistance: Math.round(totalDistance),
      totalFlightTime: Math.round(totalFlightTime),
      avgDistance: Math.round(avgDistance),
      byStatus,
      byAirline,
      totalCost: Math.round(totalCost * 100) / 100,
      byCategory,
    });
  } catch (error) {
    next(error);
  }
});

// Get top routes
router.get('/routes', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const limit = parseInt(req.query.limit as string) || 10;

    const flights = await prisma.flight.findMany({
      where: { userId },
    });

    // Group by route
    const routeMap = new Map<string, {
      count: number;
      departure: { iata?: string; name?: string; lat: number; lon: number };
      arrival: { iata?: string; name?: string; lat: number; lon: number };
      distance: number;
    }>();

    flights.forEach(flight => {
      const routeKey = `${flight.depIata || flight.depIcao}-${flight.arrIata || flight.arrIcao}`;

      if (routeMap.has(routeKey)) {
        routeMap.get(routeKey)!.count++;
      } else {
        routeMap.set(routeKey, {
          count: 1,
          departure: {
            iata: flight.depIata || undefined,
            name: flight.depName || undefined,
            lat: flight.depLat,
            lon: flight.depLon,
          },
          arrival: {
            iata: flight.arrIata || undefined,
            name: flight.arrName || undefined,
            lat: flight.arrLat,
            lon: flight.arrLon,
          },
          distance: calculateDistance(
            flight.depLat,
            flight.depLon,
            flight.arrLat,
            flight.arrLon
          ),
        });
      }
    });

    // Convert to array and sort by count
    const routes = Array.from(routeMap.entries())
      .map(([route, data]) => ({
        route,
        ...data,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    res.json({ routes });
  } catch (error) {
    next(error);
  }
});

export default router;
