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
import { extractEmailFromFile, type ExtractedEmail } from "../services/emailExtractor";
import { senderAddressIn, subjectIn } from "../services/parsers/userTemplates/sampleHeaders";
import { scoreDocument } from "../services/parsing/documentDomain";
import {
  WORKSHOP_DOMAINS,
  isLabelOfDomain,
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

/**
 * Remove the uploaded file behind a sample, if it is still one of ours.
 *
 * `originalFile` is written by the multer storage above, so the containment
 * check is not defending against a caller — it is what keeps a row restored
 * from an older backup, carrying an absolute path from another machine, from
 * turning a delete into an unlink of something else.
 *
 * A miss is logged rather than raised: by the time this runs the database row
 * is already gone, and failing the request would tell the user the sample is
 * still there when it is not.
 */
function removeTrainingFile(originalFile: string, id: string): void {
  const root = path.resolve(TRAINING_UPLOAD_DIR);
  const resolved = path.resolve(originalFile);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    logger.warn(
      { operation: "training_delete_file", id },
      "Training file lies outside the upload directory — left alone"
    );
    return;
  }
  try {
    fs.unlinkSync(resolved);
  } catch (err) {
    // ENOENT is the ordinary case for a sample whose file a sweep already took.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn(
        { operation: "training_delete_file", id, err },
        "Could not remove the training file"
      );
    }
  }
}

/**
 * How many samples one list request may ask for.
 *
 * The bound sits in the Prisma call as a `take`, so it bounds the WORK and not
 * just the answer. 50 is a real user's whole workshop history several times
 * over — the list exists so a sample can be found and removed again, not so a
 * corpus can be paged through.
 */
const MAX_TRAINING_LIST = 100;

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_TRAINING_LIST).default(50),
});

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
/** Every label the marks carry, whatever else the annotation blob holds. */
function annotatedLabels(annotations: Record<string, unknown>): string[] {
  const selections = annotations.textSelections;
  if (!Array.isArray(selections)) return [];
  return selections
    .map((selection) =>
      typeof selection === "object" && selection !== null
        ? (selection as Record<string, unknown>).label
        : undefined
    )
    .filter((label): label is string => typeof label === "string" && label.length > 0);
}

/**
 * Who sent this sample and what it was called — the two anchors a derived
 * template can carry, captured while they still exist.
 *
 * They do not survive the round trip otherwise, and that is the whole of the
 * workshop's lodging bug (beta audit 2026-09-19, NOT FIXED 5). For an `.eml`
 * the extractor hands back the BODY with the header block removed; the
 * annotation view then saves that body through `filterEmailText`, which
 * strips every address it finds. So by the time `deriveTemplateFromAnnotation`
 * regexed `^From:` and `^Subject:` out of the stored text there was nothing
 * left to find, and every browser upload of a hotel confirmation abstained
 * with `noDistinguishingMarker` — while the same body posted to the API with
 * its `From:` line still on it derived a template.
 *
 * The in-text read stays, as the fallback: for a `.txt` or a pasted sample
 * the header block is part of the document the user annotates.
 */
interface SampleIdentity {
  senderAddress?: string;
  subject?: string;
}

function sampleIdentity(extracted: ExtractedEmail, fullText: string): SampleIdentity {
  const senderAddress = extracted.from ?? senderAddressIn(fullText) ?? undefined;
  const subject = extracted.subject.trim() || subjectIn(fullText) || undefined;
  return {
    ...(senderAddress ? { senderAddress } : {}),
    ...(subject ? { subject } : {}),
  };
}

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
      let identity: SampleIdentity = {};
      try {
        if (type === "email") {
          const buffer = fs.readFileSync(req.file.path);
          const extracted = extractEmailFromFile(buffer, req.file.originalname);
          // Strip NUL bytes — PostgreSQL jsonb rejects them
          const fullText = (extracted.text || extracted.subject || "").replace(/\0/g, "");
          if (fullText) initialAnnotations = { fullText };
          identity = sampleIdentity(extracted, fullText);
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
          ...identity,
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

// GET /api/v1/training
//
// The caller's own samples, newest first.
//
// This router served upload, read-by-id and annotate and nothing else, so a
// sample could not be found again once the annotation view was closed: the id
// was handed out once, in the upload response, and never again (beta API audit
// of 2026-09-19, unlisted finding 3). That mattered because a sample is a
// COPY of a real document — a boarding pass with a passenger's name on it,
// kept as a file on the data volume and base64'd into a jsonb column on top.
// This half says which ids exist; DELETE below is the half that removes one.
//
// `annotations` and `extractedData` are deliberately not selected: the first
// holds the whole mail text or that base64 image, so twenty rows would be
// megabytes for a view that shows a filename and a date. Read one sample by
// id for the blob.
router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { limit } = listQuerySchema.parse(req.query);

    const records = await prisma.trainingData.findMany({
      where: { userId },
      // `createdAt` is neither unique nor nullable-free across restores, so
      // the id keeps the order total — the same tie-breaker `routes/flights.ts`
      // carries, and for the same reason.
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        type: true,
        domain: true,
        status: true,
        tags: true,
        createdAt: true,
        originalFile: true,
      },
    });

    res.json({
      samples: records.map((record) => ({
        id: record.id,
        type: record.type,
        domain: record.domain,
        status: record.status,
        tags: record.tags,
        createdAt: record.createdAt.toISOString(),
        // The name, never the path: the path names the data volume's layout.
        filename: path.basename(record.originalFile),
      })),
    });
  } catch (error) {
    next(error);
  }
});

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

    // A label belongs to a domain, and a mark carrying another domain's label
    // is not something to store and reason about later: the deriver would
    // read `checkIn` out of a flight sample as a lodging field, or drop a
    // flight label from a hotel sample silently. Refused here, at the
    // boundary, in the vocabulary `shared/annotationLabels.ts` owns.
    const effectiveDomain = domain ?? (isWorkshopDomain(record.domain) ? record.domain : "flight");
    for (const label of annotatedLabels(annotations)) {
      if (!isLabelOfDomain(effectiveDomain, label)) {
        throw new AppError(`"${label}" is not a ${effectiveDomain} field`, 400);
      }
    }

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

// DELETE /api/v1/training/:id
//
// Another user's id is answered 404 and never 403. The two are
// distinguishable, and the difference is itself the leak: a 403 would confirm
// that the id exists and belongs to somebody. Same status and same message as
// the GET above, so there is nothing to compare.
router.delete(
  "/:id",
  // The same guard the upload route carries, in the same place. The shared
  // demo account can own no sample, so this refuses nothing that would
  // otherwise have succeeded — which is exactly why it belongs here: a
  // boundary that holds only because of what the data happens to contain is
  // not a boundary. Measured on the beta, where the demo account is logged in
  // by every visitor at once.
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const record = await prisma.trainingData.findFirst({
        where: { id: req.params.id, userId },
      });
      if (!record) throw new AppError("Training data not found", 404);

      // The row first: it carries the annotation blob, which is the copy a
      // read route can still serve. Once it is gone nothing references the
      // file, so a failed unlink leaves bytes that no request can reach —
      // logged, never swallowed, so an operator can sweep them.
      await prisma.trainingData.delete({ where: { id: record.id } });
      removeTrainingFile(record.originalFile, record.id);

      logger.info({ operation: "training_delete", id: record.id });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
