import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";

import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemoQuota } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { photonSearchLimiter } from "../../middleware/rateLimit";
import { aisConfigured } from "../../services/ferry/aisStream";
import { egressBlock } from "../../services/externalServices/egress";
import {
  assignVessel,
  ensureVesselMmsi,
  isInProgress,
  loadFixes,
  loadVesselJourney,
  trackFromFixes,
  type VesselJourneyKind,
} from "../../services/vessel/vesselJourney";
import { AIS_SERVICE, searchVesselCandidates } from "../../services/vessel/vesselResolver";

/**
 * The ship behind a ferry crossing or a cruise (2026-11-22) — mounted under
 * `/api/v1/ferry` and `/api/v1/cruises`:
 *   GET  /:id/vessel             which ship, its MMSI and where it came from, the
 *                                last AIS position and the recorded track;
 *   GET  /:id/vessel/candidates  the hidden override's search (`?q=` a name);
 *   PUT  /:id/vessel             bind one of those candidates.
 * The MMSI is never typed: the PUT names a candidate the server offered.
 */

/** A position older than this, during the voyage, means the ship is out of range now. */
export const FRESH_FIX_MS = 30 * 60 * 1000;

export type VesselSignal = "notConfigured" | "unresolved" | "notInProgress" | "ok" | "outOfRange";

const candidatesQuery = z.object({ q: z.string().trim().min(2).max(100) });
const assignBody = z.object({
  mmsi: z.string().regex(/^\d{9}$/),
  /** The search the pick came from; omitted when it came from the journey's own lookup. */
  query: z.string().trim().max(100).optional(),
});

export function vesselRouter(kind: VesselJourneyKind): Router {
  const router = Router();
  router.use(authenticate);
  // Method-aware: a read-only token may read the ship, never bind one.
  router.use(requireWriteScope);

  const owned = async (req: AuthRequest) => {
    const journey = await loadVesselJourney(kind, req.params.id, req.userId!);
    if (!journey)
      throw new AppError(kind === "ferry" ? "Crossing not found" : "Cruise not found", 404);
    return journey;
  };

  router.get("/:id/vessel", async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const now = new Date();
      const journey = await owned(req);
      // A page load resolves without the 20-second AIS step; the poller does that one.
      const { mmsi, resolution } = await ensureVesselMmsi(journey, now, { ais: false });
      const configured = aisConfigured() && (await egressBlock(AIS_SERVICE)) === null;
      const fixes = mmsi ? await loadFixes(journey) : [];
      const last = fixes.length > 0 ? fixes[fixes.length - 1] : null;
      const inProgress = isInProgress(journey, now);
      const fresh = last !== null && now.getTime() - last.receivedAt.getTime() <= FRESH_FIX_MS;
      const signal: VesselSignal = !mmsi
        ? "unresolved"
        : !configured
          ? "notConfigured"
          : !inProgress
            ? "notInProgress"
            : fresh
              ? "ok"
              : "outOfRange";
      res.json({
        success: true,
        data: {
          vesselName: journey.vesselName,
          mmsi,
          source: mmsi
            ? journey.mmsi
              ? journey.mmsiSource
              : resolution?.status === "resolved"
                ? resolution.source
                : null
            : null,
          confidence: resolution?.status === "resolved" ? resolution.confidence : null,
          reason: resolution?.status === "unresolved" ? resolution.reason : null,
          aisConfigured: configured,
          inProgress,
          signal,
          lastFix: last && {
            lat: last.lat,
            lon: last.lon,
            observedAt: last.observedAt.toISOString(),
            receivedAt: last.receivedAt.toISOString(),
            speedKnots: last.speedKnots,
            courseDegrees: last.courseDegrees,
          },
          track: trackFromFixes(fixes, journey),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/:id/vessel/candidates",
    rejectDemoQuota,
    photonSearchLimiter,
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        await owned(req);
        const parsed = candidatesQuery.safeParse(req.query);
        if (!parsed.success)
          throw new AppError(
            "Search needs at least two characters",
            400,
            "VESSEL_INVALID_INPUT",
            "q"
          );
        const result = await searchVesselCandidates(parsed.data.q, req.userId!);
        res.json({ success: true, data: result });
      } catch (error) {
        next(error);
      }
    }
  );

  router.put(
    "/:id/vessel",
    rejectDemoQuota,
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const journey = await owned(req);
        const parsed = assignBody.safeParse(req.body);
        if (!parsed.success)
          throw new AppError("Pick a vessel from the list", 400, "VESSEL_INVALID_INPUT", "mmsi");
        await assignVessel(journey, parsed.data.mmsi, parsed.data.query ?? null);
        res.json({ success: true, data: { mmsi: parsed.data.mmsi, source: "manual" } });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
