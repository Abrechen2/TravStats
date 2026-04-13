import { Router, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AIRLINES } from '../data/airlines';
import { AIRCRAFT_TYPES } from '../data/aircraftTypes';

const router = Router();

router.use(authenticate);

/**
 * GET /api/v1/suggestions/airlines
 * Returns deduplicated, sorted list of airline names:
 * static seed data + user's unique entries from flights.
 */
router.get('/airlines', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    // User's unique airlines from flight history
    const userAirlines = await prisma.flight.findMany({
      where: { userId, airline: { not: null } },
      select: { airline: true },
      distinct: ['airline'],
    });

    // Merge: static names + user's custom entries
    const nameSet = new Set(AIRLINES.map(a => a.name));
    for (const row of userAirlines) {
      if (row.airline) nameSet.add(row.airline);
    }

    const sorted = Array.from(nameSet).sort((a, b) => a.localeCompare(b));

    res.json({ suggestions: sorted });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/suggestions/aircraft
 * Returns deduplicated, sorted list of aircraft type names:
 * static seed data + user's unique entries from flights.
 */
router.get('/aircraft', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    // User's unique aircraft from flight history
    const userAircraft = await prisma.flight.findMany({
      where: { userId, aircraft: { not: null } },
      select: { aircraft: true },
      distinct: ['aircraft'],
    });

    // Merge: static names + user's custom entries
    const nameSet = new Set(AIRCRAFT_TYPES.map(a => a.name));
    for (const row of userAircraft) {
      if (row.aircraft) nameSet.add(row.aircraft);
    }

    const sorted = Array.from(nameSet).sort((a, b) => a.localeCompare(b));

    res.json({ suggestions: sorted });
  } catch (error) {
    next(error);
  }
});

export default router;
