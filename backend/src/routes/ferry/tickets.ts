import { Router, type Response, type NextFunction } from "express";
import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { lodgingImportLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import { hasUsableText } from "../../services/parsing/usableText";
import { previewFerryText } from "../../services/ferry/ticketPreview";
import { readTicketText, ticketPreviewRequest } from "../../services/rides/ticketText";

export const ferryTicketRequest = ticketPreviewRequest;
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
      const text = await readTicketText(req.userId!, parsed.data, "ferry.ticketPreview.pdf");
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
