import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { uploadReceipt, deleteReceiptFile, getUploadDir } from '../middleware/upload';
import { AppError } from '../middleware/errorHandler';
import path from 'path';
import fs from 'fs';

const router = Router();

/**
 * POST /api/v1/uploads/receipt
 * Upload a receipt file
 */
router.post(
  '/receipt',
  authenticate,
  uploadReceipt.single('receipt'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        throw new AppError('No file uploaded', 400);
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
      next(error);
    }
  }
);

/**
 * GET /api/v1/uploads/receipts/:filename
 * Serve uploaded receipt files
 */
router.get('/receipts/:filename', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { filename } = req.params;

    // Sanitize filename to prevent directory traversal
    const sanitized = path.basename(filename);
    const filePath = path.join(getUploadDir(), sanitized);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new AppError('File not found', 404);
    }

    // Send file
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
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { filename } = req.params;
      const userId = req.userId!;

      // Sanitize filename
      const sanitized = path.basename(filename);

      // Verify that the file belongs to the user (check if any of their flights reference it)
      const { prisma } = require('../db');
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
