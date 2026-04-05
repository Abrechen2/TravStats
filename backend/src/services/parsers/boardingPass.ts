import { VisionProvider, ParserConfig, ParserResult } from './types';
import { ParsedBooking } from '../bookingParser';
import logger, { parserFactoryLogger, parserVisionLogger } from '../../utils/logger';
import { shouldLogParserOperations } from '../loggingConfig';
import { checkProviderAvailability, deleteAvailabilityCacheEntry } from './config';
import { getVisionParserInstance } from './providers';

/**
 * Calculate quality score for parsed booking (0-100)
 * Higher score = better quality
 */
export function calculateParserQuality(flights: ParsedBooking[]): number {
  if (flights.length === 0) return 0;

  let totalScore = 0;
  for (const flight of flights) {
    let score = 0;

    // Critical fields (40 points total)
    if (flight.flightNumber) score += 10;
    if (flight.departureCode) score += 10;
    if (flight.arrivalCode) score += 10;
    if (flight.departureTime) score += 10;

    // Important fields (30 points total)
    if (flight.arrivalTime) score += 10;
    if (flight.pnr || flight.bookingReference) score += 10;
    if (flight.seat) score += 5;
    if (flight.gate) score += 5;

    // Optional fields (30 points total)
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
 * Parse boarding pass using Tesseract OCR with manual fallback
 */
export async function parseBoardingPass(
  imageBase64: string,
  config: ParserConfig
): Promise<ParserResult> {
  const errors: Array<{ provider: VisionProvider; error: string }> = [];
  const shouldLog = await shouldLogParserOperations();
  const log = shouldLog ? parserFactoryLogger : logger;
  const visionLog = shouldLog ? parserVisionLogger : logger;
  const startTime = Date.now();

  if (shouldLog) {
    log.info({
      operation: 'parse_boarding_pass_start',
      context: {
        imageSize: imageBase64.length,
        fallbackChain: config.visionFallbacks,
      },
    });
  }

  // Build the provider chain from fallbacks (tesseract → manual)
  const providerChain: VisionProvider[] = config.visionFallbacks;

  // Try each provider in order
  for (const provider of providerChain) {
    try {
      const parser = getVisionParserInstance(provider);

      // Check availability first
      const availability = await checkProviderAvailability(parser);
      if (!availability.available) {
        if (shouldLog) {
          visionLog.debug({
            operation: 'vision_parser_skipped',
            context: { provider, reason: availability.reason },
          });
        } else {
          logger.debug(`[Parser Factory] Skipping unavailable vision parser: ${provider} - ${availability.reason}`);
        }
        errors.push({ provider, error: availability.reason || 'Unavailable' });
        continue;
      }

      // Try parsing
      const parseStartTime = Date.now();
      if (shouldLog) {
        visionLog.info({
          operation: 'vision_parse_attempt',
          context: { provider, imageSize: imageBase64.length },
        });
      } else {
        logger.info(`[Parser Factory] Attempting vision parse with: ${provider}`);
      }

      const flight = await parser.parseImage(imageBase64);
      const parseDuration = Date.now() - parseStartTime;

      const fallbackUsed = config.visionProvider !== provider;

      if (shouldLog) {
        visionLog.info({
          operation: 'vision_parse_success',
          context: {
            provider,
            fallbackUsed,
            parseDuration,
            flightNumber: flight.flightNumber,
            route: `${flight.departureCode} → ${flight.arrivalCode}`,
            missingFields: flight.missing.length,
            quality: calculateParserQuality([flight]),
          },
        });
      } else {
        logger.info(`[Parser Factory] Vision parse successful with: ${provider}${fallbackUsed ? ' (fallback)' : ''}`);
      }

      const totalDuration = Date.now() - startTime;
      if (shouldLog) {
        log.info({
          operation: 'parse_boarding_pass_complete',
          context: {
            provider,
            fallbackUsed,
            totalDuration,
            quality: calculateParserQuality([flight]),
            missingFields: flight.missing.length,
          },
        });
      }

      return {
        flights: [flight],
        provider,
        fallbackUsed,
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      if (shouldLog) {
        visionLog.warn({
          operation: 'vision_parse_failed',
          context: {
            provider,
            error: errorMsg,
            stack: error instanceof Error ? error.stack : undefined,
          },
        });
      } else {
        logger.warn(`[Parser Factory] Vision parser '${provider}' failed: ${errorMsg}`);
      }
      errors.push({ provider, error: errorMsg });

      // Invalidate cache for this provider
      deleteAvailabilityCacheEntry(`${provider}-default`);

      // Continue to next provider
      continue;
    }
  }

  // All providers failed
  const totalDuration = Date.now() - startTime;
  if (shouldLog) {
    log.error({
      operation: 'parse_boarding_pass_failed',
      context: { errors, totalDuration, triedProviders: providerChain },
    });
  } else {
    logger.error({ errors }, '[Parser Factory] All vision parsers failed');
  }
  throw new Error(
    `All vision parsers failed. Errors: ${errors.map(e => `${e.provider}: ${e.error}`).join('; ')}`
  );
}
