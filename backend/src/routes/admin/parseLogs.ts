import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { adminExportLimiter } from '../../middleware/rateLimit';

interface AirlineStat {
  airline: string;
  total: number;
  hits: number;
  hitRate: number;
  commonMissingFields: string[];
}

interface ParseLogStatsResponse {
  totalLogs: number;
  overallHitRate: number;
  byAirline: AirlineStat[];
}


const router = Router();

// GET /api/v1/admin/parse-logs/stats — aggregate parse log stats per airline
router.get('/parse-logs/stats', async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const logs = await prisma.parseTrainingLog.findMany({
      select: { airline: true, templateHit: true, missingFields: true },
      take: 10000, // safety cap for large deployments
      orderBy: { createdAt: 'desc' },
    });
    const totalLogs = logs.length;

    const airlineMap = new Map<string, { total: number; hits: number; missingCounts: Map<string, number> }>();

    for (const log of logs) {
      const key = log.airline ?? 'Unknown';
      if (!airlineMap.has(key)) {
        airlineMap.set(key, { total: 0, hits: 0, missingCounts: new Map() });
      }
      const entry = airlineMap.get(key)!;
      entry.total++;
      if (log.templateHit) entry.hits++;
      for (const field of log.missingFields) {
        entry.missingCounts.set(field, (entry.missingCounts.get(field) ?? 0) + 1);
      }
    }

    const overallHits = logs.filter(l => l.templateHit).length;
    const overallHitRate = totalLogs > 0 ? Math.round((overallHits / totalLogs) * 100) : 0;

    const byAirline: AirlineStat[] = [...airlineMap.entries()].map(([airline, stats]) => {
      const commonMissingFields = [...stats.missingCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([field]) => field);
      return {
        airline,
        total: stats.total,
        hits: stats.hits,
        hitRate: stats.total > 0 ? Math.round((stats.hits / stats.total) * 100) : 0,
        commonMissingFields,
      };
    }).sort((a, b) => b.total - a.total);

    const response: ParseLogStatsResponse = { totalLogs, overallHitRate, byAirline };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/admin/parse-logs/export — download anonymized ParseTrainingLog as JSONL
router.get('/parse-logs/export', adminExportLimiter, async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ROW_LIMIT = 50000;
    const logs = await prisma.parseTrainingLog.findMany({
      orderBy: { createdAt: 'asc' },
      take: ROW_LIMIT,
      select: {
        id: true,
        airline: true,
        templateUsed: true,
        templateHit: true,
        confidence: true,
        fieldCount: true,
        missingFields: true,
        parserProvider: true,
        createdAt: true,
        // userId intentionally omitted — anonymized export
      },
    });

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('X-Row-Limit', String(ROW_LIMIT));
    res.setHeader('Content-Disposition', 'attachment; filename="parse-training-logs.jsonl"');

    for (const log of logs) {
      res.write(JSON.stringify(log) + '\n');
    }
    res.end();
  } catch (error) {
    next(error);
  }
});

export default router;
