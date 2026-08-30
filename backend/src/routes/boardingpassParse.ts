import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { boardingPassParseLimiter } from '../middleware/rateLimit';
import { z } from 'zod';
import logger from '../utils/logger';
import { getParserConfig, parseBoardingPass, getAvailableProviders } from '../services/parsers/factory';
import { validateBoardingPassImageBase64 } from '../utils/fileValidation';
import { PARSER_SUPPORTED_DOMAINS } from '../shared/domains';
import { decodeBarcodeFromImageBase64 } from '../utils/barcodeImage';
import { decodeBcbp, looksLikeBcbp } from '../utils/bcbp';
import { getMissingFields } from '../services/parsers/shared/utils';
import { ParsedBooking } from '../services/bookingParser';

const router = Router();

const parseBoardingpassSchema = z.object({
  imageBase64: z.string().min(1, 'Image data is required').max(20 * 1024 * 1024, 'Image too large (max 20MB)'),
  enrichWithApi: z.boolean().optional().default(true),
  domain: z.enum(PARSER_SUPPORTED_DOMAINS).optional().default('flight'),
});

/**
 * POST /api/v1/parse-boardingpass
 *
 * Read a boarding pass image: its barcode first, then OCR of the printed card
 * for the fields no barcode carries. Either half may come back empty; only a
 * pass that yields neither is a 422.
 *
 * Body:
 * - imageBase64: string (required) - Base64-encoded image data
 * - enrichWithApi: boolean (optional, default: true) - Whether to enrich with flight lookup API
 *
 * Returns:
 * - flight: ParsedBooking - Extracted flight information
 * - provider: string - OCR provider used (tesseract, manual), or "barcode" when
 *   OCR contributed nothing
 * - fallbackUsed: boolean - Whether the OCR fallback was used
 * - enriched: boolean - Whether data was enriched with API
 * - sources: { barcode, ocr } - which half produced anything (additive, 2026-08-30)
 */
