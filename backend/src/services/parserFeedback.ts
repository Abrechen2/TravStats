import { prisma } from '../db';
import logger from '../utils/logger';
import { ParsedBooking } from './bookingParser';

export interface ParserFeedback {
  userId?: string;
  sourceType: 'email' | 'boardingpass';
  provider: string;
  originalData: {
    subject?: string;
    text?: string;
    html?: string;
    imageBase64?: string; // Only hash, not full image
  };
  parsedResult: ParsedBooking[];
  correctedResult?: ParsedBooking[];
  qualityScore: number;
  issues: string[];
  userCorrections?: {
    field: string;
    original: any;
    corrected: any;
  }[];
}

/**
 * Collect parser feedback for quality improvement
 * Stores feedback in analytics_events for analysis
 */
export async function collectParserFeedback(feedback: ParserFeedback): Promise<void> {
  try {
    // Don't store full image data, only hash for reference
    const sanitizedData = {
      ...feedback.originalData,
      imageBase64: feedback.originalData.imageBase64
        ? `hash:${hashString(feedback.originalData.imageBase64.substring(0, 100))}`
        : undefined,
    };

    const payload = {
      sourceType: feedback.sourceType,
      provider: feedback.provider,
      originalData: sanitizedData,
      parsedResult: feedback.parsedResult,
      correctedResult: feedback.correctedResult,
      qualityScore: feedback.qualityScore,
      issues: feedback.issues,
      userCorrections: feedback.userCorrections,
      timestamp: new Date().toISOString(),
    };

    // Store in analytics_events if userId provided
    if (feedback.userId) {
      await prisma.analyticsEvent.create({
        data: {
          userId: feedback.userId,
          type: 'parser_feedback',
          payload: payload as any,
        },
      });
    } else {
      // Log anonymously if no user
      logger.info(
        {
          type: 'parser_feedback',
          payload,
        },
        '[Parser Feedback] Anonymous feedback collected'
      );
    }

    logger.debug(
      {
        provider: feedback.provider,
        qualityScore: feedback.qualityScore,
        issues: feedback.issues.length,
      },
      '[Parser Feedback] Feedback collected'
    );
  } catch (error) {
    logger.error(
      { error },
      '[Parser Feedback] Failed to collect feedback'
    );
    // Don't throw - feedback collection should not break parsing
  }
}

/**
 * Collect feedback when parser result is corrected by user
 */
export async function collectCorrectionFeedback(
  userId: string,
  sourceType: 'email' | 'boardingpass',
  provider: string,
  originalResult: ParsedBooking[],
  correctedResult: ParsedBooking[],
  originalData?: {
    subject?: string;
    text?: string;
    html?: string;
  }
): Promise<void> {
  const issues: string[] = [];
  const userCorrections: Array<{ field: string; original: any; corrected: any }> = [];

  // Compare original and corrected results
  for (let i = 0; i < Math.max(originalResult.length, correctedResult.length); i++) {
    const original = originalResult[i];
    const corrected = correctedResult[i];

    if (!original && corrected) {
      issues.push(`Missing flight ${i + 1} in original result`);
      continue;
    }
    if (original && !corrected) {
      issues.push(`Extra flight ${i + 1} in original result`);
      continue;
    }
    if (!original || !corrected) continue;

    // Compare fields
    const fieldsToCheck: Array<keyof ParsedBooking> = [
      'flightNumber',
      'departureCode',
      'arrivalCode',
      'departureTime',
      'arrivalTime',
      'pnr',
      'seat',
      'gate',
      'terminal',
      'airline',
    ];

    for (const field of fieldsToCheck) {
      const orig = original[field];
      const corr = corrected[field];

      if (orig !== corr) {
        issues.push(`Flight ${i + 1}: ${field} mismatch (${orig} → ${corr})`);
        userCorrections.push({
          field: `flight_${i}_${field}`,
          original: orig,
          corrected: corr,
        });
      }
    }
  }

  const qualityScore = calculateQualityScore(correctedResult);

  await collectParserFeedback({
    userId,
    sourceType,
    provider,
    originalData: originalData || {},
    parsedResult: originalResult,
    correctedResult,
    qualityScore,
    issues,
    userCorrections,
  });
}

