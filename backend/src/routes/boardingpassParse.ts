import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import logger from '../utils/logger';
import { getParserConfig, parseBoardingPass, getAvailableProviders } from '../services/parsers/factory';
import { prisma } from '../db';
import { validateBoardingPassImageBase64 } from '../utils/fileValidation';
import { AppError } from '../middleware/errorHandler';

const router = Router();

const parseBoardingpassSchema = z.object({
  imageBase64: z.string().min(1, 'Image data is required'),
  enrichWithApi: z.boolean().optional().default(true),
});

/**
 * POST /api/v1/parse-boardingpass
 * Parse boarding pass image using configured vision parser
 *
 * Body:
 * - imageBase64: string (required) - Base64-encoded image data
 * - enrichWithApi: boolean (optional, default: true) - Whether to enrich with flight lookup API
 *
 * Returns:
 * - flight: ParsedBooking - Extracted flight information
 * - provider: string - Parser provider used (ollama, openai, claude, tesseract, manual)
 * - fallbackUsed: boolean - Whether fallback was used
 * - enriched: boolean - Whether data was enriched with API
 */
router.post('/parse-boardingpass', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { imageBase64, enrichWithApi } = parseBoardingpassSchema.parse(req.body);
    const userId = req.userId!;

    // Validate image using magic numbers
    const validation = validateBoardingPassImageBase64(imageBase64);
    if (!validation.valid) {
      logger.warn({
        operation: 'boardingpass_validation_failed',
        message: 'Boarding pass image validation failed',
        context: {
          userId,
          reason: validation.reason,
        },
      });
      return res.status(400).json({
        error: 'Validation failed',
        message: `Image validation failed: ${validation.reason}`,
      });
    }

    logger.info(`[Boarding Pass Parse] Starting parsing for user ${userId}`);

    // Get user and admin settings for parser configuration (with decrypted API keys)
    const { getUserParserSettings, getAdminParserSettings } = await import('../services/parserSettings');
    const userSettings = await getUserParserSettings(userId);
    const adminSettings = await getAdminParserSettings();

    // Get parser config
    const config = getParserConfig(userSettings || undefined, adminSettings || undefined);

    // Parse boarding pass
    const result = await parseBoardingPass(imageBase64, config);

    logger.info({
      provider: result.provider,
      fallbackUsed: result.fallbackUsed,
      flightNumber: result.flights[0]?.flightNumber,
      route: `${result.flights[0]?.departureCode} → ${result.flights[0]?.arrivalCode}`,
    }, '[Boarding Pass Parse] Parsing complete');

    // Optional: Enrich with Flight Lookup API
    let enriched = false;
    const flight = result.flights[0];

    if (
      enrichWithApi &&
      flight.flightNumber &&
      flight.departureTime &&
      flight.departureCode &&
      flight.arrivalCode
    ) {
      try {
        const { lookupFlightByNumber } = await import('../services/flightLookup');
        const date = new Date(flight.departureTime);
        const flights = await lookupFlightByNumber(flight.flightNumber, date);

        if (flights.length > 0) {
          const apiData = flights[0];

          // Validate that API data matches boarding pass data
          const departureDateMatch = apiData.departure?.iata === flight.departureCode;
          const arrivalDateMatch = apiData.arrival?.iata === flight.arrivalCode;

          if (departureDateMatch && arrivalDateMatch) {
            logger.info('[Boarding Pass Parse] Enriching with API data');

            // Merge data: Vision parser is Source of Truth, API fills gaps
            Object.assign(flight, {
              aircraft: flight.aircraft || apiData.aircraft,
              terminal: flight.terminal || apiData.departure?.terminal,
              gate: flight.gate || apiData.departure?.gate,
              arrivalTime: flight.arrivalTime || apiData.arrival?.scheduledTime,
              airline: flight.airline || apiData.airline,
            });

            enriched = true;
          }
        }
      } catch (apiError) {
        logger.warn({ error: apiError }, '[Boarding Pass Parse] Flight lookup API failed, continuing without enrichment');
      }
    }

    res.json({
      flight,
      provider: result.provider,
      fallbackUsed: result.fallbackUsed,
      enriched,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn({ errors: error.errors }, '[Boarding Pass Parse] Validation error');
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }

    logger.error({ error }, '[Boarding Pass Parse] Parsing failed');

    res.status(500).json({
      error: 'Boarding pass parsing failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/v1/parse-boardingpass/providers
 * Get list of available vision parser providers
 */
router.get('/parse-boardingpass/providers', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;

    // Get user and admin settings (with decrypted API keys)
    const { getUserParserSettings, getAdminParserSettings } = await import('../services/parserSettings');
    const userSettings = await getUserParserSettings(userId);
    const adminSettings = await getAdminParserSettings();

    // Get parser config
    const config = getParserConfig(userSettings || undefined, adminSettings || undefined);

    // Get available providers
    const providers = await getAvailableProviders(config);

    res.json({
      vision: providers.vision,
      text: providers.text,
    });
  } catch (error) {
    logger.error({ error }, '[Boarding Pass Parse] Failed to get providers');
    res.status(500).json({
      error: 'Failed to get providers',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/v1/parse-boardingpass/check
 * Check if current vision parser is available (legacy compatibility)
 */
router.get('/parse-boardingpass/check', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;

    // Get user and admin settings (with decrypted API keys)
    const { getUserParserSettings, getAdminParserSettings } = await import('../services/parserSettings');
    const userSettings = await getUserParserSettings(userId);
    const adminSettings = await getAdminParserSettings();

    const config = getParserConfig(userSettings || undefined, adminSettings || undefined);
    const providers = await getAvailableProviders(config);

    // Find the preferred provider or first available
    const preferred = config.visionProvider;
    const preferredProvider = providers.vision.find((p) => p.provider === preferred);

    res.json({
      available: preferredProvider?.availability.available || false,
      provider: preferred,
      reason: preferredProvider?.availability.reason,
      metadata: preferredProvider?.availability.metadata,
    });
  } catch (error) {
    logger.error({ error }, '[Boarding Pass Parse] Check failed');
    res.json({
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
