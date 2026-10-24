import type { NextFunction, Response } from "express";

import { prisma } from "../../db";
import type { AuthRequest } from "../../middleware/auth";
import type { Flight } from "../../prisma";
import { createFlightSchema, type CreateFlightInput } from "../../schemas/flight";
import { enrichFlightAirports } from "../../services/airportLookup";
import { resolveCompanions, linkRowsFor } from "../../services/companionService";
import {
  fileReceipts,
  linkDocuments,
  takeDocumentIds,
} from "../../services/documents/documentService";
import { enrichFlightsForClients } from "../../services/flightAirportFacts";
import { buildFlightCreateData } from "../../services/flights/flightCreateData";
import { findReimportedFlight } from "../../services/flights/flightReimport";
import { toUtcDate } from "../../services/flights/mergedChronology";
import { resolveDuplicateFlight } from "../../services/flights/duplicateResolution";
import { warnIfScheduledInPast } from "../../services/flights/scheduledInPastWarning";
import { withAirportTimezones } from "../../services/flightTimezoneDefaults";
import { fxColumnsFor, flightOwnAmount, getBaseCurrency } from "../../services/fx/snapshot";
import { flightExternalRef, isDocumentImport } from "../../services/importProvenance";
import { propagateWrite, SHARE_TX_TIMEOUT_MS } from "../../services/sharing/propagate";
import { createOnce, takeClientRef, type ClaimClientRef } from "../../services/sync/clientRef";
import { recomputeTripStatus } from "../../services/tripStatusService";
import { checkAndUpdateAchievements } from "../../utils/achievements";
import logger from "../../utils/logger";
import { ownedImportBatchId, ownedTripId } from "./createLinks";

/**
 * `POST /flights`. Lifted out of `routes/flights.ts`, which is frozen at its
 * size and may only shrink, when it learned `clientRef` (forgejo#283).
 *
 * Only a NEW row spends a key. The other answers create nothing and so stay
 * repeatable as they are: `already_imported` and a duplicate 409 find the same
 * flight again, and a `?merge=true` that folded into an existing flight merges
 * nothing a second time.
 */
type Outcome =
  | { kind: "created"; flight: Flight }
  | { kind: "merged"; flight: Flight; mergedFields: readonly string[] }
  | { kind: "alreadyImported"; existing: { id: string } }
  | { kind: "duplicate"; message: string; existing: unknown };

interface CreateOptions {
  apiToken: AuthRequest["apiToken"];
  force: boolean;
  merge: boolean;
}