/**
 * Collect feedback for low-quality parser results
 */
export async function collectLowQualityFeedback(
  userId: string | undefined,
  sourceType: 'email' | 'boardingpass',
  provider: string,
  result: ParsedBooking[],
  originalData?: {
    subject?: string;
    text?: string;
    html?: string;
    imageBase64?: string;
  }
): Promise<void> {
  const qualityScore = calculateQualityScore(result);
  const issues: string[] = [];

  // Identify issues
  for (const flight of result) {
    if (!flight.flightNumber) issues.push('Missing flightNumber');
    if (!flight.departureCode) issues.push('Missing departureCode');
    if (!flight.arrivalCode) issues.push('Missing arrivalCode');
    if (!flight.departureTime) issues.push('Missing departureTime');
    if (flight.missing.length > 3) {
      issues.push(`Many missing fields: ${flight.missing.join(', ')}`);
    }
  }

  // Only collect if quality is low
  if (qualityScore < 50) {
    await collectParserFeedback({
      userId,
      sourceType,
      provider,
      originalData: originalData || {},
      parsedResult: result,
      qualityScore,
      issues,
    });
  }
}

/**
 * Calculate quality score for parsed results
 */
function calculateQualityScore(flights: ParsedBooking[]): number {
  if (flights.length === 0) return 0;

  let totalScore = 0;
  for (const flight of flights) {
    let score = 0;
    const maxScore = 100;

    // Critical fields (40 points)
    if (flight.flightNumber) score += 10;
    if (flight.departureCode) score += 10;
    if (flight.arrivalCode) score += 10;
    if (flight.departureTime) score += 10;

    // Important fields (30 points)
    if (flight.arrivalTime) score += 10;
    if (flight.pnr || flight.bookingReference) score += 10;
    if (flight.seat) score += 5;
    if (flight.gate) score += 5;

    // Optional fields (30 points)
    if (flight.airline) score += 5;
    if (flight.terminal) score += 5;
    if (flight.seatClass) score += 5;
    if (flight.aircraft) score += 5;
    if (flight.price) score += 5;
    if (flight.ticketNumber) score += 5;

    // Penalty for missing critical fields
    const criticalMissing = ['flightNumber', 'departureCode', 'arrivalCode', 'departureTime']
      .filter(f => flight.missing.includes(f)).length;
    score -= criticalMissing * 10;

    totalScore += Math.max(0, Math.min(100, score));
  }

  return Math.round(totalScore / flights.length);
}

/**
 * Simple string hash for anonymization
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Get parser feedback statistics (admin only)
 */
export async function getParserFeedbackStats(
  provider?: string,
  sourceType?: 'email' | 'boardingpass',
  days: number = 30
): Promise<{
  total: number;
  byProvider: Record<string, number>;
  bySourceType: Record<string, number>;
  avgQualityScore: number;
  commonIssues: Array<{ issue: string; count: number }>;
}> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const events = await prisma.analyticsEvent.findMany({
    where: {
      type: 'parser_feedback',
      createdAt: {
        gte: since,
      },
    },
  });

  const filtered = events.filter((e) => {
    const payload = e.payload as any;
    if (provider && payload.provider !== provider) return false;
    if (sourceType && payload.sourceType !== sourceType) return false;
    return true;
  });

  const byProvider: Record<string, number> = {};
  const bySourceType: Record<string, number> = {};
  let totalQuality = 0;
  const issueCounts: Record<string, number> = {};

  for (const event of filtered) {
    const payload = event.payload as any;
    
    byProvider[payload.provider] = (byProvider[payload.provider] || 0) + 1;
    bySourceType[payload.sourceType] = (bySourceType[payload.sourceType] || 0) + 1;
    totalQuality += payload.qualityScore || 0;

    if (payload.issues && Array.isArray(payload.issues)) {
      for (const issue of payload.issues) {
        issueCounts[issue] = (issueCounts[issue] || 0) + 1;
      }
    }
  }

  const commonIssues = Object.entries(issueCounts)
    .map(([issue, count]) => ({ issue, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    total: filtered.length,
    byProvider,
    bySourceType,
    avgQualityScore: filtered.length > 0 ? Math.round(totalQuality / filtered.length) : 0,
    commonIssues,
  };
}





















