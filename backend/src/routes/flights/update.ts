/**
 * `PUT /flights/:id`. Lifted out of `routes/flights.ts` (frozen by the size
 * ratchet, forgejo#386 REF-16); the handler is unchanged.
 */

import { Response, NextFunction } from "express";
import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { tryLinkRailAndFly } from "../../services/rail/railAndFly";
import { propagateWrite, shareSnapshot } from "../../services/sharing/propagate";
import { updateFlightSchema } from "../../schemas/flight";
import logger from "../../utils/logger";
import { AppError } from "../../middleware/errorHandler";
import {
  applyDepartureTimesAndDelay,
  applyExtendedFlightFields,
} from "../../services/flights/extendedFlightFields";
import { checkAndUpdateAchievements } from "../../utils/achievements";
import { enrichFlightAirports } from "../../services/airportLookup";
import { calculateCo2Kg, haversineKm, toSeatClass } from "../../services/co2Calculator";
import { withAirportTimezones } from "../../services/flightTimezoneDefaults";
import { airportChanged, flightZoneColumns, withStoredZones } from "./timeInput";
import { assertMergedChronology, toUtcDate } from "../../services/flights/mergedChronology";
import { airlineCodeUpdate } from "../../utils/airlineCodeUpdate";
import { normalizeAircraft } from "../../utils/aircraftNormalize";
import { calculateNextApiCheckAt } from "../../utils/smartCheckSchedule";
import { deriveFlightStatus, FLIGHT_PASSTHROUGH } from "../../shared/statusDerivation";
import { resolveCompanions, linkRowsFor } from "../../services/companionService";
import { flightOwnAmount, getBaseCurrency } from "../../services/fx/snapshot";
import { refreshFxOnEdit } from "../../services/fx/refreshOnEdit";
import { enrichFlightsForClients } from "../../services/flightAirportFacts";
import type { FlightUpdateData } from "../flights";

