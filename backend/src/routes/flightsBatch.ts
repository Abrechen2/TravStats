import { Router, Response, NextFunction } from "express";
import { prisma } from "../db";
import { AuthRequest } from "../middleware/auth";
import { batchCreationLimiter } from "../middleware/rateLimit";
import { createFlightSchema } from "../schemas/flight";
import { TRIP_COLORS } from "../schemas/trip";
import logger from "../utils/logger";
import { enrichFlightAirports } from "../services/airportLookup";
import { calculateCo2Kg, toSeatClass } from "../services/co2Calculator";
import { checkAndUpdateAchievements } from "../utils/achievements";

const router = Router();

// Create multiple flights in a batch — auto-creates Trip+Booking for shared PNRs
router.post("/batch", batchCreationLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;

    const rawBody = req.body;
    if (!Array.isArray(rawBody) || rawBody.length === 0 || rawBody.length > 20) {
      res.status(400).json({ error: "Request body must be an array of 1–20 flights" });
      return;
    }

    // Validate each flight entry
    const parsedFlights = rawBody.map((entry: unknown) => createFlightSchema.parse(entry));

    // Step 1: Enrich airports OUTSIDE the transaction (async I/O, not DB ops)
    const enrichedDataList = await Promise.all(
      parsedFlights.map(async (data) => {
        const enriched = await enrichFlightAirports({
          departure: {
            iata: data.departure.iata ?? undefined,
            icao: data.departure.icao ?? undefined,
            name: data.departure.name ?? undefined,
            lat: data.departure.lat,
            lon: data.departure.lon,
          },
          arrival: {
            iata: data.arrival.iata ?? undefined,
            icao: data.arrival.icao ?? undefined,
            name: data.arrival.name ?? undefined,
            lat: data.arrival.lat,
            lon: data.arrival.lon,
          },
        });
        return { data, enriched };
      })
    );

    // Step 2: All DB writes inside a single transaction — if any step fails, all are rolled back
    const createdFlights = await prisma.$transaction(async (tx) => {
      // Create all flights
      const flights = [];
      for (const { data, enriched } of enrichedDataList) {
        const flight = await tx.flight.create({
          data: {
            userId,
            airline: data.airline,
            operatingAirline: data.operatingAirline,
            flightNumber: data.flightNumber,
            callsign: data.callsign,
            aircraft: data.aircraft,
            depIcao: enriched.departure.icao,
            depIata: enriched.departure.iata,
            depName: enriched.departure.name,
            depLat: enriched.departure.lat,
            depLon: enriched.departure.lon,
            arrIcao: enriched.arrival.icao,
            arrIata: enriched.arrival.iata,
            arrName: enriched.arrival.name,
            arrLat: enriched.arrival.lat,
            arrLon: enriched.arrival.lon,
            departureTime: new Date(data.departureTime),
            arrivalTime: new Date(data.arrivalTime),
            actualDeparture: data.actualDeparture ? new Date(data.actualDeparture) : null,
            actualArrival: data.actualArrival ? new Date(data.actualArrival) : null,
            delayMinutes: data.actualDeparture
              ? Math.round(
                  (new Date(data.actualDeparture).getTime() - new Date(data.departureTime).getTime()) /
                    60000
                )
              : null,
            co2Kg: calculateCo2Kg({
              depLat: enriched.departure.lat,
              depLon: enriched.departure.lon,
              arrLat: enriched.arrival.lat,
              arrLon: enriched.arrival.lon,
              seatClass: toSeatClass(data.seatClass),
            }),
            status: data.status,
            notes: data.notes,
            price: data.price,
            taxes: data.taxes,
            fees: data.fees,
            currency: data.currency,
            category: data.category,
            tags: data.tags ?? [],
            companions: data.companions ?? [],
            receiptUrl: data.receiptUrl,
            seatNumber: data.seatNumber,
            boardingGroup: data.boardingGroup,
            gate: data.gate,
            terminal: data.terminal,
            bookingReference: data.bookingReference,
            ticketNumber: data.ticketNumber,
            baggageAllowance: data.baggageAllowance,
            frequentFlyerNumber: data.frequentFlyerNumber,
            bookingClassLetter: data.bookingClassLetter,
            coPassengers: data.coPassengers ?? [],
            dataSource: "email_import",
            lastModifiedBy: "user",
          },
        });
        flights.push(flight);
      }

      // Group by bookingReference to auto-create Trips+Bookings
      type CreatedFlight = (typeof flights)[number];
      const pnrGroups = new Map<string, CreatedFlight[]>();
      for (const f of flights) {
        if (f.bookingReference) {
          const group = pnrGroups.get(f.bookingReference) ?? [];
          group.push(f);
          pnrGroups.set(f.bookingReference, group);
        }
      }

      for (const [pnr, groupFlights] of pnrGroups.entries()) {
        if (groupFlights.length < 2) continue;

        const count = await tx.trip.count({ where: { userId } });
        const color = TRIP_COLORS[count % TRIP_COLORS.length];

        const sorted = [...groupFlights].sort(
          (a, b) => a.departureTime.getTime() - b.departureTime.getTime()
        );
        const origin = sorted[0]?.depIata ?? "?";
        const dest = sorted[Math.ceil(sorted.length / 2) - 1]?.arrIata ?? "?";
        const month = sorted[0]?.departureTime.toLocaleDateString("en", {
          month: "short",
          year: "numeric",
        });
        const name = `${origin} – ${dest} · ${month}`;

        const trip = await tx.trip.create({ data: { userId, name, color } });
        const booking = await tx.booking.create({
          data: { userId, tripId: trip.id, pnr },
        });

        const flightIds = groupFlights.map((f) => f.id);
        await tx.flight.updateMany({
          where: { id: { in: flightIds } },
          data: { tripId: trip.id, bookingId: booking.id },
        });

        logger.info(
          { tripId: trip.id, pnr, flightCount: flightIds.length },
          "[Batch] Auto-created trip from PNR group"
        );
      }

      return flights;
    });

    // Check achievements for any flown flights (outside transaction — non-critical)
    let newAchievements: Awaited<ReturnType<typeof checkAndUpdateAchievements>> = [];
    const hasFlown = parsedFlights.some((f) => f.status === "flown");
    if (hasFlown) {
      try {
        newAchievements = await checkAndUpdateAchievements(userId);
      } catch (err: unknown) {
        logger.error({
          type: "achievement_check_failed",
          userId,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    res.status(201).json({
      flights: createdFlights,
      count: createdFlights.length,
      newAchievements: newAchievements.length > 0 ? newAchievements : undefined,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
