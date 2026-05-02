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

    // Ensure the requesting user owns a flight referencing this receipt
    const flight = await prisma.flight.findFirst({
      where: { userId, receiptUrl },
    });

    if (!flight) {
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

      // Verify that the file belongs to the user (check if any of their flights reference it)
      const receiptUrl = `/api/v1/uploads/receipts/${sanitized}`;

      const flight = await prisma.flight.findFirst({
        where: {
          userId,
          receiptUrl,
        },
      });

      if (!flight) {
        throw new AppError('File not found or access denied', 404);
      }

      // Delete file
      deleteReceiptFile(sanitized);

      // Remove receipt URL from flight
      await prisma.flight.update({
        where: { id: flight.id },
        data: { receiptUrl: null },
      });

      res.json({ success: true, message: 'Receipt deleted successfully' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
