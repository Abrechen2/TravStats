import { Router, type Response, type NextFunction } from "express";
import { type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { lodgingImportLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import { hasUsableText } from "../../services/parsing/usableText";
import { previewBusText } from "../../services/bus/ticketPreview";
import { readTicketText, ticketPreviewRequest } from "../../services/rides/ticketText";

/**
 * `POST /bus/ticket-preview` (forgejo#309) — the ferry preview's twin for a
 * coach ticket: proposals for the form, never a saved ride. Enveloped, like
 * the bus router it is mounted in. Shares the import bucket with the other
 * document readers.
 */
const router = Router();
router.post(
  "/ticket-preview",
  rejectDemo,
  lodgingImportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = ticketPreviewRequest.safeParse(req.body);
      if (!parsed.success) throw new AppError("Invalid ticket input", 400);
      const text = await readTicketText(req.userId!, parsed.data, "bus.ticketPreview.pdf");
      if (!hasUsableText(text)) {
        res.json({
          success: true,
          data: { rides: [], parser: null, reason: "noText", template: null },
        });
        return;
      }
      res.json({ success: true, data: await previewBusText(text, req.userId!) });
    } catch (error) {
      next(error);
    }
  }
);
export default router;
