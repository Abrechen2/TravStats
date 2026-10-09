import { Router, Response, NextFunction } from "express";

import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { rentalCreationLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import { rentalImportSchema } from "../../schemas/rentalImport";
import { linkDocuments, takeDocumentIds } from "../../services/documents/documentService";
import { withRentalReadFields } from "../../services/rental/rentalDto";
import {
  applyCancellation,
  applyConfirmation,
  applyInvoice,
} from "../../services/rental/rentalImport";
import logger from "../../utils/logger";

/**
 * POST /api/v1/rentals/import — one reviewed rental document applied (spec
 * 2026-10-01-rental-domain-design §4.4, §4.5). The parse routes READ a mail
 * and answer candidates; this WRITES the one the user confirmed. The server
 * decides create vs update by the booking number; a cancellation or an
 * invoice for a booking this account does not hold is refused with
 * `RENTAL_UNKNOWN_BOOKING` and writes nothing.
 *
 * Mounted ahead of the rental router, whose `/:id` would otherwise take
 * "import" for a rental id.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

router.post(
  "/",
  rentalCreationLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.userId) throw new AppError("Not authenticated", 401);
      const userId = req.userId;
      const parsed = rentalImportSchema.safeParse(req.body);
      if (!parsed.success) {
        const field = parsed.error.issues[0]?.path.join(".");
        throw new AppError(parsed.error.message, 400, "RENTAL_INVALID_INPUT", field || undefined);
      }
      const body = parsed.data;
      const sentAt = body.mailSentAt ? new Date(body.mailSentAt) : null;
      const documentIds = await takeDocumentIds(userId, req.body);
      const result =
        body.kind === "confirmation"
          ? await applyConfirmation(userId, body.input, sentAt)
          : body.kind === "cancellation"
            ? await applyCancellation(
                userId,
                body.provider,
                body.confirmationNumber,
                body.fee ?? null,
                sentAt
              )
            : await applyInvoice(
                userId,
                body.invoice,
                body.replaceUserDistance ?? false,
                sentAt,
                body.adopt ?? {}
              );
      // The mail or invoice the row came from is kept with it (§4.5).
      await linkDocuments(userId, documentIds, { type: "rentalBooking", id: result.row.id });
      logger.info({
        operation: "rental_import",
        outcome: result.outcome,
        rentalBookingId: result.row.id,
        userId,
      });
      res.status(result.outcome === "created" ? 201 : 200).json({
        success: true,
        data: withRentalReadFields(result.row),
        meta: { outcome: result.outcome },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