router.post('/parse-boardingpass', authenticate, boardingPassParseLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = parseBoardingpassSchema.parse(req.body);

    // Defensive guard for future domain expansion (Cruise etc.).
    // Zod already rejects unknown values; this catches the case where the
    // enum is later widened but handler logic hasn't been extended yet.
    if (parsed.domain !== 'flight') {
      return res.status(501).json({
        error: 'PARSER_DOMAIN_NOT_IMPLEMENTED',
        message: `Parsing for domain '${parsed.domain}' is not yet implemented. Add entries manually via the /cruises page.`,
        domain: parsed.domain,
      });
    }

    const { imageBase64, enrichWithApi } = parsed;
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

    // --- 1. The barcode, if the image has one ------------------------------
    //
    // Every boarding pass carries its own flight in a PDF417 stripe or an
    // Aztec square, error-corrected and unambiguous, and OCR of the same card
    // is a guess by comparison. This route used to ignore it and read only the
    // printed text, which is why a Wallet screenshot could come back empty
    // while the answer sat in the middle of the picture.
    //
    // Never fatal: a photo with no readable barcode is the ordinary case this
    // route was built for, and it still gets the full OCR pass below.
    const barcodeStr = await decodeBarcodeFromImageBase64(imageBase64);
    const decoded = looksLikeBcbp(barcodeStr) ? decodeBcbp(barcodeStr) : null;
    if (decoded) {
      logger.info(
        { flightNumber: decoded.flightNumber, route: `${decoded.fromCode} → ${decoded.toCode}` },
        '[Boarding Pass Parse] barcode read from image'
      );
    }

    // --- 2. OCR, for the printed fields no barcode carries -----------------
    // Gate, terminal, boarding group and aircraft are never in a BCBP string,
    // so this runs even when the barcode decoded. It is allowed to fail there:
    // losing the gate must not cost a flight the barcode already spelled out.
    const config = await getParserConfig(undefined, undefined, userId);
    let ocrFlight: ParsedBooking | undefined;
    let provider = 'barcode';
    let fallbackUsed = false;
    try {
      const result = await parseBoardingPass(imageBase64, config);
      ocrFlight = result.flights[0];
      provider = result.provider;
      fallbackUsed = result.fallbackUsed;
    } catch (ocrError) {
      if (!decoded) {
        throw ocrError;
      }
      logger.warn({ err: ocrError }, '[Boarding Pass Parse] OCR failed, continuing with barcode only');
    }

    logger.info({
      provider,
      fallbackUsed,
      barcode: Boolean(decoded),
      flightNumber: ocrFlight?.flightNumber,
      route: `${ocrFlight?.departureCode} → ${ocrFlight?.arrivalCode}`,
    }, '[Boarding Pass Parse] Parsing complete');

    if (!decoded && !ocrFlight) {
      res.status(422).json({ error: 'No flight data could be extracted from the boarding pass' });
      return;
    }

    // --- 3. Merge, barcode winning what it carries -------------------------
    // The date is stamped T00:00 rather than left bare: a BCBP string holds a
    // day of the year and no clock at all, and midnight is the placeholder
    // this codebase already reads as date-only.
    const merged: ParsedBooking = {
      ...(ocrFlight ?? { missing: [] }),
      ...(decoded
        ? {
            flightNumber: decoded.flightNumber ?? ocrFlight?.flightNumber,
            departureCode: decoded.fromCode ?? ocrFlight?.departureCode,
            arrivalCode: decoded.toCode ?? ocrFlight?.arrivalCode,
            departureTime: decoded.date ? `${decoded.date}T00:00` : ocrFlight?.departureTime,
            seat: decoded.seatNumber ?? ocrFlight?.seat,
            pnr: decoded.pnr ?? ocrFlight?.pnr,
            bookingReference: decoded.pnr ?? ocrFlight?.bookingReference,
            airline: ocrFlight?.airline ?? decoded.carrier,
          }
        : {}),
    };
    // Recomputed, not inherited: `missing` came from the OCR pass alone and
    // would still name fields the barcode has since supplied.
    merged.missing = getMissingFields(merged);

    let enriched = false;
    let flight = merged;

    if (
      enrichWithApi &&
      flight.flightNumber &&
      flight.departureTime &&
      flight.departureCode &&
      flight.arrivalCode
    ) {
      try {
        const { lookupFlightWithHistorical } = await import('../services/flightLookup');
        const date = new Date(flight.departureTime);
        const { flights: apiFlights } = await lookupFlightWithHistorical(flight.flightNumber, date);

        if (apiFlights.length > 0) {
          const apiData = apiFlights[0];

          // Validate that API data matches boarding pass data
          const departureDateMatch = apiData.departure?.iata === flight.departureCode;
          const arrivalDateMatch = apiData.arrival?.iata === flight.arrivalCode;

          if (departureDateMatch && arrivalDateMatch) {
            logger.info('[Boarding Pass Parse] Enriching with API data');

            // Merge data immutably: Vision parser is Source of Truth, API fills gaps
            flight = {
              ...flight,
              aircraft: flight.aircraft || apiData.aircraft,
              terminal: flight.terminal || apiData.departure?.terminal,
              gate: flight.gate || apiData.departure?.gate,
              arrivalTime: flight.arrivalTime || apiData.arrival?.scheduledTime,
              airline: flight.airline || apiData.airline,
            };

            enriched = true;
          }
        }
      } catch (apiError) {
        logger.warn({ error: apiError }, '[Boarding Pass Parse] Flight lookup API failed, continuing without enrichment');
      }
    }

    res.json({
      flight,
      provider,
      fallbackUsed,
      enriched,
      // Additive, and the same vocabulary /boardingpass/propose already uses:
      // a caller that wants to know how much to trust the answer can, and one
      // that does not simply ignores the field.
      sources: { barcode: Boolean(decoded), ocr: Boolean(ocrFlight) },
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
    // Get available providers (Tesseract + Regex only)
    const providers = await getAvailableProviders();

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
 * GET /api/v1/parse-boardingpass/availability
 * Get availability status of all vision parser providers
 * Used by frontend to determine parsing strategy
 */
router.get('/parse-boardingpass/availability', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Get available providers
    const providers = await getAvailableProviders();
    const tesseractAvailable = providers.vision.find(p => p.provider === 'tesseract')?.availability.available || false;

    res.json({
      ollama: false,
      openai: false,
      claude: false,
      tesseract: tesseractAvailable,
      providers: {
        tesseract: providers.vision.find(p => p.provider === 'tesseract')?.availability,
      },
    });
  } catch (error) {
    logger.error({ error }, '[Boarding Pass Parse] Failed to get availability');
    res.status(500).json({
      error: 'Failed to get provider availability',
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
    const providers = await getAvailableProviders();
    const tesseractProvider = providers.vision.find((p) => p.provider === 'tesseract');

    res.json({
      available: tesseractProvider?.availability.available || false,
      provider: 'tesseract',
      reason: tesseractProvider?.availability.reason,
      metadata: tesseractProvider?.availability.metadata,
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
