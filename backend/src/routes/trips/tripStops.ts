import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import {
  createStopSchema,
  updateStopSchema,
  createJournalSchema,
  updateJournalSchema,
} from "../../schemas/trip";

import { updateStopAndLegs, recomputeLegs } from "../../services/tour/legRecompute";
import { autoRouteNewLegs } from "../../services/tour/routing/autoRouteLegs";
import { resolveTrip } from "./resolveTrip";

/**
 * Trip stops and journal entries — a same-prefix satellite of routes/trips.ts, split out when that
 * file sat at 1217 lines on the file-size debt list (forgejo#59). The routes
 * moved verbatim; mounts.ts registers this router right after `trips`, so
 * Express meets them in the same order as before.
 *
 * Middleware is PER ROUTE, as in trips.ts: every handler names its own
 * `authenticate` / `requireWriteScope`, and ownership goes through
 * `resolveTrip`.
 */

const router = Router();

/* ─────────── Stops ─────────── */

/** POST /trips/:id/stops */
router.post(
  "/trips/:id/stops",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const body = createStopSchema.parse(req.body);
      const stop = await prisma.tripStop.create({
        data: {
          tripId: trip.id,
          title: body.title,
          domain: body.domain,
          sourceId: body.sourceId,
          description: body.description,
          startDate: body.startDate,
          endDate: body.endDate,
          lat: body.lat,
          lon: body.lon,
          notes: body.notes,
          orderIdx: body.orderIdx ?? 0,
        },
      });
      res.status(201).json({ stop });
    } catch (error) {
      next(error);
    }
  }
);

/** PATCH /trips/:id/stops/:stopId */
router.patch(
  "/trips/:id/stops/:stopId",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const existing = await prisma.tripStop.findFirst({
        where: { id: req.params.stopId, tripId: req.params.id },
      });
      if (!existing) throw new AppError("Stop not found", 404);
      const body = updateStopSchema.parse(req.body);
      // A route member's coordinates are the invariant a section's legs
      // are built on (`recomputeLegs` refuses a coordinate-less endpoint
      // at assignment time) — but `lat`/`lon` stay nullable on the stop
      // itself, and this endpoint would otherwise silently null them out
      // from under an assigned leg. Enforced here, at the ONLY other write
      // path for a stop's coordinates.
      if (existing.routeId !== null && (body.lat === null || body.lon === null)) {
        throw new AppError(
          "This stop is part of a route section — remove it from the route before clearing its coordinates",
          400
        );
      }
      const stop = await updateStopAndLegs(prisma, req.params.stopId, body, existing);
      res.json({ stop });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /trips/:id/stops/:stopId
 *
 * A stop with no `routeId` is a plain timeline point — delete it and stop.
 * A stop that IS a route member needs more: the FK cascade already removes
 * its two adjacent `TripRouteLeg` rows (`onDelete: Cascade` on both
 * `fromStop`/`toStop`), but nothing re-creates the leg that should now span
 * its former neighbours, and the surviving members' `routeOrderIdx` goes
 * non-contiguous (e.g. 0, 2). Both are repaired here, inside one
 * transaction with the delete itself, so a section never observably passes
 * through the broken intermediate state.
 */
router.delete(
  "/trips/:id/stops/:stopId",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const existing = await prisma.tripStop.findFirst({
        where: { id: req.params.stopId, tripId: req.params.id },
      });
      if (!existing) throw new AppError("Stop not found", 404);

      const createdLegs = await prisma.$transaction(async (tx) => {
        await tx.tripStop.delete({ where: { id: req.params.stopId } });

        if (existing.routeId === null) return [];

        const route = await tx.tripRoute.findUnique({
          where: { id: existing.routeId },
          select: { mode: true },
        });
        // The section itself may have been deleted concurrently (cascade
        // from a route DELETE) — nothing left to renumber or recompute.
        if (!route) return [];

        const survivors = await tx.tripStop.findMany({
          where: { routeId: existing.routeId },
          orderBy: { routeOrderIdx: "asc" },
          select: { id: true, lat: true, lon: true },
        });

        for (let idx = 0; idx < survivors.length; idx++) {
          await tx.tripStop.update({
            where: { id: survivors[idx].id },
            data: { routeOrderIdx: idx },
          });
        }

        return recomputeLegs(tx, existing.routeId, route.mode, survivors);
      });

      if (existing.routeId !== null) {
        await autoRouteNewLegs(userId, existing.routeId, createdLegs);
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

/* ─────────── Journal entries ─────────── */

/** POST /trips/:id/journal */
router.post(
  "/trips/:id/journal",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const body = createJournalSchema.parse(req.body);
      const entry = await prisma.tripJournalEntry.create({
        data: {
          tripId: trip.id,
          date: body.date,
          title: body.title,
          body: body.body,
          mood: body.mood,
          weather: body.weather,
        },
      });
      res.status(201).json({ entry });
    } catch (error) {
      next(error);
    }
  }
);

/** PATCH /trips/:id/journal/:entryId */
router.patch(
  "/trips/:id/journal/:entryId",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const existing = await prisma.tripJournalEntry.findFirst({
        where: { id: req.params.entryId, tripId: req.params.id },
      });
      if (!existing) throw new AppError("Journal entry not found", 404);
      const body = updateJournalSchema.parse(req.body);
      const entry = await prisma.tripJournalEntry.update({
        where: { id: req.params.entryId },
        data: {
          ...(body.date !== undefined && { date: body.date }),
          ...(body.title !== undefined && { title: body.title }),
          ...(body.body !== undefined && { body: body.body }),
          ...(body.mood !== undefined && { mood: body.mood }),
          ...(body.weather !== undefined && { weather: body.weather }),
        },
      });
      res.json({ entry });
    } catch (error) {
      next(error);
    }
  }
);

/** DELETE /trips/:id/journal/:entryId */
router.delete(
  "/trips/:id/journal/:entryId",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const existing = await prisma.tripJournalEntry.findFirst({
        where: { id: req.params.entryId, tripId: req.params.id },
      });
      if (!existing) throw new AppError("Journal entry not found", 404);
      await prisma.tripJournalEntry.delete({
        where: { id: req.params.entryId },
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
