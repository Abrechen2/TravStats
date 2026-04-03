import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireTrainingAccess } from '../middleware/trainingAuth';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { enrichFlightAirports } from '../services/airportLookup';
import { extractEmailFromFile } from '../services/emailExtractor';
import { Prisma } from '@prisma/client';
import { deriveTemplateFromAnnotation } from '../services/parsers/userTemplates/deriver';

const router = Router();

/**
 * Attempt to create real flights from training ground truth data.
 * Skips entries that lack minimum required data (airport codes + times).
 * Silently skips duplicates and enrichment failures — never blocks the save.
 */
async function createFlightsFromGroundTruth(userId: string, extractedData: unknown): Promise<number> {
  if (!Array.isArray(extractedData)) return 0;

  let created = 0;
  for (const entry of extractedData) {
    const b = entry as Record<string, unknown>;
    const depCode = b.departureCode as string | undefined;
    const arrCode = b.arrivalCode as string | undefined;
    const depTimeStr = b.departureTime as string | undefined;
    const arrTimeStr = b.arrivalTime as string | undefined;

    if (!depCode || !arrCode || !depTimeStr || !arrTimeStr) continue;

    let depTime: Date;
    let arrTime: Date;
    try {
      depTime = new Date(depTimeStr);
      arrTime = new Date(arrTimeStr);
      if (isNaN(depTime.getTime()) || isNaN(arrTime.getTime())) continue;
    } catch {
      continue;
    }

    try {
      const enriched = await enrichFlightAirports(
        { departure: { iata: depCode }, arrival: { iata: arrCode } }
      );

      const depLat = enriched.departure.lat;
      const depLon = enriched.departure.lon;
      const arrLat = enriched.arrival.lat;
      const arrLon = enriched.arrival.lon;
      if (depLat == null || depLon == null || arrLat == null || arrLon == null) continue;

      // Duplicate check: same user + same route + same departure day
      const dayStart = new Date(depTime);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(depTime);
      dayEnd.setUTCHours(23, 59, 59, 999);

      const existing = await prisma.flight.findFirst({
        where: { userId, depIata: depCode, arrIata: arrCode, departureTime: { gte: dayStart, lte: dayEnd } },
        select: { id: true },
      });
      if (existing) continue;

      const flightNumber = b.flightNumber as string | undefined;
      await prisma.flight.create({
        data: {
          userId,
          flightNumber: flightNumber ?? null,
          airline: (b.airline as string | undefined) ?? (flightNumber ? flightNumber.slice(0, 2) : null),
          depIata: enriched.departure.iata ?? depCode,
          depIcao: enriched.departure.icao ?? null,
          depName: enriched.departure.name ?? null,
          depLat,
          depLon,
          arrIata: enriched.arrival.iata ?? arrCode,
          arrIcao: enriched.arrival.icao ?? null,
          arrName: enriched.arrival.name ?? null,
          arrLat,
          arrLon,
          departureTime: depTime,
          arrivalTime: arrTime,
          bookingReference: (b.pnr as string | undefined) ?? (b.bookingReference as string | undefined) ?? null,
          seatNumber: (b.seat as string | undefined) ?? null,
          gate: (b.gate as string | undefined) ?? null,
          terminal: (b.terminal as string | undefined) ?? null,
          status: 'flown',
          dataSource: 'email_import',
          lastModifiedBy: 'user',
        },
      });
      created++;
    } catch (err) {
      logger.warn({ err, depCode, arrCode }, '[Training] Failed to create flight from ground truth, skipping');
    }
  }

  return created;
}

// All routes require authentication and training access
router.use(authenticate);
router.use(requireTrainingAccess);

