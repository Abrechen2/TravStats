import { prisma } from "../db";
import logger from "../utils/logger";

interface ParseTrainingRecord {
  userId: string; // Stored for debugging/rate-limits, stripped during export (Phase 4)
  airline?: string;
  templateUsed?: string;
  templateHit: boolean;
  confidence?: number;
  fieldCount: number;
  missingFields: string[];
  parserProvider: string;
}

export async function recordParseResult(record: ParseTrainingRecord): Promise<void> {
  try {
    await prisma.parseTrainingLog.create({
      data: {
        userId: record.userId,
        airline: record.airline ?? null,
        templateUsed: record.templateUsed ?? null,
        templateHit: record.templateHit,
        confidence: record.confidence ?? null,
        fieldCount: record.fieldCount,
        missingFields: record.missingFields,
        parserProvider: record.parserProvider,
      },
    });
  } catch (err) {
    // Non-blocking — training recording should never break the main flow
    logger.warn({ err }, "Failed to record parse training data");
  }
}

export function buildAirlineNotice(detectedAirline: string | null): string | undefined {
  if (detectedAirline) return undefined;
  return "Für diese Airline wurde kein Template gefunden. Hilf der Community und trage eines bei: https://github.com/travstats-community/airline-templates";
}
