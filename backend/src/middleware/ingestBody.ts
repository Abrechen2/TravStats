import express, { type NextFunction, type Request, type Response } from "express";

import { LOCATION_MAX_BODY_BYTES } from "../schemas/travtrack";
import { AppError } from "./errorHandler";

/**
 * The body of the OwnTracks and Overland ingest paths (TravTrack plan E9,
 * Codex review). Mounted in `index.ts` BEFORE the global 10 MB JSON parser,
 * which then skips these requests (`body-parser` marks a read body), so:
 *
 *   - at most `LOCATION_MAX_BODY_BYTES` is ever read, by anyone, before the
 *     token is checked — counted on the INFLATED bytes, whatever the
 *     `Content-Encoding`, with or without a `Content-Length` (chunked);
 *   - the bytes are only read here, not parsed: JSON parsing happens after
 *     authentication (`parseIngestJson`), so a stranger costs no parse.
 *
 * Over the limit is 413 `TRACK_BODY_TOO_LARGE`; an unreadable body 400.
 */

export const TRAVTRACK_INGEST_PATH = "/api/v1/travtrack/ingest";

const readRaw = express.raw({ type: () => true, limit: LOCATION_MAX_BODY_BYTES, inflate: true });

export function ingestRawBody(req: Request, res: Response, next: NextFunction): void {
  readRaw(req, res, (err?: unknown) => {
    if (!err) return next();
    const type = (err as { type?: string }).type;
    if (type === "entity.too.large") {
      return next(new AppError("The upload is too large", 413, "TRACK_BODY_TOO_LARGE"));
    }
    return next(new AppError("The body could not be read", 400, "VALIDATION_FAILED"));
  });
}

/** The read bytes as JSON; an empty body is `{}` (OwnTracks posts one). Mount after auth. */
export function parseIngestJson(req: Request, _res: Response, next: NextFunction): void {
  const raw: unknown = req.body;
  if (!Buffer.isBuffer(raw)) {
    req.body = {};
    return next();
  }
  const text = raw.toString("utf8").trim();
  if (text === "") {
    req.body = {};
    return next();
  }
  try {
    req.body = JSON.parse(text) as unknown;
    next();
  } catch {
    next(new AppError("The body is not JSON", 400, "VALIDATION_FAILED"));
  }
}
