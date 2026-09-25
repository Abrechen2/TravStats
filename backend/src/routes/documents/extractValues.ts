import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { authenticate, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { emailParseLimiter, pdfParseLimiter } from "../../middleware/rateLimit";
import { extractValuesBodySchema } from "../../schemas/document";
import { getOwnDocument } from "../../services/documents/documentService";
import { extractDocumentValues } from "../../services/documents/extractValues";
import { describeParserError } from "../../utils/parserErrors";

/**
 * `POST /documents/:id/extract-values` — the parser run on a kept document,
 * answering price, currency and booking reference (plus seat and class for a
 * flight) as a proposal. See `services/documents/extractValues.ts`.
 *
 * Own file on the `/api/v1` prefix the documents router uses, mounted before
 * it. A POST because it spends parser time and records the reading on the
 * document — the same effect `POST /parse-pdf` with a `documentId` has.
 */
const router = Router();

export const extractValuesParamsSchema = z.object({ id: z.string().uuid() });

/**
 * The parse routes' own budgets, chosen by what the document IS: a PDF spends
 * the PDF allowance and a mail the mail allowance, so this door into the same
 * parser cannot be used to go around either of them.
 */
async function limitByFormat(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = extractValuesParamsSchema.safeParse(req.params);
    if (!params.success) throw new AppError("Invalid document id", 400);
    const document = await getOwnDocument(req.userId!, params.data.id);
    const limiter = document.format === "pdf" ? pdfParseLimiter : emailParseLimiter;
    await limiter(req, res, next);
  } catch (err) {
    next(err);
  }
}

router.post(
  "/documents/:id/extract-values",
  authenticate,
  limitByFormat,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = extractValuesParamsSchema.parse(req.params);
      const body = extractValuesBodySchema.safeParse(req.body ?? {});
      if (!body.success) throw new AppError(body.error.message, 400);
      const data = await extractDocumentValues(req.userId!, params.id, body.data);
      res.json({ success: true, data });
    } catch (err) {
      // A parser failure answers as the parse routes answer it: a 503 for an
      // unreachable model says "try later", where a bare 500 says "broken".
      if (err instanceof AppError) return next(err);
      const described = describeParserError(err);
      next(new AppError(described.message, described.status));
    }
  }
);

export default router;
