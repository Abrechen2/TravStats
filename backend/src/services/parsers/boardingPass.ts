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

function isSuspiciousBoardingPassResult(flight: ParsedBooking): boolean {
  const criticalFields = ['flightNumber', 'departureCode', 'arrivalCode', 'departureTime'];
  const missingCritical = criticalFields.filter((field) => flight.missing.includes(field)).length;

  return missingCritical >= 2 || !flight.flightNumber || flight.missing.length >= 3;
}

/**
 * Parse boarding pass with automatic provider selection and fallback on errors
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
        requestedProvider: config.visionProvider,
        fallbackChain: config.visionFallbacks,
      },
    });
  }

  // Build the provider chain: preferred (if not auto) + fallbacks
  const providerChain: VisionProvider[] =
    config.visionProvider !== 'auto'
      ? [config.visionProvider, ...config.visionFallbacks.filter(p => p !== config.visionProvider)]
      : config.visionFallbacks;

  // Try each provider in order
  for (const provider of providerChain) {
    try {
      const parser = getVisionParserInstance(
        provider,
        provider === 'ollama' ? config.ollamaVisionModel : undefined
      );
      const apiKey = provider === 'openai' ? config.openaiApiKey :
                     provider === 'claude' ? config.claudeApiKey : undefined;

      // Check availability first
      const availability = await checkProviderAvailability(parser, apiKey);
      if (!availability.available) {
        if (shouldLog) {
          visionLog.debug({
            operation: 'vision_parser_skipped',
            context: {
              provider,
              reason: availability.reason,
              availability,
            },
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
          context: {
            provider,
            imageSize: imageBase64.length,
            availability,
          },
        });
      } else {
        logger.info(`[Parser Factory] Attempting vision parse with: ${provider}`);
      }

      const flight = await parser.parseImage(imageBase64, apiKey);
      const parseDuration = Date.now() - parseStartTime;

      const fallbackUsed = config.visionProvider !== 'auto' && config.visionProvider !== provider;

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

      let finalFlight = flight;
      let finalProvider: VisionProvider = provider;
      let finalFallbackUsed = fallbackUsed;

      if (provider !== 'tesseract' && isSuspiciousBoardingPassResult(flight)) {
        if (shouldLog) {
          visionLog.warn({
            operation: 'vision_result_suspicious',
            context: {
              provider,
              missingFields: flight.missing,
              quality: calculateParserQuality([flight]),
            },
          });
        } else {
          logger.warn(
            {
              missingFields: flight.missing,
              provider,
            },
            '[Parser Factory] Suspicious vision result detected, attempting Tesseract fallback'
          );
        }

        try {
          const tesseractParser = getVisionParserInstance('tesseract', undefined);
          const tesseractAvail = await checkProviderAvailability(tesseractParser);

          if (tesseractAvail.available) {
            const tesseractStartTime = Date.now();
            const tesseractFlight = await tesseractParser.parseImage(imageBase64);
            const tesseractDuration = Date.now() - tesseractStartTime;

            if (shouldLog) {
              visionLog.info({
                operation: 'tesseract_fallback_completed',
                context: {
                  originalMissing: flight.missing.length,
                  tesseractMissing: tesseractFlight.missing.length,
                  tesseractDuration,
                  improved: tesseractFlight.missing.length < finalFlight.missing.length,
                },
              });
            } else {
              logger.info(
                {
                  missingFields: tesseractFlight.missing,
                },
                '[Parser Factory] Tesseract fallback completed'
              );
            }

            if (tesseractFlight.missing.length < finalFlight.missing.length) {
              finalFlight = tesseractFlight;
              finalProvider = 'tesseract';
              finalFallbackUsed = true;
            }
          } else {
            if (shouldLog) {
              visionLog.debug({
                operation: 'tesseract_unavailable',
                context: {
                  reason: tesseractAvail.reason,
                },
              });
            } else {
              logger.debug('[Parser Factory] Tesseract unavailable for fallback');
            }
          }
        } catch (fallbackError) {
          if (shouldLog) {
            visionLog.warn({
              operation: 'tesseract_fallback_failed',
              context: {
                error: fallbackError instanceof Error ? fallbackError.message : 'Unknown error',
              },
            });
          } else {
            logger.warn({ fallbackError }, '[Parser Factory] Tesseract fallback failed');
          }
        }
      }

      const totalDuration = Date.now() - startTime;
      if (shouldLog) {
        log.info({
          operation: 'parse_boarding_pass_complete',
          context: {
            provider: finalProvider,
            fallbackUsed: finalFallbackUsed,
            totalDuration,
            quality: calculateParserQuality([finalFlight]),
            missingFields: finalFlight.missing.length,
          },
        });
      }

      return {
        flights: [finalFlight],
        provider: finalProvider,
        fallbackUsed: finalFallbackUsed,
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

      // Invalidate cache for this provider to prevent future attempts in this session
      const cacheKey = `${provider}-${config.openaiApiKey || config.claudeApiKey || 'default'}`;
      deleteAvailabilityCacheEntry(cacheKey);

      // Continue to next provider
      continue;
    }
  }

  // All providers failed
  const totalDuration = Date.now() - startTime;
  if (shouldLog) {
    log.error({
      operation: 'parse_boarding_pass_failed',
      context: {
        errors,
        totalDuration,
        triedProviders: providerChain,
      },
    });
  } else {
    logger.error({ errors }, '[Parser Factory] All vision parsers failed');
  }
  throw new Error(
    `All vision parsers failed. Errors: ${errors.map(e => `${e.provider}: ${e.error}`).join('; ')}`
  );
}
