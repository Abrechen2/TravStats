import { Router, Response, NextFunction } from 'express';

import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// No rate limiter: one route, one grouped read of the caller's own companion
// links. It feeds a picker that opens on nearly every travel form, so a
// per-user cap here would fire during ordinary data entry and protect nothing
// — the query is bounded by how many people the caller has travelled with.

/**
 * The caller's companions, most used first. Feeds the companion picker in the
 * flight, trip and cruise forms.
 */
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.companion.findMany({
      where: { userId: req.userId },
      // No orderBy here — final ordering (usageCount desc, then name) is
      // decided in JS below, so a DB-level sort would be redundant work.
      include: {
        _count: { select: { flights: true, trips: true, cruises: true } },
      },
    });

    const companions = rows
      .map((row) => ({
        id: row.id,
        name: row.displayName,
        usageCount: row._count.flights + row._count.trips + row._count.cruises,
      }))
      .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name));

    res.json({ companions });
  } catch (error) {
    next(error);
  }
});

export default router;
