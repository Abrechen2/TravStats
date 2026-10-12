import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { lodgingImportLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import { readDocumentForParse } from "../../services/documents/parseRetention";
import { extractTextFromPdf } from "../../services/pdfParser";
import { extractEmailFromFile } from "../../services/emailExtractor";
import { hasUsableText } from "../../services/parsing/usableText";
import { previewFerryText } from "../../services/ferry/ticketPreview";
export const ferryTicketRequest = z.union([
  z.object({ documentId: z.string().uuid() }).strict(),
  z.object({ text: z.string().trim().min(1).max(60000) }).strict(),
]);
const router = Router();
router.post(
  "/ticket-preview",
  authenticate,
  requireWriteScope,
  rejectDemo,
  lodgingImportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = ferryTicketRequest.safeParse(req.body);
      if (!parsed.success) throw new AppError("Invalid ticket input", 400);
      let text: string;
      if ("documentId" in parsed.data) {
        const { document, buffer } = await readDocumentForParse(
          req.userId!,
          parsed.data.documentId,
          ["pdf", "eml", "emailText"]
        );
        if (document.format === "pdf") {
          try {
            text = await extractTextFromPdf(buffer);
          } catch {
            text = "";
          }
        } else if (document.format === "eml")
          text = extractEmailFromFile(buffer, "ticket.eml").text;
        else text = buffer.toString("utf8");
      } else text = parsed.data.text;
      if (!hasUsableText(text)) {
        res.json({
          success: true,
          data: { crossings: [], parser: null, reason: "noText", provider: null },
        });
        return;
      }
      res.json({ success: true, data: await previewFerryText(text, req.userId!) });
    } catch (error) {
      next(error);
    }
  }
);
export default router;
