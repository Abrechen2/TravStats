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
 * Does this file belong to the caller?
 *
 * Asked of the FILE, not of anything pointing at it. Until 2026-09-09 the
 * answer came from `findReceiptOwner`, which looked for a flight or a stay of
 * the caller's carrying this `receiptUrl` — and a caller writes their own
 * flights. Knowing another account's file URL was therefore enough to obtain
 * it: create a flight referencing it, and the guard agreed (audit finding
 * AUD-019). The reference proved the caller had typed the URL, nothing else.
 *
 * `ReceiptUpload` is written once, at upload time, from the session — no
 * request body reaches it. Existing files were backfilled from whoever
 * referenced them first (see the migration).
 */
async function ownsUpload(userId: string, filename: string): Promise<boolean> {
  const upload = await prisma.receiptUpload.findUnique({
    where: { filename },
    select: { userId: true },
  });
  return upload?.userId === userId;
}

/**
 * Which of the caller's records still points at this receipt.
 *
 * Only used to clear the reference after a delete — never to decide access.
 * Cruises carry no `receiptUrl` (schemas/cruise.ts has no receipt input), so
 * they are intentionally absent.
 */
async function findReceiptReferences(
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

      // Record who owns this file, once, from the session. This row — not any
      // later reference in a request body — is what decides who may read or
      // delete it (audit finding AUD-019).
      await prisma.receiptUpload.create({
        data: { filename: req.file.filename, userId: req.userId! },
      });

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

    // The file's own owner decides, not a reference to it.
    if (!(await ownsUpload(userId, sanitized))) {
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

      if (!(await ownsUpload(userId, sanitized))) {
        throw new AppError('File not found or access denied', 404);
      }

      // References are cleared below; they never granted the right to be here.
      const owner = await findReceiptReferences(userId, receiptUrl);

      // Delete file
      deleteReceiptFile(sanitized);
      await prisma.receiptUpload.deleteMany({ where: { filename: sanitized } });

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
