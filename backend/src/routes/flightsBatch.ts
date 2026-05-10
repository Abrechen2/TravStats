import { Router, Response, NextFunction } from "express";
import { fromZonedTime } from "date-fns-tz";
import { prisma } from "../db";
import { AuthRequest } from "../middleware/auth";
import { batchCreationLimiter } from "../middleware/rateLimit";
import { createFlightSchema } from "../schemas/flight";
import { TRIP_COLORS } from "../schemas/trip";
import logger from "../utils/logger";
import { enrichFlightAirports } from "../services/airportLookup";
import { calculateCo2Kg, haversineKm, toSeatClass } from "../services/co2Calculator";
import { resolveAirlineCodes } from "../utils/airlineNormalize";
import { checkAndUpdateAchievements } from "../utils/achievements";
import { calculateNextApiCheckAt } from "../utils/smartCheckSchedule";

function toUtcDate(local: string | null | undefined, tz: string | null | undefined): Date | null {
  if (!local || !tz) return null;
  return fromZonedTime(local, tz);
}

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

    // Soft warning for past-dated `scheduled` rows (G4) — not rejected so
    // legitimate manually-edited just-departed rows still succeed, but
    // flagged for ops review since these are usually status-flip bugs or
    // year-typos in bulk imports.
    const nowIso = new Date().toISOString().slice(0, 19);
    for (const data of parsedFlights) {
      if (data.status === 'scheduled' && data.departureLocal && data.departureLocal < nowIso) {
        logger.warn({
          operation: 'flight_batch_scheduled_in_past',
          userId,
          departureLocal: data.departureLocal,
          flightNumber: data.flightNumber,
        });
      }
    }

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
        const departureUtc = toUtcDate(data.departureLocal, data.depTimezone);
        const arrivalUtc = toUtcDate(data.arrivalLocal, data.arrTimezone);
        const actualDepartureUtc = toUtcDate(data.actualDepartureLocal, data.actualDepartureTz);
        const actualArrivalUtc = toUtcDate(data.actualArrivalLocal, data.actualArrivalTz);
        // Auto-resolve IATA/ICAO from a free-text airline name (issue #106B).
        // Importers (Generic-CSV, FR24, AI-agent) often only supply a name —
        // without codes downstream features like airline filters and codeshare
        // detection treat spelling variants as separate carriers.
        const resolvedAirline = data.airline && !data.airlineIata && !data.airlineIcao
          ? resolveAirlineCodes(data.airline)
          : null;
        const resolvedOperating = data.operatingAirline && !data.operatingAirlineIata && !data.operatingAirlineIcao
          ? resolveAirlineCodes(data.operatingAirline)
          : null;

        const flight = await tx.flight.create({
          data: {
            userId,
            airline: data.airline,
            airlineIata: data.airlineIata ?? resolvedAirline?.iata,
            airlineIcao: data.airlineIcao ?? resolvedAirline?.icao,
            operatingAirline: data.operatingAirline,
            operatingAirlineIata: data.operatingAirlineIata ?? resolvedOperating?.iata,
            operatingAirlineIcao: data.operatingAirlineIcao ?? resolvedOperating?.icao,
            isCodeshare: data.isCodeshare,
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
            departureTime: departureUtc,
            arrivalTime: arrivalUtc,
            actualDeparture: actualDepartureUtc,
            actualArrival: actualArrivalUtc,
            depTimeSemantics: data.depTimeSemantics ?? 'UTC',
            arrTimeSemantics: data.arrTimeSemantics ?? 'UTC',
            delayMinutes: actualDepartureUtc && departureUtc
              ? Math.round((actualDepartureUtc.getTime() - departureUtc.getTime()) / 60000)
              : null,
            co2Kg: calculateCo2Kg({
              depLat: enriched.departure.lat,
              depLon: enriched.departure.lon,
              arrLat: enriched.arrival.lat,
              arrLon: enriched.arrival.lon,
              seatClass: toSeatClass(data.seatClass),
            }),
            // Haversine route distance — written on every insert so stats
            // ("total km", "longest flight", distance achievements) work
            // immediately, not only after a Provider lookup. v1.5.0-rc.3.
            routeDistance: haversineKm(
              enriched.departure.lat,
              enriched.departure.lon,
              enriched.arrival.lat,
              enriched.arrival.lon,
            ),
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
            // Default to 'email_import' for backward compat (this route was
            // originally only called from the email/PDF parsers). AI-agent
            // and xlsx imports can override with 'bulk_import'.
            dataSource: data.dataSource ?? "email_import",
            lastModifiedBy: "user",
            nextApiCheckAt: calculateNextApiCheckAt(
              departureUtc,
              arrivalUtc,
              data.status ?? "scheduled",
              data.flightNumber,
            ),
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
          (a, b) => (a.departureTime?.getTime() ?? 0) - (b.departureTime?.getTime() ?? 0)
        );
        const origin = sorted[0]?.depIata ?? "?";
        const dest = sorted[Math.ceil(sorted.length / 2) - 1]?.arrIata ?? "?";
        const month = sorted[0]?.departureTime?.toLocaleDateString("en", {
          month: "short",
          year: "numeric",
        }) ?? "";
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

    // Check achievements after batch creation (outside transaction — non-critical)
    let newAchievements: Awaited<ReturnType<typeof checkAndUpdateAchievements>> = [];
    if (createdFlights.length > 0) {
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
