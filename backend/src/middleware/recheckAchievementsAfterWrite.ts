import type { NextFunction, Request, Response } from "express";

import type { AuthRequest } from "./auth";
import { recheckAchievements } from "../utils/achievements";

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Roadtrip badges (km on the road, free nights, countries on one trip) move
 * with every station, leg and kind change, and those writes are spread over
 * a dozen handlers under /roadtrips, /tours and /trips/:id/routes. Without
 * this the badges only caught up on the next flight, stay or place write.
 *
 * The check runs AFTER the response, never before it: the station editor
 * saves on every pause, and a reader should not wait for the whole
 * achievement engine to answer "saved". `recheckAchievements` logs and
 * swallows its own failures — a badge that is late must never fail a save.
 */
export function recheckAchievementsAfterWrite(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (WRITES.has(req.method)) {
    res.on("finish", () => {
      const userId = (req as AuthRequest).userId;
      if (userId && res.statusCode < 400) {
        void recheckAchievements(userId, `${req.method} ${req.baseUrl}${req.path}`);
      }
    });
  }
  next();
}
