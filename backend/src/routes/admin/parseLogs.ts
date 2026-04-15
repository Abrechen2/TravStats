import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { adminExportLimiter } from '../../middleware/rateLimit';
import { getParserFeedbackStats } from '../../services/parserFeedback';

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

interface FeedbackPayload {
  provider?: string;
  sourceType?: string;
  [key: string]: unknown;
}

const daysQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

const feedbackDetailsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

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

// POST /api/v1/admin/parse-logs/promote
// Promotes analytics_events parser_feedback corrections → TrainingData ground-truth labels
router.post('/parse-logs/promote', async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    interface FeedbackPayload {
      sourceType?: string;
      correctedResult?: unknown[];
      originalData?: Record<string, unknown>;
    }

    function isFeedbackPayload(val: unknown): val is FeedbackPayload {
      return typeof val === 'object' && val !== null && 'sourceType' in val;
    }

    const events = await prisma.analyticsEvent.findMany({
      where: { type: 'parser_feedback' },
      select: { id: true, userId: true, payload: true },
      take: 500,
      orderBy: { createdAt: 'asc' },
    });

    // Pre-load existing promoted originalFile keys to avoid duplicates
    const existingOriginalFiles = new Set(
      (await prisma.trainingData.findMany({
        where: { originalFile: { startsWith: 'promoted:' } },
        select: { originalFile: true },
        take: 5000,
      })).map(r => r.originalFile)
    );

    let promoted = 0;

    for (const event of events) {
      if (!isFeedbackPayload(event.payload)) continue;
      if (!event.payload.correctedResult || event.payload.correctedResult.length === 0) continue;

      const originalFile = `promoted:${event.id}`;
      if (existingOriginalFiles.has(originalFile)) continue; // already promoted

      const sourceType = event.payload.sourceType === 'email' ? 'email' : 'boarding_pass';
      const annotations = event.payload.originalData ?? {};

      await prisma.trainingData.create({
        data: {
          userId: event.userId,
          type: sourceType,
          originalFile,
          annotations: annotations as unknown as Prisma.InputJsonValue,
          extractedData: event.payload.correctedResult as unknown as Prisma.InputJsonValue,
          status: 'pending',
          tags: ['auto-promoted'],
        },
      });
      promoted++;
    }

    res.json({ promoted, message: `${promoted} correction(s) promoted to TrainingData` });
  } catch (error) {
    next(error);
  }
});

// Get parser feedback statistics
router.get('/parser-feedback/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const provider = req.query.provider as string | undefined;
    const sourceType = req.query.sourceType as 'email' | 'boardingpass' | undefined;
    const { days } = daysQuerySchema.parse(req.query);

    const stats = await getParserFeedbackStats(provider, sourceType, days);
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Get detailed feedback entries
router.get('/parser-feedback/details', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const provider = req.query.provider as string | undefined;
    const sourceType = req.query.sourceType as 'email' | 'boardingpass' | undefined;
    const { days, limit, offset } = feedbackDetailsQuerySchema.parse(req.query);

    const since = new Date();
    since.setDate(since.getDate() - days);

    const where: Prisma.AnalyticsEventWhereInput = {
      type: 'parser_feedback',
      createdAt: {
        gte: since,
      },
    };

    const events = await prisma.analyticsEvent.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: offset,
      select: {
        id: true,
        userId: true,
        createdAt: true,
        payload: true,
      },
    });

    // Filter by provider and sourceType if provided
    const filtered = events.filter((event) => {
      const payload = event.payload as FeedbackPayload;
      if (provider && payload.provider !== provider) return false;
      if (sourceType && payload.sourceType !== sourceType) return false;
      return true;
    });

    const total = await prisma.analyticsEvent.count({ where });

    res.json({
      feedback: filtered,
      total,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
