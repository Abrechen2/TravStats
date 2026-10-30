import { Router, Response, NextFunction } from "express";
import { AuthRequest } from "../../middleware/auth";
import { prisma } from "../../db";
import { adminExportLimiter } from "../../middleware/rateLimit";

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

const MISSING_FIELDS_SAMPLE = 10000;

// GET /api/v1/admin/parse-logs/stats — aggregate parse log stats per airline
router.get(
  "/parse-logs/stats",
  async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Exact totals come from the database; only the common-missing-fields
      // list reads rows (an array column cannot be grouped), and it reads the
      // newest MISSING_FIELDS_SAMPLE rows that have any.
      const [groups, missingRows] = await Promise.all([
        prisma.parseTrainingLog.groupBy({
          by: ["airline", "templateHit"],
          _count: { _all: true },
        }),
        prisma.parseTrainingLog.findMany({
          where: { NOT: { missingFields: { isEmpty: true } } },
          select: { airline: true, missingFields: true },
          take: MISSING_FIELDS_SAMPLE,
          orderBy: { createdAt: "desc" },
        }),
      ]);

      const airlineMap = new Map<
        string,
        { total: number; hits: number; missingCounts: Map<string, number> }
      >();
      const entryFor = (airline: string | null) => {
        const key = airline ?? "Unknown";
        if (!airlineMap.has(key)) {
          airlineMap.set(key, { total: 0, hits: 0, missingCounts: new Map() });
        }
        return airlineMap.get(key)!;
      };

      let totalLogs = 0;
      let overallHits = 0;
      for (const g of groups) {
        const entry = entryFor(g.airline);
        entry.total += g._count._all;
        totalLogs += g._count._all;
        if (g.templateHit) {
          entry.hits += g._count._all;
          overallHits += g._count._all;
        }
      }
      for (const log of missingRows) {
        const entry = entryFor(log.airline);
        for (const field of log.missingFields) {
          entry.missingCounts.set(field, (entry.missingCounts.get(field) ?? 0) + 1);
        }
      }

      const overallHitRate = totalLogs > 0 ? Math.round((overallHits / totalLogs) * 100) : 0;

      const byAirline: AirlineStat[] = [...airlineMap.entries()]
        .map(([airline, stats]) => {
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
        })
        .sort((a, b) => b.total - a.total);

      const response: ParseLogStatsResponse = { totalLogs, overallHitRate, byAirline };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/admin/parse-logs/export — download anonymized ParseTrainingLog as JSONL
router.get(
  "/parse-logs/export",
  adminExportLimiter,
  async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ROW_LIMIT = 50000;
      const logs = await prisma.parseTrainingLog.findMany({
        // Newest first: a cut export keeps the rows a template author needs,
        // and `X-Truncated` says the older ones are missing.
        orderBy: { createdAt: "desc" },
        take: ROW_LIMIT + 1,
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

      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("X-Row-Limit", String(ROW_LIMIT));
      res.setHeader("X-Truncated", String(logs.length > ROW_LIMIT));
      res.setHeader("Content-Disposition", 'attachment; filename="parse-training-logs.jsonl"');

      for (const log of logs.slice(0, ROW_LIMIT)) {
        res.write(JSON.stringify(log) + "\n");
      }
      res.end();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
