import fs from "fs";
import path from "path";
import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { z } from "zod";

import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { AppError } from "../middleware/errorHandler";
import {
  deleteNotePhotoFile,
  getNotePhotoDir,
  uploadNotePhoto,
} from "../middleware/notePhotoUpload";
import { noteCreationLimiter } from "../middleware/noteRateLimit";
import { uploadReceiptLimiter } from "../middleware/rateLimit";
import { createNoteSchema, noteQuerySchema, updateNoteSchema } from "../schemas/note";
import {
  createNote,
  getOwnNote,
  listNotes,
  toNoteDto,
  updateNote,
} from "../services/notes/noteService";
import { ingestUploadedPhotos } from "../services/photos/ingestPhotos";
import { parsePhotoVariant, photoFileToServe } from "../services/photos/displayRendition";
import logger from "../utils/logger";

/**
 * Standalone notes (forgejo#137) — a moment with no trip. Enveloped family,
 * as ADR 0001 asks of a new domain.
 *
 * Writes of text are ordinary per-user data, so the shared demo account may
 * make them like any other travel data (the nightly reseed wipes them). The
 * PHOTO is a file on the data volume, and the demo account uploads no file
 * (finding I2): `rejectDemo` sits above multer on that route.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

const DEFAULT_LIMIT = 100;
const uuid = z.string().uuid();

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

const noteId = (req: Request): string => {
  const parsed = uuid.safeParse(req.params.id);
  if (!parsed.success) throw new AppError("Note not found", 404);
  return parsed.data;
};

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const query = noteQuerySchema.parse(req.query);
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const { notes, total } = await listNotes(userId, { limit, offset });
    res.json({ success: true, data: notes.map(toNoteDto), meta: { total, limit, offset } });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const note = await getOwnNote(requireUser(req), noteId(req));
    res.json({ success: true, data: toNoteDto(note) });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/",
  noteCreationLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUser(req);
      const input = createNoteSchema.parse(req.body);
      const { note, created } = await createNote(userId, input, Boolean(req.apiToken));
      if (created) logger.info({ operation: "note_create", noteId: note.id, userId });
      res.status(created ? 201 : 200).json({ success: true, data: toNoteDto(note) });
    } catch (error) {
      next(error);
    }
  }
);

router.patch("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const id = noteId(req);
    const input = updateNoteSchema.parse(req.body);
    const note = await updateNote(userId, id, input, Boolean(req.apiToken));
    res.json({ success: true, data: toNoteDto(note) });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const note = await getOwnNote(requireUser(req), noteId(req));
    // Row first, bytes second: the other order can lose the file and keep a
    // note whose photo can never be shown.
    await prisma.note.delete({ where: { id: note.id } });
    if (note.photoFilename) deleteNotePhotoFile(note.photoFilename);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/** multer's own refusals as statuses a client can act on, instead of a 500. */
function handlePhotoUpload(req: Request, res: Response, next: NextFunction): void {
  uploadNotePhoto.single("photo")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return next(new AppError("Photo too large", 413));
    }
    if (err instanceof AppError) return next(err);
    return next(new AppError(err instanceof Error ? err.message : "Upload failed", 400));
  });
}

function removeUploaded(file: Express.Multer.File | undefined): void {
  if (file) deleteNotePhotoFile(path.basename(file.filename));
}

/** Sets or replaces the note's one photo (multipart field `photo`). */
router.put(
  "/:id/photo",
  // ABOVE the limiter and multer, so a refused request writes no bytes.
  rejectDemo,
  uploadReceiptLimiter,
  handlePhotoUpload,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const file = req.file;
    try {
      const note = await getOwnNote(requireUser(req), noteId(req));
      if (!file) throw new AppError("No photo uploaded (multipart field `photo`)", 400);
      // A HEIC original gets its JPEG display copy here, or the upload is refused.
      await ingestUploadedPhotos(getNotePhotoDir(), [file]);
      const updated = await prisma.note.update({
        where: { id: note.id },
        data: {
          photoFilename: file.filename,
          photoMimetype: file.mimetype,
          photoSizeBytes: file.size,
        },
      });
      if (note.photoFilename) deleteNotePhotoFile(note.photoFilename);
      res.json({ success: true, data: toNoteDto(updated) });
    } catch (error) {
      // multer has already written the bytes; a refused request must not leave them.
      removeUploaded(file);
      next(error);
    }
  }
);

router.delete("/:id/photo", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const note = await getOwnNote(requireUser(req), noteId(req));
    if (!note.photoFilename) {
      res.json({ success: true, data: toNoteDto(note) });
      return;
    }
    const updated = await prisma.note.update({
      where: { id: note.id },
      data: { photoFilename: null, photoMimetype: null, photoSizeBytes: null },
    });
    deleteNotePhotoFile(note.photoFilename);
    res.json({ success: true, data: toNoteDto(updated) });
  } catch (error) {
    next(error);
  }
});

/**
 * The photo's bytes. Extension-less URL (forgejo#284) and `private`: one
 * user's photo may sit in their own browser cache, never in a shared one.
 * `?variant=original` hands out a HEIC as uploaded; the default is what a
 * browser can draw.
 */
router.get("/:id/photo", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const note = await getOwnNote(requireUser(req), noteId(req));
    if (!note.photoFilename || !note.photoMimetype) throw new AppError("Note has no photo", 404);
    const served = await photoFileToServe(
      getNotePhotoDir(),
      note.photoFilename,
      note.photoMimetype,
      parsePhotoVariant(req.query)
    );
    if (!served || !fs.existsSync(served.filePath)) throw new AppError("Photo file missing", 404);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type(served.type);
    res.sendFile(served.filePath);
  } catch (error) {
    next(error);
  }
});

export default router;
