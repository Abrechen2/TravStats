import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { parseBookingEmail } from '../services/bookingParser';
import { extractEmailFromFile } from '../services/emailExtractor';
import { uploadEmailFile } from '../middleware/upload';
import { z } from 'zod';
import logger from '../utils/logger';
import { prisma } from '../db';
import fs from 'fs';

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
    const userSettings = await prisma.userSettings.findUnique({
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

/**
 * POST /api/v1/parse-email-file
 * Parse flight booking information from email file (.msg, .eml, .txt)
 *
 * Body: multipart/form-data
 * - email: File (required) - Email file (.msg, .eml, or .txt)
 *
 * Returns:
 * - flights: ParsedBooking[] - Array of extracted flight information
 * - parserUsed: 'ollama' | 'regex' | 'openai' | 'claude' - Which parser was used
 * - subject: string - Extracted email subject
 */
router.post(
  '/parse-email-file',
  authenticate,
  uploadEmailFile.single('email'),
  async (req: AuthRequest, res: Response) => {
    const file = req.file;
    let filePath: string | undefined;

    try {
      if (!file) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Email file is required',
        });
      }

      const userId = req.userId;
      filePath = file.path;

      logger.info({
        filename: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
      }, `[Email Parse File] Parsing email file for user ${userId}`);

      // Extract email content from file
      const fileBuffer = fs.readFileSync(filePath);
      const extracted = extractEmailFromFile(fileBuffer, file.originalname);

      logger.debug({
        subject: extracted.subject,
        textLength: extracted.text.length,
        hasHtml: !!extracted.html,
      }, '[Email Parse File] Email extracted from file');

      // Get user settings for parser configuration
      const userSettings = await prisma.userSettings.findUnique({
        where: { userId },
        select: {
          preferredTextParser: true,
          textFallbackChain: true,
          openaiApiKey: true,
          claudeApiKey: true,
        },
      });

      // Parse email with configured parser
      const result = await parseBookingEmail(
        extracted.subject,
        extracted.text,
        extracted.html,
        userSettings || undefined
      );

      logger.info(
        `[Email Parse File] Parsing complete: ${result.flights.length} flight(s) found using ${result.parserUsed}`
      );

      // Cleanup: Delete temporary file
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.debug({ filePath }, '[Email Parse File] Temporary file deleted');
      }

      res.json({
        ...result,
        subject: extracted.subject,
      });
    } catch (error) {
      // Cleanup: Delete temporary file on error
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (cleanupError) {
          logger.warn({ cleanupError, filePath }, '[Email Parse File] Failed to cleanup temp file');
        }
      }

      logger.error({ error }, '[Email Parse File] Parsing failed');
      res.status(500).json({
        error: 'Email file parsing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

export default router;
