import multer from "multer";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "./errorHandler";
import { PLAN_DOCUMENT_MAX_BYTES } from "../services/travplan/planDocuments";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PLAN_DOCUMENT_MAX_BYTES, files: 1 },
});

/** One file in the multipart field `file`, at most the plan limit; multer's refusals as 4xx. */
export function planDocumentUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE")
      return next(
        new AppError(
          `Document too large: at most ${PLAN_DOCUMENT_MAX_BYTES / (1024 * 1024)} MB.`,
          413,
          "PLAN_DOCUMENT_TOO_LARGE"
        )
      );
    return next(new AppError(err instanceof Error ? err.message : "Upload failed", 400));
  });
}
