import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
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
router.post('/parse-email', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { emailContent, subject } = parseEmailSchema.parse(req.body);
    const userId = req.userId;

    logger.info(`[Email Parse] Parsing email for user ${userId}`);

    // Get user settings for parser configuration
    const db = (await import('../db')).default;
    const userSettings = await db.userSettings.findUnique({
      where: { userId },
      select: {
        preferredTextParser: true,
        textFallbackChain: true,
        openaiApiKey: true,
        claudeApiKey: true,
      },
    });

    const result = await parseBookingEmail(
      subject,
      emailContent,
      undefined,
      userSettings || undefined
    );

    logger.info(`[Email Parse] Parsing complete: ${result.flights.length} flight(s) found using ${result.parserUsed}`);

    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn({ errors: error.errors }, '[Email Parse] Validation error');
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }

    logger.error({ error }, '[Email Parse] Parsing failed');
    res.status(500).json({
      error: 'Email parsing failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
