import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { parseWithOllamaVision, checkOllamaVisionAvailability } from '../services/ollamaVisionParser';
import { lookupFlightByNumber } from '../services/flightLookup';
import { z } from 'zod';
import logger from '../utils/logger';
import { ParsedBooking } from '../services/bookingParser';

const router = Router();

const parseBoardingpassSchema = z.object({
  imageBase64: z.string().min(1, 'Image data is required'),
  enrichWithApi: z.boolean().optional().default(true),
});

/**
 * POST /api/v1/parse-boardingpass
 * Parse boarding pass image using Ollama Vision
 *
 * Body:
 * - imageBase64: string (required) - Base64-encoded image data
 * - enrichWithApi: boolean (optional, default: true) - Whether to enrich with flight lookup API
 *
 * Returns:
 * - flight: ParsedBooking - Extracted flight information
 * - source: 'ollama' - Parser source
 * - enriched: boolean - Whether data was enriched with API
 */
router.post('/parse-boardingpass', authenticate, async (req: Request, res: Response) => {
  try {
    const { imageBase64, enrichWithApi } = parseBoardingpassSchema.parse(req.body);

    logger.info(`Parsing boarding pass for user ${(req as any).user?.id}`);

    // Check if Ollama Vision is available
    const isAvailable = await checkOllamaVisionAvailability();
    if (!isAvailable) {
      return res.status(503).json({
        error: 'Ollama Vision service unavailable',
        message: 'Please ensure Ollama is running with a vision model (e.g., llava)',
        hint: 'Install with: ollama pull llava',
      });
    }

    // Parse boarding pass with Ollama Vision
    const ollamaResult = await parseWithOllamaVision(imageBase64);

    logger.info({
      flightNumber: ollamaResult.flightNumber,
      route: `${ollamaResult.departureCode} → ${ollamaResult.arrivalCode}`,
      missing: ollamaResult.missing,
    }, 'Ollama Vision parsing complete');

    let enriched = false;
    let finalResult: ParsedBooking = { ...ollamaResult };

    // Optional: Enrich with Flight Lookup API
    if (
      enrichWithApi &&
      ollamaResult.flightNumber &&
      ollamaResult.departureTime
    ) {
      try {
        const date = new Date(ollamaResult.departureTime);
        const flights = await lookupFlightByNumber(ollamaResult.flightNumber, date);

        if (flights.length > 0) {
          const apiData = flights[0];

          // Validate that API data matches boarding pass data
          const departureDateMatch =
            apiData.departure?.iata === ollamaResult.departureCode;
          const arrivalDateMatch =
            apiData.arrival?.iata === ollamaResult.arrivalCode;

          if (departureDateMatch && arrivalDateMatch) {
            logger.info('Enriching Ollama data with API data');

            // Merge data: Ollama is Source of Truth, API fills gaps
            // This means Ollama values take precedence
            finalResult = {
              // Start with API data (lower priority)
              aircraft: apiData.aircraft || ollamaResult.aircraft,
              terminal: apiData.departure?.terminal || ollamaResult.terminal,
              gate: apiData.departure?.gate || ollamaResult.gate,
              arrivalTime: apiData.arrival?.scheduledTime || ollamaResult.arrivalTime,
              departureTime: apiData.departure?.scheduledTime || ollamaResult.departureTime,
              airline: apiData.airline || ollamaResult.airline,

              // Ollama data overrides (Source of Truth)
              ...ollamaResult,

              // Preserve non-conflicting API data only if Ollama didn't provide it
              ...(ollamaResult.aircraft ? {} : { aircraft: apiData.aircraft }),
              ...(ollamaResult.terminal ? {} : { terminal: apiData.departure?.terminal }),
              ...(ollamaResult.gate ? {} : { gate: apiData.departure?.gate }),
              ...(ollamaResult.arrivalTime ? {} : { arrivalTime: apiData.arrival?.scheduledTime }),
            };

            enriched = true;

            logger.info('Enrichment complete - Ollama values preserved as Source of Truth');
          } else {
            logger.warn('API data does not match boarding pass airports - skipping enrichment');
          }
        }
      } catch (apiError) {
        // API enrichment is optional - don't fail if it errors
        logger.warn({ error: apiError }, 'Flight lookup API failed, continuing with Ollama data only');
      }
    }

    res.json({
      flight: finalResult,
      source: 'ollama',
      enriched,
      ollamaAvailable: true,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn({ errors: error.errors }, 'Boarding pass parsing validation error');
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }

    logger.error({ error }, 'Boarding pass parsing failed');

    if (error instanceof Error && error.message.includes('Ollama')) {
      return res.status(503).json({
        error: 'Boarding pass parsing failed',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'Boarding pass parsing failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/v1/parse-boardingpass/check
 * Check if Ollama Vision service is available
 */
router.get('/check', authenticate, async (req: Request, res: Response) => {
  try {
    const isAvailable = await checkOllamaVisionAvailability();

    res.json({
      available: isAvailable,
      service: 'Ollama Vision',
      model: process.env.OLLAMA_VISION_MODEL || 'llava:latest',
    });
  } catch (error) {
    logger.error({ error }, 'Ollama Vision check failed');
    res.json({
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
