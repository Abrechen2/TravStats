/**
 * The lodging counterpart of /boardingpass/propose: does the user already have
 * this house?
 *
 * A module of its own because `routes/lodging.ts` is at the 800-line limit and
 * new files get no baseline entry — but the seam is a real one either way. The
 * rest of that router is CRUD over lodgings and their stays; this answers a
 * question and writes nothing.
 */

import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { portGeocodeLimiter } from "../../middleware/rateLimit";
import { proposeLodgingSchema } from "../../schemas/lodging";
import { proposeLodgingMatch } from "../../services/lodging/proposeMatch";
import { resolveLocation } from "../lodgingGeocode";

const router = Router();

/**
 * POST /propose — is this scanned house one the user already has?
 *
 * The lodging counterpart of /boardingpass/propose, and it writes nothing.
 * Before it existed the Companion decided this alone, by demanding the name
 * AND the city match exactly after lowercasing. A hotel invoice photographed
 * on 2026-09-10 came back with "Oplikon" for Opfikon at OCR confidence 67, and
 * one letter was enough to create a second DORMERO (forgejo#118).
 *
 * The server can answer better for one reason above all: it geocodes the
 * incoming address — which the parse does not — and can then compare
 * positions. A name can be misread; a building cannot move.
 *
 * Declared BEFORE `/:id` so "propose" is never read as an id.
 *
 * Rate-limited on the geocoder's bucket, not a new one: what needs bounding is
 * outbound lookups per caller, and this route spends them exactly as the port
 * typeahead does.
 */
router.post(
  "/propose",
  portGeocodeLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const input = proposeLodgingSchema.parse(req.body);
      const userId = req.userId!;

      // The same resolver the create path uses, so a scan is judged against
      // the coordinates it WOULD be saved with rather than the ones it
      // arrived with. It never throws: a flaky geocoder degrades this to a
      // name comparison instead of failing the request.
      const location = await resolveLocation({
        name: input.name,
        address: input.address ?? undefined,
        city: input.city ?? undefined,
        country: input.country ?? undefined,
        lat: input.lat ?? undefined,
        lon: input.lon ?? undefined,
      });

      const stored = await prisma.lodging.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          country: true,
          lat: true,
          lon: true,
          _count: { select: { stays: true } },
        },
      });

      const proposal = proposeLodgingMatch(
        stored.map((row) => ({
          id: row.id,
          name: row.name,
          address: row.address,
          city: row.city,
          country: row.country,
          lat: row.lat,
          lon: row.lon,
          stayCount: row._count.stays,
        })),
        {
          name: input.name,
          address: input.address,
          city: input.city,
          country: input.country,
          lat: location.lat ?? input.lat,
          lon: location.lon ?? input.lon,
        },
      );

      res.json({ success: true, data: proposal });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