export async function createFlightHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.userId!;
    // ?force=true → bypass the duplicate check and create a real second row
    //   (user opt-in). ?merge=true → fold the incoming data into the flight
    //   the user already has. force wins if both are set.
    const force = req.query["force"] === "true";
    const options = {
      apiToken: req.apiToken,
      force,
      merge: !force && req.query["merge"] === "true",
    };
    // An outbox replay carries the key it minted (forgejo#283): a repeat
    // answers the flight the first POST made, 200 instead of 201. The query
    // flags are part of what makes two writes "the same".
    const { clientRef, rest: body } = takeClientRef(req.body);
    const { created, result } = await createOnce<Outcome>({
      userId,
      clientRef,
      kind: "flight",
      payload: { body, force: options.force, merge: options.merge },
      create: (claim) => createFlight(userId, body, options, claim),
      replay: async (id) => {
        const flight = await prisma.flight.findFirst({ where: { id, userId } });
        return flight && { kind: "created", flight };
      },
    });

    if (result.kind === "alreadyImported") {
      res.status(409).json({ success: false, error: "already_imported", data: result.existing });
      return;
    }
    if (result.kind === "duplicate") {
      res.status(409).json({
        error: "DUPLICATE_FLIGHT",
        message: result.message,
        existingFlight: result.existing,
      });
      return;
    }
    if (result.kind === "merged") {
      res.status(200).json({
        flight: await withAirportFacts(result.flight),
        mergedFields: result.mergedFields,
      });
      return;
    }
    if (!created) {
      res.status(200).json({ flight: await withAirportFacts(result.flight) });
      return;
    }

    const { flight } = result;
    if (flight.tripId) await recomputeTripStatus(flight.tripId);
    // Check achievements after creating a flight and return newly unlocked ones
    let newAchievements: Awaited<ReturnType<typeof checkAndUpdateAchievements>> = [];
    try {
      newAchievements = await checkAndUpdateAchievements(userId);
    } catch (err: unknown) {
      logger.error({
        type: "achievement_check_failed",
        userId,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
    res.status(201).json({
      flight: await withAirportFacts(flight),
      newAchievements: newAchievements.length > 0 ? newAchievements : undefined,
    });
  } catch (error) {
    next(error);
  }
}

/** The enrichment every flight answer carries — see `withAirportFacts` in routes/flights.ts. */
async function withAirportFacts(flight: Flight) {
  const [enriched] = await enrichFlightsForClients([flight]);
  return enriched;
}

async function createFlight(
  userId: string,
  body: unknown,
  options: CreateOptions,
  claim: ClaimClientRef
): Promise<Outcome> {
  const data = createFlightSchema.parse(await withAirportTimezones(body));
  const documentIds = await takeDocumentIds(userId, body);

  // A mail carrying ONE flight comes through here rather than the batch
  // route, so provenance has to live in both places or half of every
  // mail-imported logbook stays unrecorded.
  const importBatchId = await ownedImportBatchId(userId, data.importBatchId);
  const tripId = await ownedTripId(userId, data.tripId); // #355: was dropped
  const externalRef = isDocumentImport(data.dataSource)
    ? flightExternalRef({
        flightNumber: data.flightNumber,
        departureLocal: data.departureLocal,
        depIata: data.departure.iata,
        arrIata: data.arrival.iata,
      })
    : null;
  if (externalRef) {
    const existing = await findReimportedFlight(userId, externalRef, data, !!options.apiToken);
    if (existing) {
      // Re-reading a forwarded confirmation is ordinary. 409 says what
      // happened; a 500 from the unique index would say the import broke.
      // The kept confirmation is filed on the flight it already made.
      await linkDocuments(userId, documentIds, { type: "flight", id: existing.id });
      return { kind: "alreadyImported", existing };
    }
  }

  warnIfScheduledInPast(userId, data);

  const departureUtc = toUtcDate(data.departureLocal, data.depTimezone, data.departureFold);
  // The decision itself, and the merge, live in `resolveDuplicateFlight` —
  // two lookups, a merge patch, a companion resolution and a transaction are
  // database choreography, not routing.
  if (!options.force) {
    const outcome = await resolveDuplicateFlight({
      userId,
      data,
      departureUtc,
      merge: options.merge,
    });
    if (outcome.kind === "merged") {
      await linkDocuments(userId, documentIds, { type: "flight", id: outcome.flight.id });
      return outcome;
    }
    if (outcome.kind === "duplicate") return outcome;
  }

  const flight = await insertFlight(userId, data, {
    departureUtc,
    externalRef,
    importBatchId,
    tripId,
    apiToken: options.apiToken,
    inTx: async (tx, id) => {
      await claim(tx, id);
      await fileReceipts(tx, userId, documentIds, { type: "flight", id });
    },
  });
  return { kind: "created", flight };
}

async function insertFlight(
  userId: string,
  data: CreateFlightInput,
  ctx: {
    departureUtc: Date | null;
    externalRef: string | null;
    importBatchId: string | null;
    tripId: string | null;
    apiToken: AuthRequest["apiToken"];
    inTx: ClaimClientRef;
  }
): Promise<Flight> {
  // Enrich airport data with missing information from database
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

  // Resolve companion names to Companion entities up front (find-or-create
  // is idempotent via companionService, so it's safe to run outside the
  // transaction below). The flight row and its links are written together
  // inside a transaction so a failure never leaves the legacy `companions`
  // array and the `companionLinks` table disagreeing.
  const resolvedCompanions = await resolveCompanions(userId, data.companions ?? []);

  const fxColumns = await fxColumnsFor(
    { amount: flightOwnAmount(data), currency: data.currency, date: ctx.departureUtc },
    await getBaseCurrency(userId)
  );
  const createData = await buildFlightCreateData(data, {
    mode: "single",
    userId,
    externalRef: ctx.externalRef,
    importBatchId: ctx.importBatchId,
    tripId: ctx.tripId,
    enriched,
    companionNames: resolvedCompanions.map((c) => c.displayName),
    fx: fxColumns,
    apiToken: ctx.apiToken,
  });

  // The client-ref claim and the documents commit with the flight (forgejo#283).
  return prisma.$transaction(
    async (tx) => {
      const created = await tx.flight.create({ data: createData });
      if (resolvedCompanions.length > 0) {
        await tx.flightCompanion.createMany({
          data: linkRowsFor(resolvedCompanions.map((c) => c.id)).map((row) => ({
            ...row,
            flightId: created.id,
          })),
          skipDuplicates: true,
        });
      }
      await propagateWrite(tx, userId, "flight", created.id);
      await ctx.inTx(tx, created.id);
      return created;
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
}
