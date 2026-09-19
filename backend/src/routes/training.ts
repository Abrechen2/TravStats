/**
 * Training Data Routes
 *
 * Upload and annotate files for parser template derivation.
 */

import path from "path";
import fs from "fs";
import multer from "multer";
import crypto from "crypto";
import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { uploadReceiptLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import { prisma } from "../db";
import logger from "../utils/logger";
import { deriveTemplateFromAnnotation } from "../services/parsers/userTemplates/deriver";
import { extractEmailFromFile } from "../services/emailExtractor";
import { scoreDocument } from "../services/parsing/documentDomain";
import {
  WORKSHOP_DOMAINS,
  isWorkshopDomain,
  type WorkshopDomain,
} from "../shared/annotationLabels";

const router = Router();
router.use(authenticate);
// A read-scoped token may read. It may not upload training material, annotate
// it, or change a suggested journey's state (audit finding AUD-012).
// `requireWriteScope` lets GET/HEAD/OPTIONS through untouched, so this covers
// every mutating route here without listing them.
router.use(requireWriteScope);

// Upload directory for training files (emails + boarding pass images)
const TRAINING_UPLOAD_DIR = path.join(__dirname, "../../uploads/training");
if (!fs.existsSync(TRAINING_UPLOAD_DIR)) {
  fs.mkdirSync(TRAINING_UPLOAD_DIR, { recursive: true });
}

/**
 * Test-only accessor, mirroring the `getXxxUploadDir()` getters
 * `middleware/upload.ts` exports for its own disk directories — kept here
 * instead of moved there because this router owns its storage config rather
 * than sharing that module. Used by `demoGuard.uploads.test.ts` (Wave C
 * finding C2, Codex review 2026-09-17) to prove the guard refuses a request
 * before a single byte reaches this directory.
 */
export function getTrainingUploadDir(): string {
  return TRAINING_UPLOAD_DIR;
}

const trainingStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TRAINING_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const suffix = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9-_]/g, "_");
    cb(null, `${suffix}-${base}${ext}`);
  },
});

const trainingUpload = multer({
  storage: trainingStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      ".eml",
      ".txt",
      ".msg",
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".bmp",
      ".webp",
      ".pdf",
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}`));
    }
  },
});

const annotateSchema = z.object({
  annotations: z.record(z.string(), z.unknown()),
  extractedData: z.array(z.record(z.string(), z.unknown())),
  tags: z.array(z.string()).optional(),
  /**
   * The user's answer to "what kind of document is this?", which overrides the
   * classifier's. It is offered as a correction and not asked as a question:
   * `scoreDocument` is right often enough that asking first would be a modal
   * in front of every upload, and wrong often enough that the answer must be
   * changeable — forgejo#124 phase 6, forgejo#57 for the classifier itself.
   */
  domain: z.enum(WORKSHOP_DOMAINS).optional(),
});

/**
 * What kind of document did the user just upload?
 *
 * A boarding pass is a flight by construction — there is no other kind — so
 * only mail text is scored. The classifier never refuses (see its header), so
 * this always has an answer; being wrong is cheap because the annotation step
 * shows it and lets the user change it.
 */
function classifyUpload(type: string, fullText: string): WorkshopDomain {
  if (type !== "email" || fullText.length === 0) return "flight";
  const detected = scoreDocument(fullText).domain;
  return isWorkshopDomain(detected) ? detected : "flight";
}

// POST /api/v1/training/upload
//
// Rate-limited on the shared file-upload bucket: this route writes a 20 MB
// file to the data volume and then reads it straight back into memory, and a
// boarding pass is base64'd into a jsonb column on top — so one request costs
// disk, RAM and DB row size at once. The limiter runs BEFORE multer so a
// refused request never writes its bytes.
router.post(
  "/upload",
  // The shared demo account uploads nothing (finding I2): a file it writes
  // is shown to the next visitor, outlives the nightly reseed and fills the
  // data volume. ABOVE multer, so a refused request writes no bytes.
  rejectDemo,
  uploadReceiptLimiter,
  trainingUpload.single("file"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const type = req.body.type as string;

      if (!req.file) {
        throw new AppError("No file uploaded", 400);
      }
      if (type !== "email" && type !== "boarding_pass") {
        fs.unlinkSync(req.file.path);
        throw new AppError('type must be "email" or "boarding_pass"', 400);
      }

      // Pre-populate annotations with file content so annotation components can render it
      const _fileExt = path.extname(req.file.originalname).toLowerCase();
      let initialAnnotations: Record<string, unknown> = {};
      try {
        if (type === "email") {
          const buffer = fs.readFileSync(req.file.path);
          const extracted = extractEmailFromFile(buffer, req.file.originalname);
          // Strip NUL bytes — PostgreSQL jsonb rejects them
          const fullText = (extracted.text || extracted.subject || "").replace(/\0/g, "");
          if (fullText) initialAnnotations = { fullText };
        } else if (type === "boarding_pass") {
          const buffer = fs.readFileSync(req.file.path);
          const mimeType = req.file.mimetype || "image/jpeg";
          initialAnnotations = {
            imageBase64: `data:${mimeType};base64,${buffer.toString("base64")}`,
          };
        }
      } catch (readErr) {
        logger.warn(
          { operation: "training_upload_read", err: readErr },
          "Could not pre-read file content"
        );
      }

      const fullTextForDomain =
        typeof initialAnnotations.fullText === "string" ? initialAnnotations.fullText : "";
      const domain = classifyUpload(type, fullTextForDomain);

      const record = await prisma.trainingData.create({
        data: {
          userId,
          type,
          domain,
          originalFile: req.file.path,
          annotations: initialAnnotations as Parameters<
            typeof prisma.trainingData.create
          >[0]["data"]["annotations"],
          extractedData: [],
          status: "pending",
          tags: [],
        },
      });

      logger.info({ operation: "training_upload", id: record.id, type });
      res.json({
        id: record.id,
        type: record.type,
        status: record.status,
        domain: record.domain,
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/training/:id
router.get("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const record = await prisma.trainingData.findFirst({
      where: { id: req.params.id, userId },
    });

    if (!record) throw new AppError("Training data not found", 404);

    res.json({
      id: record.id,
      type: record.type,
      // What the workshop will derive a template FOR. The annotation UI reads
      // it to pick its label set, and offers the user the correction.
      domain: record.domain,
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
router.post("/:id/annotate", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { annotations, extractedData, tags, domain } = annotateSchema.parse(req.body);

    const record = await prisma.trainingData.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!record) throw new AppError("Training data not found", 404);

    await prisma.trainingData.update({
      where: { id: record.id },
      data: {
        annotations: annotations as Parameters<
          typeof prisma.trainingData.update
        >[0]["data"]["annotations"],
        extractedData: extractedData as Parameters<
          typeof prisma.trainingData.update
        >[0]["data"]["extractedData"],
        tags: tags ?? [],
        // The user's correction, stored BEFORE the derivation reads it back —
        // the deriver takes the domain from the row, so a correction that
        // arrived with the annotation has to already be there.
        ...(domain ? { domain } : {}),
      },
    });

    const derivation = await deriveTemplateFromAnnotation(record.id, userId);

    logger.info({ operation: "training_annotate", id: record.id, derivation });
    res.json({
      success: true,
      // Kept for the shape older clients read: the id when there is one,
      // absent when the workshop abstained. `derivation` says WHY.
      templateId: derivation.status === "derived" ? derivation.templateId : undefined,
      derivation,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
