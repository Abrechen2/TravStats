import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { withRentalReadFields } from "../../services/rental/rentalDto";
import { RENTAL_INCLUDE } from "../../services/rental/rentalRowWrite";
import {
  RENTAL_ROADTRIP_VEHICLES,
  overlappingTrips,
  rentalDayRange,
  roadtripSuggestions,
} from "../../services/rental/rentalLinks";

/**
 * A rental's trip and roadtrip (spec 2026-10-01-rental-domain-design §7.1,
 * §7.2): what overlaps it, offered; and the user's confirmation that a
 * roadtrip was driven in this car. Confirming never rewrites the roadtrip's
 * stations — it OFFERS the pickup and return as its first and last station,
 * and the roadtrip keeps its own km (the rental's km come from its invoice).
 *
 * Mounted on /api/v1/rentals ahead of the rental router.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

async function ownRental(userId: string, id: string) {
  const rental = await prisma.rentalBooking.findFirst({ where: { id, userId } });
  if (!rental) throw new AppError("Rental not found", 404, "RENTAL_NOT_FOUND");
  return rental;
}

router.get("/:id/suggestions", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId as string;
    const rental = await ownRental(userId, req.params.id);
    const days = rentalDayRange(rental);
    const [trips, roadtrips] = await Promise.all([
      overlappingTrips(userId, days),
      roadtripSuggestions(userId, days),
    ]);
    res.json({
      success: true,
      data: {
        trips: trips.filter((t) => t.id !== rental.tripId),
        roadtrips: roadtrips.filter((r) => r.id !== rental.routeId),
      },
    });
  } catch (err) {
    next(err);
  }
});

const roadtripBody = z.object({ routeId: z.string().uuid().nullable() });

router.post("/:id/roadtrip", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId as string;
    const rental = await ownRental(userId, req.params.id);
    const parsed = roadtripBody.safeParse(req.body);
    if (!parsed.success)
      throw new AppError(parsed.error.message, 400, "RENTAL_INVALID_INPUT", "routeId");
    const { routeId } = parsed.data;

    if (routeId === null) {
      const row = await prisma.rentalBooking.update({
        where: { id: rental.id },
        data: { routeId: null },
        include: RENTAL_INCLUDE,
      });
      res.json({ success: true, data: withRentalReadFields(row), meta: { stationOffer: null } });
      return;
    }

    const route = await prisma.tripRoute.findFirst({
      where: { id: routeId, userId, kind: "roadtrip" },
      select: { id: true, vehicle: true, vehicleName: true },
    });
    if (!route || !(RENTAL_ROADTRIP_VEHICLES as readonly string[]).includes(route.vehicle ?? "")) {
      throw new AppError("Roadtrip not found", 404, "RENTAL_ROADTRIP_NOT_FOUND", "routeId");
    }
    // An empty vehicle name takes the booked group; a name the user wrote stays.
    const name = rental.vehicleClass ?? rental.vehicleExample;
    const [row] = await prisma.$transaction([
      prisma.rentalBooking.update({
        where: { id: rental.id },
        data: { routeId },
        include: RENTAL_INCLUDE,
      }),
      ...(route.vehicleName || !name
        ? []
        : [prisma.tripRoute.update({ where: { id: route.id }, data: { vehicleName: name } })]),
    ]);
    res.json({
      success: true,
      data: withRentalReadFields(row),
      meta: {
        // OFFERED, not applied: the roadtrip editor may take these as its first
        // and last station when the user says so.
        stationOffer: {
          first: { name: rental.pickupStationName, lat: rental.pickupLat, lon: rental.pickupLon },
          last: { name: rental.returnStationName, lat: rental.returnLat, lon: rental.returnLon },
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
