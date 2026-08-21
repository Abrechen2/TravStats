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
import { deriveFlightStatus, FLIGHT_PASSTHROUGH, tripDateBounds } from "../shared/statusDerivation";
import { recomputeTripStatus } from "../services/tripStatusService";
import { resolveCompanions, linkRowsFor } from "../services/companionService";
import { flightExternalRef, isDocumentImport } from "../services/importProvenance";

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

    // The batch id rides in the QUERY, not the body: the body is a bare array
    // and has been since the first API client shipped. Changing its shape to
    // carry one field would break every existing caller for nothing.
    const rawBatchId = typeof req.query.batchId === "string" ? req.query.batchId : null;
    let importBatchId: string | null = null;
    if (rawBatchId) {
      // Client-supplied id, so ownership is checked here — the same IDOR class
      // the lodging revert closes. A batch belonging to someone else is simply
      // not found, and the import continues unbatched rather than failing: the
      // rows the user asked for matter more than the undo record.
      const batch = await prisma.importBatch.findFirst({
        where: { id: rawBatchId, userId, domain: "flight" },
        select: { id: true },
      });
      if (!batch) {
        logger.warn({ operation: "flight_batch_unknown_import_batch", userId });
      }
      importBatchId = batch?.id ?? null;
    }

    // Provenance, so importing the same export twice recognises what it
    // already holds instead of doubling it. Only for rows that came FROM a
    // source — a hand-typed flight has no provenance to record, and giving it
    // a derived key would make two identical manual entries collide.
    // The SAME default the write below applies — a booking mail arrives here
    // without a named source and is stored as `email_import`, so the decision
    // about provenance has to see that value, not the absent one.
    const refs = parsedFlights.map((data) =>
      isDocumentImport(data.dataSource ?? "email_import")
        ? flightExternalRef({
            flightNumber: data.flightNumber,
            departureLocal: data.departureLocal,
            depIata: data.departure.iata,
            arrIata: data.arrival.iata,
          })
        : null,
    );
    const candidateRefs = refs.filter((r): r is string => r !== null);
    const alreadyHere = new Set<string>(
      candidateRefs.length === 0
        ? []
        : (
            await prisma.flight.findMany({
              where: { userId, externalRef: { in: candidateRefs } },
              select: { externalRef: true },
            })
          ).flatMap((f) => (f.externalRef ? [f.externalRef] : [])),
    );
    // Also drops a row that repeats INSIDE this chunk — one export listing the
    // same flight twice would otherwise hit the unique index and take the
    // whole transaction, and its 19 innocent rows, down with it.
    const seenInChunk = new Set<string>();
    const keep = parsedFlights.map((_data, i) => {
      const ref = refs[i];
      if (ref === null) return true;
      if (alreadyHere.has(ref) || seenInChunk.has(ref)) return false;
      seenInChunk.add(ref);
      return true;
    });
    const skipped = keep.filter((k) => !k).length;
    const flightsToCreate = parsedFlights.filter((_f, i) => keep[i]);
    const refsToCreate = refs.filter((_r, i) => keep[i]);

    if (flightsToCreate.length === 0) {
      res.status(201).json({ flights: [], count: 0, skipped });
      return;
    }

    // Step 1: Enrich airports OUTSIDE the transaction (async I/O, not DB ops).
    // Companion names are resolved to Companion entities here too (find-or-create
    // is idempotent via companionService, so it's safe to run outside the
    // transaction) — the row write and the link write still happen together
    // inside the transaction below, so a failure never leaves the legacy
    // `companions` array and the `companionLinks` table disagreeing.
    const enrichedDataList = await Promise.all(
      flightsToCreate.map(async (data, index) => {
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
        const resolvedCompanions = await resolveCompanions(userId, data.companions ?? []);
        return { data, enriched, resolvedCompanions, externalRef: refsToCreate[index] };
      })
    );

    // Step 2: All DB writes inside a single transaction — if any step fails, all are rolled back
    // Trip ids auto-created below for shared-PNR groups — status derivation
    // (spec 2026-07-17-status-from-dates) needs to read the flights it just
    // linked, so recomputeTripStatus() runs AFTER the transaction commits
    // (reading inside an open tx would see the pre-link, tripId=null rows).
    const createdTripIds: string[] = [];
    const createdFlights = await prisma.$transaction(async (tx) => {
      // Create all flights
      const flights = [];
      for (const { data, enriched, resolvedCompanions, externalRef } of enrichedDataList) {
        const departureUtc = toUtcDate(data.departureLocal, data.depTimezone);
        const arrivalUtc = toUtcDate(data.arrivalLocal, data.arrTimezone);
        const actualDepartureUtc = toUtcDate(data.actualDepartureLocal, data.actualDepartureTz);
        const actualArrivalUtc = toUtcDate(data.actualArrivalLocal, data.actualArrivalTz);
        // The status field is a client-sent HINT, not the source of truth
        // (spec 2026-07-17-status-from-dates) — same rule as the single-create
        // route in flights.ts.
        const effectiveStatus = (FLIGHT_PASSTHROUGH as readonly string[]).includes(data.status ?? "")
          ? data.status!
          : deriveFlightStatus({
              departureTime: departureUtc,
              arrivalTime: arrivalUtc,
              current: data.status ?? "scheduled",
            });
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
            externalRef,
            importBatchId,
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
            status: effectiveStatus,
            notes: data.notes,
            price: data.price,
            taxes: data.taxes,
            fees: data.fees,
            currency: data.currency,
            category: data.category,
            tags: data.tags ?? [],
            // Dual write: resolved display names keep this legacy array in
            // agreement with `companionLinks` below (trimmed, blanks dropped,
            // newest spelling wins) — same rule as the single-create route.
            companions: resolvedCompanions.map((c) => c.displayName),
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
              effectiveStatus,
              data.flightNumber,
            ),
          },
        });

        if (resolvedCompanions.length > 0) {
          await tx.flightCompanion.createMany({
            data: linkRowsFor(resolvedCompanions.map((c) => c.id)).map((row) => ({
              ...row,
              flightId: flight.id,
            })),
            skipDuplicates: true,
          });
        }

        flights.push(flight);
      }

      // Group by bookingReference to auto-create Trips+Bookings — unless the
      // user turned the silent grouping off. The PNR stays on the flight rows
      // either way, so the explicit "detect trips" endpoint can group later.
      const settings = await tx.userSettings.findUnique({
        where: { userId },
        select: { autoCreateTrips: true },
      });
      const autoCreateTrips = settings?.autoCreateTrips ?? true;

      type CreatedFlight = (typeof flights)[number];
      const pnrGroups = new Map<string, CreatedFlight[]>();
      if (autoCreateTrips) {
        for (const f of flights) {
          if (f.bookingReference) {
            const group = pnrGroups.get(f.bookingReference) ?? [];
            group.push(f);
            pnrGroups.set(f.bookingReference, group);
          }
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

        // An auto-created trip knows its flights, so it gets its date range
        // right away — four dated legs and a NULL start/end was the measured
        // defect (board item auto-created-trip-has-no-dates).
        const bounds = tripDateBounds(groupFlights, []);
        const trip = await tx.trip.create({
          data: {
            userId,
            name,
            color,
            startDate: bounds.earliestStart,
            endDate: bounds.latestEnd,
          },
        });
        createdTripIds.push(trip.id);

        // Identical non-null total on every segment = the repeated booking
        // total from the email. Move it to the booking; segments become
        // priceless (the price belongs to the booking — spec 2026-07-17).
        const firstPrice = groupFlights[0]?.price ?? null;
        const firstCurrency = groupFlights[0]?.currency ?? "EUR";
        const identicalTotal =
          firstPrice != null &&
          groupFlights.every(
            (f) => f.price === firstPrice && (f.currency ?? "EUR") === firstCurrency
          );

        const booking = await tx.booking.create({
          data: {
            userId,
            tripId: trip.id,
            pnr,
            ...(identicalTotal ? { price: firstPrice, currency: firstCurrency } : {}),
          },
        });

        const flightIds = groupFlights.map((f) => f.id);
        await tx.flight.updateMany({
          where: { id: { in: flightIds } },
          data: {
            tripId: trip.id,
            bookingId: booking.id,
            ...(identicalTotal ? { price: null } : {}),
          },
        });

        logger.info(
          { tripId: trip.id, pnr, flightCount: flightIds.length },
          "[Batch] Auto-created trip from PNR group"
        );
      }

      // Re-read: the grouping updateMany made the in-memory rows stale
      // (old price, missing tripId/bookingId) — the response must show the
      // final state (Codex review finding, spec §1).
      const fresh = await tx.flight.findMany({
        where: { id: { in: flights.map((f) => f.id) } },
      });
      const byId = new Map(fresh.map((f) => [f.id, f]));
      return flights.map((f) => byId.get(f.id) ?? f);
    });

    // Now that the transaction has committed, derive each auto-created
    // trip's status from its just-linked flights (spec 2026-07-17).
    for (const tripId of createdTripIds) {
      await recomputeTripStatus(tripId);
    }

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
      skipped,
      newAchievements: newAchievements.length > 0 ? newAchievements : undefined,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
