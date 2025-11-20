import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db';

const router = Router();

// Search airports (no auth required for better UX)
router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
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

// Get airport by IATA code
router.get('/:code', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params;

    const airport = await prisma.airport.findFirst({
      where: {
        OR: [
          { iata: code.toUpperCase() },
          { icao: code.toUpperCase() },
        ],
      },
    });

    if (!airport) {
      return res.status(404).json({ error: 'Airport not found' });
    }

    res.json(airport);
  } catch (error) {
    next(error);
  }
});

export default router;
