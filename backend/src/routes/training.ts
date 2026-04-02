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
import { triggerTraining, shouldTriggerTraining, cancelTraining, analyzeTrainingData } from '../services/trainingService';
import { ParsedBooking } from '../services/bookingParser';
import { enrichFlightAirports } from '../services/airportLookup';
import { extractEmailFromFile } from '../services/emailExtractor';
import { Prisma } from '@prisma/client';
import { trainingTriggerLimiter } from '../middleware/rateLimit';
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
 * POST /api/v1/training/:id/save-and-train
 * Save annotations and trigger training
 */
router.post(
  '/:id/save-and-train',
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

      // Update training data
      await prisma.trainingData.update({
        where: { id },
        data: {
          annotations: payload.annotations as Prisma.InputJsonValue,
          extractedData: payload.extractedData as unknown as Prisma.InputJsonValue,
          ...(payload.tags !== undefined && { tags: payload.tags }),
        },
      });

      await createFlightsFromGroundTruth(userId, payload.extractedData);

      // Check if we should trigger training
      let trainingJobId: string | null = null;
      if (await shouldTriggerTraining()) {
        try {
          trainingJobId = await triggerTraining(userId);
        } catch (error) {
          logger.warn({
            operation: 'training_trigger_failed',
            message: 'Failed to trigger training automatically',
            context: {
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          });
        }
      }

      logger.info({
        operation: 'training_save_and_train',
        message: 'Training data saved and training triggered',
        context: {
          userId,
          trainingDataId: id,
          trainingJobId,
        },
      });

      res.json({
        message: 'Training data saved',
        trainingJobId,
        willTrain: !!trainingJobId,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/training/:id/train-only
 * Trigger training without saving to DB (for testing)
 */
router.post(
  '/:id/train-only',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
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

      if (!trainingData.annotations || !trainingData.extractedData) {
        throw new AppError('Training data must be annotated first', 400);
      }

      // Trigger training with just this one entry
      const trainingJobId = await triggerTraining(userId);

      logger.info({
        operation: 'training_train_only',
        message: 'Training triggered for single entry',
        context: {
          userId,
          trainingDataId: id,
          trainingJobId,
        },
      });

      res.json({
        message: 'Training triggered',
        trainingJobId,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/training/data
 * Get list of training data (only own entries)
 * Query params: status, type, tags (comma-separated), search
 */
router.get('/data', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { status, type, tags, search } = req.query;

    // Build where clause
    const where: Prisma.TrainingDataWhereInput = { userId };

    if (status && typeof status === 'string') {
      where.status = status;
    }

    if (type && typeof type === 'string') {
      where.type = type;
    }

    if (tags && typeof tags === 'string') {
      const tagArray = tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (tagArray.length > 0) {
        where.tags = {
          hasSome: tagArray, // PostgreSQL array contains any of these tags
        };
      }
    }

    if (search && typeof search === 'string') {
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { originalFile: { contains: search, mode: 'insensitive' } },
      ];
    }

    const trainingData = await prisma.trainingData.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        status: true,
        tags: true,
        createdAt: true,
        trainedAt: true,
        extractedData: true, // Include extractedData for statistics
      },
    });

    // Map to include extractedData count for performance
    const trainingDataWithCount = trainingData.map((data) => {
      // extractedData is stored as JSON and can be an array or object
      const extractedData = data.extractedData as ParsedBooking[] | ParsedBooking | null;
      const extractedDataCount = Array.isArray(extractedData)
        ? extractedData.length
        : extractedData !== null
        ? 1
        : 0;
      return {
        ...data,
        extractedDataCount,
      };
    });

    res.json({ trainingData: trainingDataWithCount });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/training/jobs
 * Get list of training jobs
 */
router.get('/jobs', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const jobs = await prisma.trainingJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        modelName: true,
        startedAt: true,
        completedAt: true,
        errorMessage: true,
        metrics: true,
        createdAt: true,
        trainingDataIds: true,
        _count: {
          select: {
            logs: true,
          },
        },
      },
    });

    res.json({ jobs });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/training/jobs/:id/logs
 * Get detailed logs for a training job
 */
router.get('/jobs/:id/logs', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const job = await prisma.trainingJob.findUnique({
      where: { id },
      include: {
        logs: {
          orderBy: { timestamp: 'asc' },
          take: 1000, // Limit to last 1000 log entries
        },
      },
    });

    if (!job) {
      throw new AppError('Training job not found', 404);
    }

    // Try to read log file if it exists (read in real-time during training)
    let logFileContent: string | null = null;
    if (job.logFile && fs.existsSync(job.logFile)) {
      try {
        // Read the file - it may be growing during training
        logFileContent = fs.readFileSync(job.logFile, 'utf-8');
      } catch (fileError) {
        logger.warn({
          operation: 'read_log_file_error',
          message: 'Failed to read log file',
          context: {
            trainingJobId: id,
            logFile: job.logFile,
            error: fileError instanceof Error ? fileError.message : 'Unknown error',
          },
        });
      }
    } else if (job.status === 'running' || job.status === 'pending') {
      // If job is running but log file doesn't exist yet, it might be starting
      // Try to find log file by pattern
      const logFilePattern = path.join(__dirname, '../../data/logs/training', `training-${id}.log`);
      if (fs.existsSync(logFilePattern)) {
        try {
          logFileContent = fs.readFileSync(logFilePattern, 'utf-8');
        } catch (fileError) {
          // Ignore errors, file might be locked or not readable yet
        }
      }
    }

    res.json({
      job: {
        id: job.id,
        status: job.status,
        modelName: job.modelName,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        errorMessage: job.errorMessage,
        metrics: job.metrics,
        logFile: job.logFile,
      },
      logs: job.logs,
      logFileContent,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/training/:id
 * Get single training data entry with annotations
 * Must be after /jobs/:id/logs to avoid route conflicts
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

/**
 * DELETE /api/v1/training/:id
 * Delete training data entry
 */
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
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

    // Delete the file if it exists
    if (trainingData.originalFile && fs.existsSync(trainingData.originalFile)) {
      try {
        fs.unlinkSync(trainingData.originalFile);
      } catch (fileError) {
        logger.warn({
          operation: 'training_delete_file_error',
          message: 'Failed to delete training data file',
          context: {
            trainingDataId: id,
            filePath: trainingData.originalFile,
            error: fileError instanceof Error ? fileError.message : 'Unknown error',
          },
        });
      }
    }

    await prisma.trainingData.delete({
      where: { id },
    });

    logger.info({
      operation: 'training_delete',
      message: 'Training data deleted',
      context: {
        userId,
        trainingDataId: id,
      },
    });

    res.json({
      message: 'Training data deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/training/data/analysis
 * Analyze training data quality before training
 * Query params: type (email|boarding_pass), ids (comma-separated IDs)
 */
router.get('/data/analysis', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { type, ids } = req.query;

    // Validate optional type filter
    const typeFilter: 'email' | 'boarding_pass' | undefined =
      type === 'email' || type === 'boarding_pass' ? type : undefined;

    let trainingDataIds: string[];

    if (ids && typeof ids === 'string') {
      // Use explicitly provided IDs
      trainingDataIds = ids.split(',').map((id) => id.trim()).filter(Boolean);
      if (trainingDataIds.length === 0) {
        throw new AppError('No valid IDs provided in "ids" query parameter', 400);
      }
    } else {
      // Fall back to all pending training data for this user
      const pendingData = await prisma.trainingData.findMany({
        where: {
          userId,
          status: 'pending',
          ...(typeFilter ? { type: typeFilter } : {}),
        },
        select: { id: true },
      });

      trainingDataIds = pendingData.map((d) => d.id);

      if (trainingDataIds.length === 0) {
        throw new AppError('No pending training data found for analysis', 404);
      }
    }

    const analysis = await analyzeTrainingData(trainingDataIds, typeFilter);

    logger.info({
      operation: 'training_data_analysis',
      message: 'Training data analysis requested',
      context: {
        userId,
        trainingDataIds,
        typeFilter,
        qualityScore: analysis.qualityScore,
      },
    });

    res.json({ analysis });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/training/trigger
 * Manually trigger training
 */
router.post('/trigger', trainingTriggerLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const trainingJobId = await triggerTraining(userId);

    logger.info({
      operation: 'training_trigger_manual',
      message: 'Training triggered manually',
      context: {
        userId: req.userId,
        trainingJobId,
      },
    });

    res.json({
      message: 'Training triggered',
      trainingJobId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/training/jobs/:id/cancel
 * Cancel a running training job
 */
router.post('/jobs/:id/cancel', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    await cancelTraining(id);

    logger.info({
      operation: 'training_cancel',
      message: 'Training cancelled',
      context: {
        userId: req.userId,
        trainingJobId: id,
      },
    });

    res.json({
      message: 'Training cancelled successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
