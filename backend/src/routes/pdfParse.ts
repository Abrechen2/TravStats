import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../middleware/auth";
import { pdfParseLimiter } from "../middleware/rateLimit";
import { z } from "zod";
import logger from "../utils/logger";
import { extractTextFromPdf, isBcbpText } from "../services/pdfParser";
import { parseDocument, REQUESTABLE_DOMAINS } from "../services/parsing/parseDocument";
import { FILE_LIMITS } from "../config/constants";
import { describeParserError } from "../utils/parserErrors";
import {
  assertRetainable,
  parseRetentionFields,
  readDocumentForParse,
  recordParse,
  sendAppError,
} from "../services/documents/parseRetention";

const router = Router();

const parsePdfBodySchema = z.object({
  pdfBase64: z
    .string()
    .min(1, "PDF data is required")
    .max(FILE_LIMITS.PDF_MAX_SIZE * 2, "PDF too large") // base64 overhead ~1.37x, use 2x for safety
    .optional(),
  // 'auto' asks the server to decide what the document is — see Forgejo #57.
  // The default stays 'flight' so no existing caller changes behaviour.
  domain: z.enum(REQUESTABLE_DOMAINS).optional().default("flight"),
  // Keep the PDF, or parse one already kept (forgejo#116).
  ...parseRetentionFields,
});

const parsePdfSchema = parsePdfBodySchema.refine((b) => !b.pdfBase64 !== !b.documentId, {
  message: "Send pdfBase64 or documentId, exactly one of them",
});

/**
 * POST /api/v1/parse-pdf
 * Parse a PDF booking confirmation or boarding pass.
 *
 * Body:
 * - pdfBase64: string (required) — Base64-encoded PDF file content
 * - domain: 'flight' | 'cruise' | 'lodging' | 'auto' (default 'flight')
 * - retain: boolean (optional) — keep the PDF as a document; answers `documentId`
 * - documentId: string (optional) — parse a PDF already kept, instead of pdfBase64
 *
 * Returns the domain-shaped body plus `pdfTextLength`. When `domain: 'auto'`
 * was asked for, the answer additionally carries `domainSource: 'detected'` and
 * a `detection` block naming the runners-up, so a client that disagrees can
 * re-ask explicitly instead of sending the document three times.
 */
router.post(
  "/parse-pdf",
  authenticate,
  pdfParseLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const parsed = parsePdfSchema.parse(req.body);
      const userId = req.userId!;

      const buffer = parsed.documentId
        ? (await readDocumentForParse(userId, parsed.documentId, ["pdf"])).buffer
        : Buffer.from(parsed.pdfBase64!, "base64");
      const retainInput = { buffer, declaredFormat: "pdf" as const };
      if (parsed.retain && !parsed.documentId) assertRetainable(retainInput);

      let pdfText: string;
      try {
        pdfText = await extractTextFromPdf(buffer);
      } catch (err) {
        logger.warn({ userId, err }, "[PDF Parse] Invalid PDF or extraction failed");
        return res.status(400).json({
          error: "Invalid PDF",
          message: err instanceof Error ? err.message : "Could not extract text from PDF",
        });
      }

      if (!pdfText.trim()) {
        return res.status(422).json({
          error: "Empty PDF",
          message:
            "No text could be extracted from this PDF. It may be a scanned image — send the page to /parse-image, which reads any travel document, or use the Boarding Pass Scanner.",
        });
      }

      logger.info(
        { userId, chars: pdfText.length, domain: parsed.domain },
        "[PDF Parse] Text extracted, parsing..."
      );

      const outcome = await parseDocument({
        text: pdfText,
        domain: parsed.domain,
        source: "document",
        userId,
      });

      logger.info(
        { userId, domain: outcome.domain, domainSource: outcome.domainSource },
        "[PDF Parse] Parsing complete"
      );

      const documentId = await recordParse({
        userId,
        documentId: parsed.documentId,
        retain: parsed.retain,
        input: retainInput,
        parsedDomain: outcome.domain,
        parsedPayload: outcome.body,
      });

      res.json({
        ...outcome.body,
        ...(documentId ? { documentId } : {}),
        // Only for a flight: it describes a barcode, and a cruise or hotel
        // confirmation never carries one. Reporting `false` on those would
        // suggest the question had been asked of them.
        ...(outcome.domain === "flight" ? { bcbpDetected: isBcbpText(pdfText) } : {}),
        pdfTextLength: pdfText.length,
        // Present only when the server decided, so an explicit request keeps
        // exactly the response shape it had before.
        ...(outcome.domainSource === "detected"
          ? { domainSource: outcome.domainSource, detection: outcome.detection }
          : {}),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.issues });
      }
      if (sendAppError(res, error)) return;
      logger.error({ error }, "[PDF Parse] Unexpected error");
      const described = describeParserError(error);
      res.status(described.status).json({
        error: "PDF parsing failed",
        message: described.message,
      });
    }
  }
);

export default router;
