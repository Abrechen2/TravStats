/**
 * Training Data Routes
 *
 * Upload and annotate files for parser template derivation.
 */

import path from 'path';
import fs from 'fs';
import multer from 'multer';
import crypto from 'crypto';
import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { uploadReceiptLimiter } from '../middleware/rateLimit';
import { AppError } from '../middleware/errorHandler';
import { prisma } from '../db';
import logger from '../utils/logger';
import { deriveTemplateFromAnnotation } from '../services/parsers/userTemplates/deriver';
import { extractEmailFromFile } from '../services/emailExtractor';

const router = Router();
router.use(authenticate);

// Upload directory for training files (emails + boarding pass images)
const TRAINING_UPLOAD_DIR = path.join(__dirname, '../../uploads/training');
if (!fs.existsSync(TRAINING_UPLOAD_DIR)) {
  fs.mkdirSync(TRAINING_UPLOAD_DIR, { recursive: true });
}

const trainingStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TRAINING_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const suffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9-_]/g, '_');
    cb(null, `${suffix}-${base}${ext}`);
  },
});

const trainingUpload = multer({
  storage: trainingStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.eml', '.txt', '.msg', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}`));
    }
  },
});

const annotateSchema = z.object({
  annotations: z.record(z.unknown()),
  extractedData: z.array(z.record(z.unknown())),
  tags: z.array(z.string()).optional(),
});

// POST /api/v1/training/upload
//
// Rate-limited on the shared file-upload bucket: this route writes a 20 MB
// file to the data volume and then reads it straight back into memory, and a
// boarding pass is base64'd into a jsonb column on top — so one request costs
// disk, RAM and DB row size at once. The limiter runs BEFORE multer so a
// refused request never writes its bytes.
router.post(
  '/upload',
  uploadReceiptLimiter,
  trainingUpload.single('file'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const type = req.body.type as string;

      if (!req.file) {
        throw new AppError('No file uploaded', 400);
      }
      if (type !== 'email' && type !== 'boarding_pass') {
        fs.unlinkSync(req.file.path);
        throw new AppError('type must be "email" or "boarding_pass"', 400);
      }

      // Pre-populate annotations with file content so annotation components can render it
      const _fileExt = path.extname(req.file.originalname).toLowerCase();
      let initialAnnotations: Record<string, unknown> = {};
      try {
        if (type === 'email') {
          const buffer = fs.readFileSync(req.file.path);
          const extracted = extractEmailFromFile(buffer, req.file.originalname);
          // Strip NUL bytes — PostgreSQL jsonb rejects them
          const fullText = (extracted.text || extracted.subject || '').replace(/\0/g, '');
          if (fullText) initialAnnotations = { fullText };
        } else if (type === 'boarding_pass') {
          const buffer = fs.readFileSync(req.file.path);
          const mimeType = req.file.mimetype || 'image/jpeg';
          initialAnnotations = { imageBase64: `data:${mimeType};base64,${buffer.toString('base64')}` };
        }
      } catch (readErr) {
        logger.warn({ operation: 'training_upload_read', err: readErr }, 'Could not pre-read file content');
      }

      const record = await prisma.trainingData.create({
        data: {
          userId,
          type,
          originalFile: req.file.path,
          annotations: initialAnnotations as Parameters<typeof prisma.trainingData.create>[0]['data']['annotations'],
          extractedData: [],
          status: 'pending',
          tags: [],
        },
      });

      logger.info({ operation: 'training_upload', id: record.id, type });
      res.json({ id: record.id, type: record.type, status: record.status });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/training/:id
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const record = await prisma.trainingData.findFirst({
      where: { id: req.params.id, userId },
    });

    if (!record) throw new AppError('Training data not found', 404);

    res.json({
      id: record.id,
      type: record.type,
      status: record.status,
      annotations: record.annotations,
      extractedData: record.extractedData,
      tags: record.tags,
      createdAt: record.createdAt.toISOString(),
      filename: path.basename(record.originalFile),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/training/:id/annotate
router.post('/:id/annotate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { annotations, extractedData, tags } = annotateSchema.parse(req.body);

    const record = await prisma.trainingData.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!record) throw new AppError('Training data not found', 404);

    await prisma.trainingData.update({
      where: { id: record.id },
      data: {
        annotations: annotations as Parameters<typeof prisma.trainingData.update>[0]['data']['annotations'],
        extractedData: extractedData as Parameters<typeof prisma.trainingData.update>[0]['data']['extractedData'],
        tags: tags ?? [],
      },
    });

    const templateId = await deriveTemplateFromAnnotation(record.id, userId);

    logger.info({ operation: 'training_annotate', id: record.id, templateId });
    res.json({ success: true, templateId });
  } catch (error) {
    next(error);
  }
});

export default router;