export async function updateFlightHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    // Check if flight exists and belongs to user
    const existingFlight = await prisma.flight.findFirst({
      where: { id, userId },
    });

    if (!existingFlight) {
      throw new AppError("Flight not found", 404);
    }
    // A wall clock at an unchanged airport is read in the zone the flight was
    // WRITTEN with, not today's catalogue zone (ADR 0002, class 4).
    const body = withStoredZones(req.body, existingFlight);
    const data = updateFlightSchema.parse(await withAirportTimezones(body));

    // The schema can only see the BODY. A PUT that moves only the departure
    // has to be checked against the arrival that stays behind — sending a
    // departure a day later used to answer 200 and leave the arrival in the
    // past (AUD-018). So the merged end state is checked here, on the real
    // instants, which is what the row actually stores.
    assertMergedChronology(data, existingFlight);

    // Enrich airport data if departure or arrival is being updated.
    // Use immutable references — never mutate the Zod-parsed `data` object.
    let enrichedDeparture = data.departure ?? null;
    let enrichedArrival = data.arrival ?? null;

    if (data.departure || data.arrival) {
      const enriched = await enrichFlightAirports({
        departure: data.departure
          ? {
              iata: data.departure.iata ?? undefined,
              icao: data.departure.icao ?? undefined,
              name: data.departure.name ?? undefined,
              lat: data.departure.lat,
              lon: data.departure.lon,
            }
          : {
              iata: existingFlight.depIata ?? undefined,
              icao: existingFlight.depIcao ?? undefined,
              name: existingFlight.depName ?? undefined,
              lat: existingFlight.depLat,
              lon: existingFlight.depLon,
            },
        arrival: data.arrival
          ? {
              iata: data.arrival.iata ?? undefined,
              icao: data.arrival.icao ?? undefined,
              name: data.arrival.name ?? undefined,
              lat: data.arrival.lat,
              lon: data.arrival.lon,
            }
          : {
              iata: existingFlight.arrIata ?? undefined,
              icao: existingFlight.arrIcao ?? undefined,
              name: existingFlight.arrName ?? undefined,
              lat: existingFlight.arrLat,
              lon: existingFlight.arrLon,
            },
      });

      if (data.departure) {
        enrichedDeparture = { ...data.departure, ...enriched.departure };
      }
      if (data.arrival) {
        enrichedArrival = { ...data.arrival, ...enriched.arrival };
      }
    }

    const updateData: FlightUpdateData = {};
    // `!== undefined`, not truthy: an explicit null CLEARS the airline. The
    // codes follow the name — see airlineCodeUpdate for why a renamed
    // operating airline no longer keeps the previous carrier's logo.
    if (data.airline !== undefined) updateData.airline = data.airline;
    const marketing = airlineCodeUpdate(
      data.airline,
      data.airlineIata,
      data.airlineIcao,
      existingFlight.airline
    );
    if (marketing.iata !== undefined) updateData.airlineIata = marketing.iata;
    if (marketing.icao !== undefined) updateData.airlineIcao = marketing.icao;
    if (data.operatingAirline !== undefined) updateData.operatingAirline = data.operatingAirline;
    const operating = airlineCodeUpdate(
      data.operatingAirline,
      data.operatingAirlineIata,
      data.operatingAirlineIcao,
      existingFlight.operatingAirline
    );
    if (operating.iata !== undefined) updateData.operatingAirlineIata = operating.iata;
    if (operating.icao !== undefined) updateData.operatingAirlineIcao = operating.icao;
    if (data.isCodeshare !== undefined) updateData.isCodeshare = data.isCodeshare;
    if (data.flightNumber !== undefined) updateData.flightNumber = data.flightNumber;
    if (data.callsign !== undefined) updateData.callsign = data.callsign;
    if (data.aircraft !== undefined)
      updateData.aircraft = data.aircraft ? normalizeAircraft(data.aircraft) : data.aircraft;
    if (data.aircraftRegistration !== undefined)
      updateData.aircraftRegistration = data.aircraftRegistration;
    if (data.aircraftModeS !== undefined) updateData.aircraftModeS = data.aircraftModeS;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.price !== undefined) updateData.price = data.price;
    if (data.taxes !== undefined) updateData.taxes = data.taxes;
    if (data.fees !== undefined) updateData.fees = data.fees;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.seatClass !== undefined) updateData.seatClass = data.seatClass;
    if (data.tags !== undefined) updateData.tags = data.tags;
    // Replace rather than append — an update always carries the FULL
    // companion list for the flight, so stale links must go. Resolution
    // itself (find-or-create against Companion) is idempotent and safe to
    // run here, outside any transaction — same reasoning as the create
    // handler. The actual link replacement is deferred and run together
    // with the `flight.update` call below inside one `prisma.$transaction`,
    // so a failure between the two never leaves the legacy array and
    // `companionLinks` disagreeing (undefined here means "untouched": the
    // companions field was not part of this update at all).
    let resolvedCompanionsForUpdate: { id: string; displayName: string }[] | undefined;
    if (data.companions !== undefined) {
      resolvedCompanionsForUpdate = await resolveCompanions(userId, data.companions);
      updateData.companions = resolvedCompanionsForUpdate.map((c) => c.displayName);
    }
    if (data.receiptUrl !== undefined) updateData.receiptUrl = data.receiptUrl;

    // Special flights (Sonder-Flüge) — explicit `null` clears, `undefined` leaves untouched
    if (data.specialType !== undefined) updateData.specialType = data.specialType;
    if (data.eventLat !== undefined) updateData.eventLat = data.eventLat;
    if (data.eventLon !== undefined) updateData.eventLon = data.eventLon;
    if (data.eventLabel !== undefined) updateData.eventLabel = data.eventLabel;
    if (data.patternLat !== undefined) updateData.patternLat = data.patternLat;
    if (data.patternLon !== undefined) updateData.patternLon = data.patternLon;
    if (data.specialData !== undefined) {
      updateData.specialData =
        data.specialData === null
          ? Prisma.JsonNull
          : (data.specialData as unknown as Prisma.InputJsonValue);
    }

    // Boarding pass / email import fields. POST writes these on create;
    // PUT must propagate them too — without this whitelist the schema
    // accepts the input, the handler silently drops it, and the user sees
    // a 200-OK with no DB change (regression report 2026-05-04).
    if (data.seatNumber !== undefined) updateData.seatNumber = data.seatNumber;
    if (data.boardingGroup !== undefined) updateData.boardingGroup = data.boardingGroup;
    if (data.gate !== undefined) updateData.gate = data.gate;
    if (data.terminal !== undefined) updateData.terminal = data.terminal;
    if (data.bookingReference !== undefined) updateData.bookingReference = data.bookingReference;
    if (data.ticketNumber !== undefined) updateData.ticketNumber = data.ticketNumber;
    if (data.baggageAllowance !== undefined) updateData.baggageAllowance = data.baggageAllowance;
    if (data.frequentFlyerNumber !== undefined)
      updateData.frequentFlyerNumber = data.frequentFlyerNumber;
    if (data.bookingClassLetter !== undefined)
      updateData.bookingClassLetter = data.bookingClassLetter;
    if (data.coPassengers !== undefined) updateData.coPassengers = data.coPassengers;
    applyExtendedFlightFields(data, updateData);
    if (data.dataSource !== undefined) updateData.dataSource = data.dataSource;
    // Direct override for time semantics. The localTime branch below sets
    // 'UTC' implicitly when a localTime is supplied; this lets bulk-import
    // callers explicitly mark a row as DATE_ONLY / UNKNOWN without changing
    // the time itself. Explicit beats implicit when both are sent.
    if (data.depTimeSemantics !== undefined) updateData.depTimeSemantics = data.depTimeSemantics;
    if (data.arrTimeSemantics !== undefined) updateData.arrTimeSemantics = data.arrTimeSemantics;

    if (enrichedDeparture) {
      updateData.depIcao = enrichedDeparture.icao;
      updateData.depIata = enrichedDeparture.iata;
      updateData.depName = enrichedDeparture.name;
      updateData.depLat = enrichedDeparture.lat;
      updateData.depLon = enrichedDeparture.lon;
    }

    if (enrichedArrival) {
      updateData.arrIcao = enrichedArrival.icao;
      updateData.arrIata = enrichedArrival.iata;
      updateData.arrName = enrichedArrival.name;
      updateData.arrLat = enrichedArrival.lat;
      updateData.arrLon = enrichedArrival.lon;
    }

    // Resolve any incoming local+tz pairs to canonical real UTC. A null pair
    // means the field was not in this update; an empty string is treated the
    // same — clients should clear actualDeparture by passing null explicitly.
    const incomingDepUtc = toUtcDate(data.departureLocal, data.depTimezone, data.departureFold);
    const incomingArrUtc = toUtcDate(data.arrivalLocal, data.arrTimezone, data.arrivalFold);
    const changed = (end: "departure" | "arrival") => airportChanged(body, end, existingFlight);
    Object.assign(
      updateData,
      await flightZoneColumns(
        data,
        {
          departure: changed("departure") ? enrichedDeparture : null,
          arrival: changed("arrival") ? enrichedArrival : null,
        },
        existingFlight,
        req
      )
    );
    const incomingActualDepUtc = toUtcDate(data.actualDepartureLocal, data.actualDepartureTz);
    const incomingActualArrUtc = toUtcDate(data.actualArrivalLocal, data.actualArrivalTz);

    if (data.departureLocal !== undefined) {
      updateData.departureTime = incomingDepUtc ?? undefined;
      // Don't overwrite an explicit semantics override the client sent.
      if (data.depTimeSemantics === undefined) {
        updateData.depTimeSemantics = "UTC";
      }
    }
    if (data.arrivalLocal !== undefined) {
      updateData.arrivalTime = incomingArrUtc ?? undefined;
      if (data.arrTimeSemantics === undefined) {
        updateData.arrTimeSemantics = "UTC";
      }
    }

    // The status field is a client-sent HINT, not the source of truth (spec
    // 2026-07-17-status-from-dates). Derive from the FINAL dep/arr values —
    // an update may move dates without sending status, or send status
    // without moving dates, so this must run after the time fields above are
    // resolved and read the resolved values, not the raw payload.
    const requestedStatus = data.status;
    const isRequestedPassthrough =
      requestedStatus !== undefined &&
      (FLIGHT_PASSTHROUGH as readonly string[]).includes(requestedStatus);
    const currentIsPassthrough = (FLIGHT_PASSTHROUGH as readonly string[]).includes(
      existingFlight.status
    );
    if (isRequestedPassthrough) {
      // Passthrough statuses are always assigned verbatim.
      updateData.status = requestedStatus!;
    } else if (requestedStatus === undefined && currentIsPassthrough) {
      // Stored status is passthrough and no status field arrived — leave it
      // alone. A bare date edit must never pull a cancelled/historical/
      // duplicated flight back into the derived scheduled/flown lifecycle.
    } else {
      const finalDep = updateData.departureTime ?? existingFlight.departureTime;
      const finalArr = updateData.arrivalTime ?? existingFlight.arrivalTime;
      updateData.status = deriveFlightStatus({
        departureTime: finalDep,
        arrivalTime: finalArr,
        current: requestedStatus ?? existingFlight.status,
      });
    }

    // Actual times and delay — one call, because either time changes the delay (AUD-021).
    const sentTimes = {
      actualDepartureSent: data.actualDepartureLocal !== undefined,
      scheduledSent: data.departureLocal !== undefined,
    };
    applyDepartureTimesAndDelay(
      sentTimes,
      {
        incomingActualDep: incomingActualDepUtc,
        incomingScheduledDep: incomingDepUtc,
        existing: existingFlight,
      },
      updateData
    );
    if (data.actualArrivalLocal !== undefined) {
      updateData.actualArrival = incomingActualArrUtc;
    }

    // Recalculate CO₂ + route distance when coordinates change or on any
    // update (always keep both in sync — same source of truth).
    const depLat = enrichedDeparture?.lat ?? existingFlight.depLat;
    const depLon = enrichedDeparture?.lon ?? existingFlight.depLon;
    const arrLat = enrichedArrival?.lat ?? existingFlight.arrLat;
    const arrLon = enrichedArrival?.lon ?? existingFlight.arrLon;
    updateData.co2Kg = calculateCo2Kg({
      depLat,
      depLon,
      arrLat,
      arrLon,
      // `!== undefined`, not `??`: an explicit null means the user CLEARED the
      // seat class, so CO₂ must recompute with the default multiplier — `??`
      // would resurrect the old class for exactly that case.
      seatClass: toSeatClass(
        data.seatClass !== undefined ? data.seatClass : existingFlight.seatClass
      ),
    });
    updateData.routeDistance = haversineKm(depLat, depLon, arrLat, arrLon);

    // Set lastModifiedBy when user updates
    updateData.lastModifiedBy = "user";

    // Recalculate smart API check schedule when departure time or status changes
    if (
      data.departureLocal !== undefined ||
      data.arrivalLocal !== undefined ||
      data.status ||
      data.flightNumber
    ) {
      const effectiveDep =
        data.departureLocal !== undefined ? incomingDepUtc : existingFlight.departureTime;
      const effectiveArr =
        data.arrivalLocal !== undefined ? incomingArrUtc : existingFlight.arrivalTime;
      // updateData.status already carries the derived value from the block
      // above (or is absent when the passthrough-preserved branch fired, in
      // which case existingFlight.status is still accurate).
      const effectiveStatus = updateData.status ?? existingFlight.status;
      const effectiveFn = data.flightNumber ?? existingFlight.flightNumber;
      updateData.nextApiCheckAt = calculateNextApiCheckAt(
        effectiveDep,
        effectiveArr,
        effectiveStatus,
        effectiveFn
      );
    }

    // FX snapshot (#267), compared with the STORED row — the edit dialog sends
    // price, currency and date on every save, so "was it sent" re-snapshotted
    // a seat change and a failed lookup wiped a good rate. See refreshOnEdit.
    const pick = <K extends "price" | "taxes" | "fees" | "currency">(k: K) =>
      data[k] !== undefined ? data[k] : existingFlight[k];
    const fx = await refreshFxOnEdit(
      {
        ...existingFlight,
        amount: flightOwnAmount(existingFlight),
        date: existingFlight.departureTime,
      },
      {
        amount: flightOwnAmount({ price: pick("price"), taxes: pick("taxes"), fees: pick("fees") }),
        currency: pick("currency") ?? null,
        date: (updateData.departureTime as Date | undefined) ?? existingFlight.departureTime,
      },
      await getBaseCurrency(userId),
      { flightId: existingFlight.id, userId }
    );
    Object.assign(updateData, fx.columns);

    const flight = await prisma.$transaction(async (tx) => {
      if (resolvedCompanionsForUpdate !== undefined) {
        await tx.flightCompanion.deleteMany({ where: { flightId: existingFlight.id } });
        if (resolvedCompanionsForUpdate.length > 0) {
          await tx.flightCompanion.createMany({
            data: linkRowsFor(resolvedCompanionsForUpdate.map((c) => c.id)).map((row) => ({
              ...row,
              flightId: existingFlight.id,
            })),
            skipDuplicates: true,
          });
        }
      }

      const before = await shareSnapshot(tx, "flight", id);
      const updated = await tx.flight.update({ where: { id, userId }, data: updateData });
      await propagateWrite(tx, userId, "flight", id, before);
      return updated;
    });

    // Check achievements if status changed to flown and return newly unlocked ones.
    // Read the PERSISTED status, not the raw `data.status` hint — status is now
    // derived (spec 2026-07-17-status-from-dates), so a date-only edit can flip
    // a flight to 'flown' with no status field in the payload at all.
    let newAchievements: Awaited<ReturnType<typeof checkAndUpdateAchievements>> = [];
    if (flight.status === "flown" && existingFlight.status !== "flown") {
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

    // Rail&Fly: an edit may bring the flight within reach of a ticket.
    await tryLinkRailAndFly(userId, flight.id);
    res.json({
      flight: await withAirportFacts(flight),
      newAchievements: newAchievements.length > 0 ? newAchievements : undefined,
      // "keptStoredRate" / "lookupFailed" tell the client the rate could not be refreshed.
      fxSnapshot: fx.outcome,
    });
  } catch (error) {
    next(error);
  }
}

async function withAirportFacts<T extends Parameters<typeof enrichFlightsForClients>[0][number]>(
  flight: T
): Promise<Awaited<ReturnType<typeof enrichFlightsForClients>>[number]> {
  const [enriched] = await enrichFlightsForClients([flight]);
  return enriched;
}
