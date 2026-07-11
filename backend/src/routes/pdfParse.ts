import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { pdfParseLimiter } from '../middleware/rateLimit';
import { z } from 'zod';
import logger from '../utils/logger';
import { extractTextFromPdf, isBcbpText } from '../services/pdfParser';
import { parseBookingText } from '../services/bookingParser';
import { parseCruiseBookingText } from '../services/cruiseBookingParser';
import { resolveCruiseEntities, hydrateResolvedCruises } from '../services/cruiseEntityResolver';
import { parseLodgingBookingText } from '../services/lodging/lodgingBookingParser';
import { bookingsToCandidates } from '../services/lodging/lodgingCandidates';
import { FILE_LIMITS } from '../config/constants';
import { PARSER_SUPPORTED_DOMAINS } from '../shared/domains';
import { describeParserError } from '../utils/parserErrors';

const router = Router();

const parsePdfSchema = z.object({
  pdfBase64: z
    .string()
    .min(1, 'PDF data is required')
    .max(FILE_LIMITS.PDF_MAX_SIZE * 2, 'PDF too large'), // base64 overhead ~1.37x, use 2x for safety
  domain: z.enum(PARSER_SUPPORTED_DOMAINS).optional().default('flight'),
});

/**
 * POST /api/v1/parse-pdf
 * Parse a PDF file (booking confirmation or boarding pass) and extract flight data.
 *
 * Body:
 * - pdfBase64: string (required) — Base64-encoded PDF file content
 *
 * Returns:
 * - flights: ParsedBooking[]
 * - provider: string
 * - pdfTextLength: number
 * - bcbpDetected: boolean
 */
router.post('/parse-pdf', authenticate, pdfParseLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = parsePdfSchema.parse(req.body);
    const { pdfBase64 } = parsed;
    const userId = req.userId;

    const buffer = Buffer.from(pdfBase64, 'base64');

    let pdfText: string;
    try {
      pdfText = await extractTextFromPdf(buffer);
    } catch (err) {
      logger.warn({ userId, err }, '[PDF Parse] Invalid PDF or extraction failed');
      return res.status(400).json({
        error: 'Invalid PDF',
        message: err instanceof Error ? err.message : 'Could not extract text from PDF',
      });
    }

    if (!pdfText.trim()) {
      return res.status(422).json({
        error: 'Empty PDF',
        message:
          'No text could be extracted from this PDF. It may be a scanned image — use the Boarding Pass Scanner instead.',
      });
    }

    logger.info(
      { userId, chars: pdfText.length, domain: parsed.domain },
      '[PDF Parse] Text extracted, parsing...',
    );

    if (parsed.domain === 'cruise') {
      const cruiseResult = await parseCruiseBookingText(pdfText);
      const resolved = await Promise.all(cruiseResult.cruises.map(resolveCruiseEntities));
      const cruises = await hydrateResolvedCruises(resolved, userId);
      return res.json({
        cruises,
        parserUsed: cruiseResult.parserUsed,
        ollamaAvailable: cruiseResult.ollamaAvailable,
        pdfTextLength: pdfText.length,
        domain: 'cruise',
      });
    }

    if (parsed.domain === 'lodging') {
      const lodgingResult = await parseLodgingBookingText(pdfText);
      logger.info(
        { userId, parserUsed: lodgingResult.parserUsed, bookingCount: lodgingResult.bookings.length },
        '[PDF Parse] Lodging parsing complete',
      );
      return res.json({
        domain: 'lodging',
        candidates: bookingsToCandidates(lodgingResult.bookings),
        parserUsed: lodgingResult.parserUsed,
        ollamaAvailable: lodgingResult.ollamaAvailable,
        fallbackReason: lodgingResult.fallbackReason,
        pdfTextLength: pdfText.length,
      });
    }

    const bcbpDetected = isBcbpText(pdfText);
    const result = await parseBookingText(pdfText, userId);

    res.json({
      ...result,
      pdfTextLength: pdfText.length,
      bcbpDetected,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    logger.error({ error }, '[PDF Parse] Unexpected error');
    const described = describeParserError(error);
    res.status(described.status).json({
      error: 'PDF parsing failed',
      message: described.message,
    });
  }
});

export default router;
