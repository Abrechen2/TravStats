import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { parseBookingEmail } from '../services/bookingParser';
import { z } from 'zod';
import logger from '../utils/logger';

const router = Router();

const parseEmailSchema = z.object({
  emailContent: z.string().min(1, 'Email content is required'),
  subject: z.string().optional(),
});

/**
 * POST /api/v1/parse-email
 * Parse flight booking information from email content
 *
 * Body:
 * - emailContent: string (required) - Email body text or HTML
 * - subject: string (optional) - Email subject line
 *
 * Returns:
 * - flights: ParsedBooking[] - Array of extracted flight information
 * - parserUsed: 'ollama' | 'regex' - Which parser was used
 * - ollamaAvailable: boolean - Whether Ollama was available
 */
router.post('/parse-email', authenticate, async (req: Request, res: Response) => {
  try {
    const { emailContent, subject } = parseEmailSchema.parse(req.body);

    logger.info(`Parsing email for user ${(req as any).user?.id}`);

    const result = await parseBookingEmail(emailContent, subject);

    logger.info(`Email parsing complete: ${result.flights.length} flight(s) found using ${result.parserUsed}`);

    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn({ errors: error.errors }, 'Email parsing validation error');
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }

    logger.error({ error }, 'Email parsing failed');
    res.status(500).json({
      error: 'Email parsing failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
