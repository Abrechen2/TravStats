import { Router, Response, NextFunction } from 'express';
import { authenticate, requireWriteScope, AuthRequest } from '../middleware/auth';
import { uploadReceipt, deleteReceiptFile, getUploadDir } from '../middleware/upload';
import { AppError } from '../middleware/errorHandler';
import { uploadReceiptLimiter } from '../middleware/rateLimit';
import path from 'path';
import fs from 'fs';
import { prisma } from '../db';
import { validateReceiptFile } from '../utils/fileValidation';
import logger from '../utils/logger';

const router = Router();

/**
 * Checks whether `receiptUrl` belongs to the caller through ANY domain that
 * can own a receipt. Currently that's a flight or a lodging stay — cruises
 * carry no `receiptUrl` field (schemas/cruise.ts has no receipt input), so
 * they are intentionally not checked here. Ownership stays strict: the
 * underlying record must have `userId` equal to the caller's id; this never
 * widens to "any authenticated user".
 */
async function findReceiptOwner(
  userId: string,
  receiptUrl: string,
): Promise<{ flightId: string | null; lodgingStayId: string | null }> {
  const [flight, stay] = await Promise.all([
    prisma.flight.findFirst({ where: { userId, receiptUrl }, select: { id: true } }),
    prisma.lodgingStay.findFirst({ where: { userId, receiptUrl }, select: { id: true } }),
  ]);
  return { flightId: flight?.id ?? null, lodgingStayId: stay?.id ?? null };
}

/**
 * POST /api/v1/uploads/receipt
 * Upload a receipt file
 */
router.post(
  '/receipt',
  authenticate,
  requireWriteScope,
  uploadReceiptLimiter,
  uploadReceipt.single('receipt'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    let filePath: string | undefined;
    try {
      if (!req.file) {
        throw new AppError('No file uploaded', 400);
      }

      filePath = req.file.path;

      // Validate file using magic numbers
      const validation = validateReceiptFile(filePath, req.file.mimetype);
      if (!validation.valid) {
        // Delete the uploaded file if validation fails
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        logger.warn({
          operation: 'receipt_upload_validation_failed',
          message: 'Receipt file validation failed',
          context: {
            filename: req.file.originalname,
            mimetype: req.file.mimetype,
            reason: validation.reason,
          },
        });
        throw new AppError(`File validation failed: ${validation.reason}`, 400);
      }

      // Return the URL to access the uploaded file
      const receiptUrl = `/api/v1/uploads/receipts/${req.file.filename}`;

      res.status(201).json({
        success: true,
        receiptUrl,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      });
    } catch (error) {
      // Cleanup on error
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (_cleanupError) {
          logger.error({
            operation: 'receipt_upload_cleanup_error',
            message: 'Failed to cleanup file after validation error',
            context: { filePath },
          });
        }
      }
      next(error);
    }
  }
);

/**
 * GET /api/v1/uploads/receipts/:filename
 * Serve uploaded receipt files
 */
router.get('/receipts/:filename', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { filename } = req.params;
    const userId = req.userId!;

    // Sanitize filename to prevent directory traversal
    const sanitized = path.basename(filename);
    const filePath = path.join(getUploadDir(), sanitized);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new AppError('File not found', 404);
    }

    const receiptUrl = `/api/v1/uploads/receipts/${sanitized}`;

    // Ensure the requesting user owns a flight OR a lodging stay
    // referencing this receipt (finding: lodging receipts 403/404'd because
    // only flights were ever checked).
    const owner = await findReceiptOwner(userId, receiptUrl);
    if (!owner.flightId && !owner.lodgingStayId) {
      throw new AppError('File not found or access denied', 404);
    }

    // Send file (only after ownership check)
    res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/v1/uploads/receipts/:filename
 * Delete a receipt file (authenticated users only)
 */
router.delete(
  '/receipts/:filename',
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { filename } = req.params;
      const userId = req.userId!;

      // Sanitize filename
      const sanitized = path.basename(filename);

      // Verify that the file belongs to the user through a flight OR a
      // lodging stay (finding: lodging receipts could never be deleted
      // because only flights were ever checked).
      const receiptUrl = `/api/v1/uploads/receipts/${sanitized}`;

      const owner = await findReceiptOwner(userId, receiptUrl);
      if (!owner.flightId && !owner.lodgingStayId) {
        throw new AppError('File not found or access denied', 404);
      }

      // Delete file
      deleteReceiptFile(sanitized);

      // Clear the receipt reference on whichever domain record owned it.
      if (owner.flightId) {
        await prisma.flight.update({
          where: { id: owner.flightId },
          data: { receiptUrl: null },
        });
      }
      if (owner.lodgingStayId) {
        await prisma.lodgingStay.update({
          where: { id: owner.lodgingStayId },
          data: { receiptUrl: null },
        });
      }

      res.json({ success: true, message: 'Receipt deleted successfully' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
