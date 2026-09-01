import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { emailParseLimiter } from '../middleware/rateLimit';
import { parseDocument, REQUESTABLE_DOMAINS } from '../services/parsing/parseDocument';
import { extractEmailFromFile } from '../services/emailExtractor';
import { uploadEmailFile, getEmailUploadDir } from '../middleware/upload';
import { z } from 'zod';
import logger from '../utils/logger';
import fs from 'fs';
import path from 'path';
import { validateEmailFile } from '../utils/fileValidation';
import { describeParserError } from '../utils/parserErrors';

import { parseEmailSchema } from '../schemas/parseEmail';

const router = Router();

/**
 * POST /api/v1/parse-email
 * Parse a booking confirmation from email content
 *
 * Body:
 * - emailContent: string (required) - Email body text or HTML
 * - subject: string (optional) - Email subject line
 * - domain: 'flight' | 'cruise' | 'lodging' | 'auto' (default 'flight')
 * - referenceDate: string (optional) - when the mail was SENT, so a year-less
 *   date in the body is read against that rather than against today (#285)
 *
 * Returns the domain-shaped body plus `text` and `subject`. When `domain: 'auto'`
 * was asked for, the answer additionally carries `domainSource: 'detected'` and a
 * `detection` block naming the runners-up, so a client that disagrees can re-ask
 * explicitly instead of sending the mail three times.
 */
router.post('/parse-email', authenticate, emailParseLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = parseEmailSchema.parse(req.body);

    const emailContent = parsed.emailContent;
    const subject = parsed.subject;
    const userId = req.userId;

    logger.info({ userId, domain: parsed.domain }, '[Email Parse] Parsing email');

    // The caller's anchor for year-less dates. Absent is not "today" written
    // out — it is no opinion at all, and the parser's own default takes over
    // (#285). Only a Date ever leaves here, never a string.
    const referenceDate = parsed.referenceDate ? new Date(parsed.referenceDate) : undefined;

    const outcome = await parseDocument({
      text: emailContent,
      // An empty subject is no subject: it must not become a blank first line
      // in the text the parsers score, and the flight parser treats the two
      // differently. This mirrors the `subject || undefined` the flight branch
      // used to do here.
      subject: subject || undefined,
      domain: parsed.domain,
      // Never 'document' on this route: the email entry point reads the subject
      // and the HTML part, and a header is what dates a mail whose body carries
      // a year-less date (#285).
      source: 'email',
      userId,
      ...(referenceDate ? { referenceDate } : {}),
    });

    const body = outcome.body;

    logger.info(
      { userId, domain: outcome.domain, domainSource: outcome.domainSource },
      '[Email Parse] Parsing complete',
    );

    res.json({
      ...body,
      text: emailContent,
      subject: subject ?? undefined,
      // Only a flight carries one — a cruise or hotel confirmation has no
      // airline to say anything about.
      ...(body.domain === 'flight'
        ? { airlineNotice: body.flights[0]?.airlineNotice ?? null }
        : {}),
      // Present only when the server decided, so an explicit request keeps
      // exactly the response shape it had before.
      ...(outcome.domainSource === 'detected'
        ? { domainSource: outcome.domainSource, detection: outcome.detection }
        : {}),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn({ errors: error.errors }, '[Email Parse] Validation error');
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }

    logger.error({ error }, '[Email Parse] Parsing failed');
    const described = describeParserError(error);
    res.status(described.status).json({
      error: 'Email parsing failed',
      message: described.message,
    });
  }
});

/**
 * POST /api/v1/parse-email-file
 * Parse a booking confirmation from an email file (.msg, .eml, .txt)
 *
 * Body: multipart/form-data
 * - email: File (required) - Email file (.msg, .eml, or .txt)
 * - domain: 'flight' | 'cruise' | 'lodging' | 'auto' (default 'flight')
 *
 * Returns the domain-shaped body plus `subject`, `text` and `html`. As on
 * /parse-email, `domainSource` and `detection` appear only when the server
 * decided the domain itself.
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

      // Domain discriminator (optional, defaults to 'flight').
      // Multipart form-data: rawDomain comes as string from form field.
      const rawDomain = typeof req.body?.domain === 'string' ? req.body.domain : 'flight';
      const domainSchema = z.enum(REQUESTABLE_DOMAINS).optional().default('flight');
      const domainParse = domainSchema.safeParse(rawDomain);
      if (!domainParse.success) {
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        return res.status(400).json({
          error: 'Validation failed',
          details: domainParse.error.errors,
        });
      }
      const domainValue = domainParse.data;

      const userId = req.userId;
      // Rebuild from the trusted upload dir + basename of multer's generated
      // filename, never the raw file.path. multer already generates the
      // filename server-side, so this is defense-in-depth and it clears the
      // CodeQL js/path-injection taint on the fs.unlinkSync cleanups below.
      filePath = path.join(getEmailUploadDir(), path.basename(file.filename));

      // Validate file using magic numbers
      const ext = path.extname(file.originalname).toLowerCase();
      const validation = validateEmailFile(filePath, file.mimetype, ext);
      if (!validation.valid) {
        // Delete the uploaded file if validation fails
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        logger.warn({
          operation: 'email_upload_validation_failed',
          message: 'Email file validation failed',
          context: {
            filename: file.originalname,
            mimetype: file.mimetype,
            extension: ext,
            reason: validation.reason,
          },
        });
        return res.status(400).json({
          error: 'Validation failed',
          message: `File validation failed: ${validation.reason}`,
        });
      }

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
        domain: domainValue,
      }, '[Email Parse File] Email extracted from file');

      // The message's own send date anchors any year-less date in the body. An
      // uploaded mailbox is mostly OLD mail, so reading "16.07." against today
      // is wrong far more often than it is right: a 2007 Germanwings
      // confirmation imported as two 2026 flights and built a trip in the wrong
      // decade, with nothing on screen to suggest it (Forgejo #18).
      //
      // A file whose header is unreadable simply carries no anchor, and the
      // parser falls back to its previous behaviour rather than refusing the
      // import.
      const outcome = await parseDocument({
        text: extracted.text,
        subject: extracted.subject,
        html: extracted.html,
        domain: domainValue,
        // See /parse-email above: the flight path must take the email entry
        // point so subject and HTML are read (#285).
        source: 'email',
        userId,
        ...(extracted.sentAt ? { referenceDate: extracted.sentAt } : {}),
      });

      const body = outcome.body;

      logger.info(
        { userId, domain: outcome.domain, domainSource: outcome.domainSource },
        '[Email Parse File] Parsing complete',
      );

      // Cleanup: Delete temporary file. Before the response, so the upload is
      // gone by the time the caller is told the parse succeeded — the catch
      // block below covers every failing path.
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.debug({ filePath }, '[Email Parse File] Temporary file deleted');
      }

      res.json({
        ...body,
        subject: extracted.subject,
        text: extracted.text,
        html: extracted.html ?? undefined,
        // Flight-only, for the same reason as on /parse-email.
        ...(body.domain === 'flight'
          ? { airlineNotice: body.flights[0]?.airlineNotice ?? null }
          : {}),
        // Present only when the server decided the domain.
        ...(outcome.domainSource === 'detected'
          ? { domainSource: outcome.domainSource, detection: outcome.detection }
          : {}),
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
      const described = describeParserError(error);
      res.status(described.status).json({
        error: 'Email file parsing failed',
        message: described.message,
      });
    }
  }
);

export default router;
