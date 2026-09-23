import { Router, Response, NextFunction, Request } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { authenticate, requireAdmin, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import {
  uploadLoginBackgrounds,
  getLoginBackgroundDir,
  deleteLoginBackgroundFile,
} from "../middleware/upload";
import { validateProfilePictureFile } from "../utils/fileValidation";
import { FILE_LIMITS } from "../config/constants";
import logger from "../utils/logger";

/**
 * The images behind the left half of the sign-in page.
 *
 * Asked for by a tester on 2026-09-21: "Man könnte in den Einstellungen die
 * Möglichkeit bieten Fotos hochzuladen die dann in der linken Hälfte als
 * dezenter Hintergrund als Slideshow durchlaufen."
 *
 * Two decisions worth stating, because both look like shortcuts and are not:
 *
 * **The directory IS the list.** There is no table and no settings field.
 * Adding an image is a file appearing, removing one is a file going away, and
 * the order is the filename, which starts with the upload timestamp. A row
 * that can disagree with the bytes beside it is the failure mode this avoids,
 * and it is the one this project has already paid for once — a restore that
 * kept every photo ROW and none of the files.
 *
 * **These are PUBLIC, and deliberately so.** The sign-in page is served to
 * anyone who can reach the instance, so anything shown on it is too. That is
 * why the upload is admin-only and why this is its own directory rather than
 * a corner of the trip photos: putting an image here is a decision to publish
 * it, and it has to look like one. The endpoints say nothing else about the
 * instance — a caller learns how many decorative images an admin uploaded,
 * which is what the page itself shows anyway.
 */

const router = Router();

/** No user data here, so the response is cacheable — `private`, never
 *  `public`: a shared cache must not be handed anything from `/api`. */
const CACHE_CONTROL = "private, max-age=3600";

/** Uploaded names are server-generated (`<ts>-<rand>-<slug><ext>`); this is
 *  what a caller is allowed to ask for, checked before any path is built. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

function listBackgroundFiles(): string[] {
  const dir = getLoginBackgroundDir();
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    // An instance that has never had one has no directory yet. "No images"
    // is the honest answer, and the page simply draws its gradient.
    return [];
  }
  return entries
    .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .filter((name) => SAFE_NAME.test(name))
    .sort();
}

/**
 * GET /api/v1/login-backgrounds
 * PUBLIC. The filenames, oldest first. The sign-in page fetches this before
 * anyone has signed in, which is the whole point.
 */
router.get("/", (_req: Request, res: Response): void => {
  const files = listBackgroundFiles();
  res.set("Cache-Control", CACHE_CONTROL);
  res.json({ backgrounds: files });
});

/**
 * GET /api/v1/login-backgrounds/:filename
 * PUBLIC. Serves one image. The name is matched against `SAFE_NAME` and then
 * reduced to its basename before a path exists at all, so no input of any
 * shape reaches the filesystem as a path segment.
 */
router.get("/:filename", (req: Request, res: Response, next: NextFunction): void => {
  try {
    const { filename } = req.params;
    if (!SAFE_NAME.test(filename)) {
      throw new AppError("File not found", 404);
    }
    const sanitized = path.basename(filename);
    if (!IMAGE_EXTENSIONS.has(path.extname(sanitized).toLowerCase())) {
      throw new AppError("File not found", 404);
    }
    const filePath = path.join(getLoginBackgroundDir(), sanitized);
    if (!fs.existsSync(filePath)) {
      throw new AppError("File not found", 404);
    }
    res.set("Cache-Control", CACHE_CONTROL);
    res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
});

// Everything below changes what every visitor sees before they sign in, so
// it is admin-only. Mounted here rather than on the router as a whole
// because the two GETs above must stay reachable without a session.
router.use(authenticate, requireAdmin);

/**
 * POST /api/v1/login-backgrounds
 * Admin. Upload one or more images.
 */
router.post(
  "/",
  (req: Request, res: Response, next: NextFunction) => {
    uploadLoginBackgrounds.array("backgrounds", FILE_LIMITS.LOGIN_BACKGROUND_MAX_COUNT)(
      req,
      res,
      (err: unknown) => {
        if (err) {
          if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
            const mb = Math.round(FILE_LIMITS.LOGIN_BACKGROUND_MAX_SIZE / (1024 * 1024));
            return next(new AppError(`File too large. Maximum size is ${mb} MB.`, 400));
          }
          const message = err instanceof Error ? err.message : "Upload failed";
          return next(new AppError(message, 400));
        }
        next();
      }
    );
  },
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    try {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) {
        throw new AppError("No file uploaded", 400);
      }

      const accepted: string[] = [];
      const rejected: string[] = [];
      for (const file of files) {
        // Magic numbers, never the client's mimetype — a .png header is what
        // makes a file an image, and the browser's word for it is not.
        const filePath = path.join(getLoginBackgroundDir(), path.basename(file.filename));
        const validation = validateProfilePictureFile(filePath, file.mimetype);
        if (validation.valid) {
          accepted.push(path.basename(file.filename));
          continue;
        }
        rejected.push(file.originalname);
        deleteLoginBackgroundFile(file.filename);
      }

      if (accepted.length === 0) {
        throw new AppError("No valid image uploaded", 400);
      }

      logger.info({
        operation: "login_background_upload",
        message: `Login backgrounds uploaded: ${accepted.length}`,
        context: { accepted: accepted.length, rejected: rejected.length },
      });

      // A partly-good upload reports both halves rather than failing whole:
      // ten holiday pictures, one of them a renamed PDF, should leave nine
      // backgrounds and one explanation.
      res.status(201).json({ backgrounds: listBackgroundFiles(), accepted, rejected });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/v1/login-backgrounds/:filename
 * Admin. Idempotent — deleting one that is already gone is a 200, so the UI
 * never has to ask whether it was still there.
 */
router.delete("/:filename", (req: AuthRequest, res: Response, next: NextFunction): void => {
  try {
    const { filename } = req.params;
    if (!SAFE_NAME.test(filename)) {
      throw new AppError("File not found", 404);
    }
    deleteLoginBackgroundFile(path.basename(filename));
    res.json({ backgrounds: listBackgroundFiles() });
  } catch (error) {
    next(error);
  }
});

export default router;
