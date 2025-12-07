import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import { collectCorrectionFeedback } from '../services/parserFeedback';
import logger from '../utils/logger';

const router = Router();

const correctionSchema = z.object({
  sourceType: z.enum(['email', 'boardingpass']),
  provider: z.string(),
  originalResult: z.array(z.any()),
  correctedResult: z.array(z.any()),
  originalData: z.object({
    subject: z.string().optional(),
    text: z.string().optional(),
    html: z.string().optional(),
  }).optional(),
});

/**
 * POST /api/v1/parser-feedback/correction
 * Submit user correction for parser result
 */
router.post('/correction', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const correction = correctionSchema.parse(req.body);

    await collectCorrectionFeedback(
      userId,
      correction.sourceType,
      correction.provider,
      correction.originalResult,
      correction.correctedResult,
      correction.originalData
    );

    logger.info(
      {
        userId,
        provider: correction.provider,
        sourceType: correction.sourceType,
      },
      '[Parser Feedback] User correction submitted'
    );

    res.json({ success: true, message: 'Correction feedback submitted successfully' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn({ errors: error.errors }, '[Parser Feedback] Validation error');
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }

    logger.error({ error }, '[Parser Feedback] Failed to submit correction');
    res.status(500).json({
      error: 'Failed to submit correction',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;

