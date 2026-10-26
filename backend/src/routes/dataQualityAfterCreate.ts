import { Router, type NextFunction, type Request, type Response } from "express";

import type { AuthRequest } from "../middleware/auth";
import { queueDataQualityChecks } from "../services/dataQualityTrigger";

/**
 * Ask the inbox's questions right after a record is created (spec 2026-10-25
 * C3) — a second copy of a flight, a ferry ride inside a trip — instead of at
 * the next nightly sweep.
 *
 * One router in front of the domain routers, the `syncPreconditions` pattern:
 * `routes/flights.ts` is frozen at its size and cannot take another line. It
 * answers nothing; it only listens for the create's response and, when it
 * succeeded, queues a detached, coalesced run (`queueDataQualityChecks`). The
 * domain router authenticates as always; `userId` is on the request by the
 * time the response finishes.
 *
 * A failed run never touches the create: the trigger swallows and logs.
 */
const router = Router();

/** The collection creates the checks read. Imports already trigger their own run. */
export const CREATE_PATHS = [
  "/flights",
  "/rail",
  "/bus",
  "/ferry",
  "/cruises",
  "/lodging",
  "/lodging/:id/stays",
] as const;

function afterCreate(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    const userId = (req as AuthRequest).userId;
    if (userId && res.statusCode >= 200 && res.statusCode < 300) {
      queueDataQualityChecks(userId, { trigger: "record_create" });
    }
  });
  next();
}

router.post([...CREATE_PATHS], afterCreate);

export default router;
