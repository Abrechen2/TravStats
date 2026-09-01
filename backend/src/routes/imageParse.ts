import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { boardingPassParseLimiter } from '../middleware/rateLimit';
import { validateBoardingPassImageBase64 } from '../utils/fileValidation';
import { getTesseractParser } from '../services/parsers/vision/tesseractParser';
import { parseDocument, REQUESTABLE_DOMAINS } from '../services/parsing/parseDocument';
import { describeParserError } from '../utils/parserErrors';
import { FILE_LIMITS } from '../config/constants';
import logger from '../utils/logger';

const router = Router();

/**
 * The shortest OCR result that could plausibly be a booking confirmation.
 *
 * A blank page, a photograph of a wall or a failed scan all come back as a
 * handful of stray glyphs. Handing those to a parser wastes an LLM round trip
 * and answers with an empty result that looks like "we could not read your
 * document" when the truth is "there was nothing on it". Below this, the route
 * says so instead.
 */
const MIN_USABLE_TEXT_LENGTH = 40;

/**
 * The base64 length that corresponds to the real, decoded byte cap.
 *
 * Base64 inflates by 4/3. The boarding-pass route caps the STRING at 20 MB
 * while `validateBoardingPassImageBase64` caps decoded bytes at 10 MB, so its
 * schema check can never fire — the two disagree and the smaller one always
 * wins. Deriving the string cap from the byte cap keeps them in step, and makes
 * the cheap check the one that runs first: an oversized payload is refused
 * before it is decoded into memory.
 */
const MAX_IMAGE_BASE64_LENGTH = Math.ceil((FILE_LIMITS.BOARDING_PASS_MAX_SIZE * 4) / 3) + 4;

const parseImageSchema = z.object({
  imageBase64: z
    .string()
    .min(1, 'Image data is required')
    .max(MAX_IMAGE_BASE64_LENGTH, 'Image too large'),
  domain: z.enum(REQUESTABLE_DOMAINS).optional().default('auto'),
});

/**
 * POST /api/v1/parse-image — read any travel document from a photograph.
 *
 * Forgejo #58. Until now an image could only ever become a flight: the boarding
 * pass scanner is flight-only by construction, `/parse-boardingpass` answers 501
 * for anything else, and `/parse-pdf` — which does handle all three domains —
 * needs text and refuses a scan. So the loop closed with nothing in it, and the
 * single most photographed travel document there is, a hotel bill, was the one
 * thing the product could not capture from a photograph.
 *
 * The fix is not a new parser. Text parsing already handles lodging and cruise
 * well; the gap was purely the step in front of them, pixels to text. This route
 * is that step and nothing more: OCR, then the same dispatcher `/parse-pdf` and
 * `/parse-email` use, so a photograph, a PDF and a pasted mail are three doors
 * into one behaviour.
 *
 * `domain` defaults to `'auto'` here, unlike the text routes which default to
 * `'flight'` for backwards compatibility. A photograph has no caller history to
 * preserve, and "I do not know what this is" is the honest default for one —
 * that is the whole premise of Forgejo #57.
 */
router.post(
  '/parse-image',
  authenticate,
  // Deliberately the SAME bucket as the boarding-pass scanner rather than a
  // second one of its own: both spend a Tesseract worker per request, and what
  // needs limiting is OCR work per user, not per URL. Two independent buckets
  // would let one user do twice the OCR by alternating routes.
  boardingPassParseLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const parsed = parseImageSchema.parse(req.body);
      const userId = req.userId;

      // The same validation the boarding pass scanner applies: magic-number
      // sniffing, a declared-versus-detected MIME cross-check, and a real
      // decoded-byte cap. Reusing it rather than restating it keeps one answer
      // to "is this an image we accept".
      const validation = validateBoardingPassImageBase64(parsed.imageBase64);
      if (!validation.valid) {
        logger.warn(
          { userId, reason: validation.reason },
          '[Image Parse] Image validation failed',
        );
        return res.status(400).json({
          error: 'Validation failed',
          message: `Image validation failed: ${validation.reason}`,
        });
      }

      const { text, confidence } = await getTesseractParser().recognizeText(parsed.imageBase64);
      // One measure of "how much was read", used for BOTH the gate below and
      // the number reported back. They were the trimmed and untrimmed lengths
      // respectively, so a mostly-blank scan reported a figure far above the
      // one it had actually been judged on.
      const readableLength = text.trim().length;

      if (readableLength < MIN_USABLE_TEXT_LENGTH) {
        logger.info(
          { userId, textLength: readableLength, confidence },
          '[Image Parse] Too little text to parse',
        );
        return res.status(422).json({
          error: 'No readable text',
          message:
            'Almost no text could be read from this image. A sharper, straighter photograph of the whole page usually helps.',
          ocrConfidence: confidence,
        });
      }

      logger.info(
        { userId, chars: text.length, confidence, domain: parsed.domain },
        '[Image Parse] OCR complete, parsing...',
      );

      const outcome = await parseDocument({
        text,
        domain: parsed.domain,
        source: 'document',
        userId,
      });

      logger.info(
        { userId, domain: outcome.domain, domainSource: outcome.domainSource },
        '[Image Parse] Parsing complete',
      );

      res.json({
        ...outcome.body,
        /**
         * Reported, never used as a gate. OCR confidence says how sure the
         * engine is about the GLYPHS, which is a different question from
         * whether the document parsed — a crisp photograph of the wrong page
         * scores high. A client may show it beside a thin result to explain
         * why; branching on it here would reject readable documents.
         */
        ocrConfidence: confidence,
        ocrTextLength: readableLength,
        ...(outcome.domainSource === 'detected'
          ? { domainSource: outcome.domainSource, detection: outcome.detection }
          : {}),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: error.errors });
      }
      logger.error({ error }, '[Image Parse] Parsing failed');
      const described = describeParserError(error);
      res.status(described.status).json({
        error: 'Image parsing failed',
        message: described.message,
      });
    }
  },
);

export default router;