// Configure multer for file uploads
const uploadDir = path.join(__dirname, '../../uploads/training');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `training-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

// Upload schema
const uploadSchema = z.object({
  type: z.enum(['email', 'boarding_pass']),
  tags: z.array(z.string()).optional().default([]), // Optional tags array
});

// Annotation schema
const textSelectionSchema = z.object({
  text: z.string(),
  label: z.string(),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
});

const textSelectionsSchema = z.array(textSelectionSchema).optional();

const annotationSchema = z.object({
  annotations: z.record(z.unknown()), // JSON object with text selections or bounding boxes
  extractedData: z.array(z.record(z.unknown())), // Array of ParsedBooking
  tags: z.array(z.string()).optional(), // Optional tags array
});

/**
 * POST /api/v1/training/upload
 * Upload email or boarding pass file for training
 */
router.post(
  '/upload',
  upload.single('file'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const file = req.file;
      if (!file) {
        throw new AppError('File is required', 400);
      }

      const body = uploadSchema.parse(req.body);
      const userId = req.userId!;

      // For emails, extract content
      let annotations: Prisma.InputJsonObject = {};
      if (body.type === 'email') {
        const fileBuffer = fs.readFileSync(file.path);
        const extracted = extractEmailFromFile(fileBuffer, file.originalname);
        annotations = {
          type: 'email',
          fullText: extracted.text || extracted.html || '',
          textSelections: [],
        };
      } else {
        // For boarding passes, we'll need to convert image to base64
        const imageBuffer = fs.readFileSync(file.path);
        const imageBase64 = imageBuffer.toString('base64');
        annotations = {
          type: 'boarding_pass',
          imageBase64: `data:${file.mimetype};base64,${imageBase64}`,
          boundingBoxes: [],
        };
      }

      const trainingData = await prisma.trainingData.create({
        data: {
          userId,
          type: body.type,
          originalFile: file.path,
          annotations: annotations as Prisma.InputJsonValue,
          extractedData: [],
          status: 'pending',
          tags: body.tags || [],
        },
      });

      logger.info({
        operation: 'training_upload',
        message: 'Training data uploaded',
        context: {
          userId,
          trainingDataId: trainingData.id,
          type: body.type,
        },
      });

      res.json({
        id: trainingData.id,
        type: trainingData.type,
        status: trainingData.status,
        createdAt: trainingData.createdAt,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/training/:id/annotate
 * Save annotations for training data
 */
router.post(
  '/:id/annotate',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.userId!;
      const payload = annotationSchema.parse(req.body);

      const trainingData = await prisma.trainingData.findUnique({
        where: { id },
      });

      if (!trainingData) {
        throw new AppError('Training data not found', 404);
      }

      if (trainingData.userId !== userId) {
        throw new AppError('Unauthorized', 403);
      }

      const updated = await prisma.trainingData.update({
        where: { id },
        data: {
          annotations: payload.annotations as Prisma.InputJsonValue,
          extractedData: payload.extractedData as unknown as Prisma.InputJsonValue,
          ...(payload.tags !== undefined && { tags: payload.tags }),
        },
      });

      const flightsCreated = await createFlightsFromGroundTruth(userId, payload.extractedData);

      // Derive parser template from annotation (non-blocking; errors are logged but not fatal)
      let templateId: string | undefined;
      const rawSelections = (payload.annotations as Record<string, unknown>).textSelections;
      const textSelections = textSelectionsSchema.safeParse(rawSelections ?? []);
      if (textSelections.success && textSelections.data && textSelections.data.length > 0) {
        try {
          templateId = await deriveTemplateFromAnnotation(id, userId);
        } catch (err: unknown) {
          logger.warn({ err, trainingDataId: id }, "TemplateDeriver failed — non-critical");
        }
      }

      logger.info({
        operation: 'training_annotate',
        message: 'Training data annotated',
        context: { userId, trainingDataId: id, flightsCreated },
      });

      res.json({
        id: updated.id,
        status: updated.status,
        annotations: updated.annotations,
        extractedData: updated.extractedData,
        flightsCreated,
        templateId,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/training/:id
 * Get single training data entry with annotations
 */
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;

    const trainingData = await prisma.trainingData.findUnique({
      where: { id },
    });

    if (!trainingData) {
      throw new AppError('Training data not found', 404);
    }

    if (trainingData.userId !== userId) {
      throw new AppError('Unauthorized', 403);
    }

    res.json(trainingData);
  } catch (error) {
    next(error);
  }
});

export default router;
