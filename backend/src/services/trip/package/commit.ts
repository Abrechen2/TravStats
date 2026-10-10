/**
 * Writing a package proposal — ONE transaction for the trip, the booking, the
 * flights, the lodgings and stays, the cruise and the document's filing, so a
 * failure half-way leaves nothing behind (plan 2026-10-09 P3).
 *
 * The proposal is re-built here from the reading and the reviewer's choices;
 * ids a client sends back are never trusted. Every derivation that reads the
 * catalogue or goes to the network — airport enrichment, the zone columns, FX
 * snapshots, flight validation — runs BEFORE the transaction opens, through
 * the same builders the single-domain writers use (`buildFlightCreateData`,
 * `buildLodgingCreateData`, `buildStayCreateData`), so a package-made row is
 * indistinguishable from one made by those paths.
 *
 * What it never does: overwrite. An attached booking keeps its price when it
 * has one; an attached flight or stay keeps its booking when it has one; a
 * row on another trip stays where it is (the proposal skipped it already).
 */
import { propagateWrites } from "../../sharing/propagate";
import { prisma, type DbTransaction } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { createFlightSchema } from "../../../schemas/flight";
import { createStaySchema } from "../../../schemas/lodging";
import { TRIP_COLORS } from "../../../schemas/trip";
import { deriveCruiseStatus } from "../../../shared/statusDerivation";
import { dayAnchorNow } from "../../../shared/time/clock";
import { profileZoneOf } from "../../../shared/time/profileZone";
import logger from "../../../utils/logger";
import { checkAndUpdateAchievements } from "../../../utils/achievements";
import { getCachedAirports } from "../../airportCache";
import { enrichFlightAirports } from "../../airportLookup";
import { assertLinkable, linkDocumentsInTx } from "../../documents/documentService";
import { buildFlightCreateData } from "../../flights/flightCreateData";
import { flightExternalRef } from "../../importProvenance";
import {
  CLEARED_FX_COLUMNS,
  fxColumnsFor,
  getBaseCurrency,
  type FxColumns,
} from "../../fx/snapshot";
import { withAirportTimezones } from "../../flightTimezoneDefaults";
import { buildLodgingCreateData } from "../../lodging/createLodging";
import { normalizeBoard } from "../../lodging/lodgingFieldNormalization";
import { buildStayCreateData, type StayCreateColumns } from "../../lodging/stayWrites";
import { cruiseDayColumns } from "../../timeModel/cruiseColumns";
import { typedTripDays } from "../../timeModel/tripColumns";
import { zoneOfLodging } from "../../timeModel/stayColumns";
import { recomputeTripStatus } from "../../tripStatusService";
import type { Prisma } from "../../../prisma";
import { arrivalDay, type PackageContract } from "./contract";
import { packageCruiseRef } from "./matching";
import { buildPackageProposal } from "./proposal";
import type {
  EntityAction,
  PackageChoices,
  PackageProposal,
  ProposalFlight,
  ProposalReason,
  ProposalStay,
} from "./types";

export interface CommittedEntity {
  action: EntityAction;
  id: string | null;
  reason?: ProposalReason;
}

export interface PackageCommitResult {
  trip: { action: "create" | "attach"; id: string };
  booking: { action: "create" | "attach"; id: string };
  flights: Array<CommittedEntity & { index: number }>;
  stays: Array<CommittedEntity & { index: number; lodgingId: string | null }>;
  cruise: CommittedEntity | null;
  document: { id: string; action: "file" | "skip"; reason?: string } | null;
  /** The proposal the commit executed, warnings included. */
  proposal: PackageProposal;
}

const utcDay = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

// ------------------------------------------------------------------ flights

async function flightRow(
  userId: string,
  contract: PackageContract,
  flight: ProposalFlight
): Promise<Prisma.FlightUncheckedCreateInput> {
  const depIata = flight.departure.iata!;
  const arrIata = flight.arrival.iata!;
  const airports = await getCachedAirports([depIata, arrIata]);
  const dep = airports.get(depIata);
  const arr = airports.get(arrIata);
  const field = `flights[${flight.index}]`;
  if (!dep || !arr) {
    throw new AppError(
      `${flight.flightNumber}: airport not in the catalogue`,
      422,
      "PACKAGE_FLIGHT_INVALID",
      field
    );
  }
  const airlineIsCode = flight.airline !== null && /^[A-Z0-9]{2}$/.test(flight.airline);
  const departureLocal = `${flight.date}T${flight.depTime ?? "12:00"}`;
  const arrivalLocal = `${arrivalDay(flight)}T${flight.arrTime ?? "12:00"}`;
  const raw = {
    flightNumber: flight.flightNumber,
    airline: airlineIsCode ? null : flight.airline,
    // The designator IS the airline's IATA code — read, not guessed.
    airlineIata: airlineIsCode ? flight.airline : flight.flightNumber.slice(0, 2),
    departure: { iata: depIata, name: dep.name, lat: dep.lat, lon: dep.lon },
    arrival: { iata: arrIata, name: arr.name, lat: arr.lat, lon: arr.lon },
    departureLocal,
    arrivalLocal,
    depTimeSemantics: flight.depTime ? "UTC" : "DATE_ONLY",
    arrTimeSemantics: flight.arrTime ? "UTC" : "DATE_ONLY",
    status: "scheduled",
    bookingReference: contract.bookingReference,
    dataSource: "email_import",
  };
  const parsed = createFlightSchema.safeParse(await withAirportTimezones(raw));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError(
      `${flight.flightNumber} on ${flight.date}: ${issue?.message ?? "invalid"}`,
      422,
      "PACKAGE_FLIGHT_INVALID",
      field
    );
  }
  const data = parsed.data;
  const enriched = await enrichFlightAirports({
    departure: { iata: depIata, name: dep.name, lat: dep.lat, lon: dep.lon },
    arrival: { iata: arrIata, name: arr.name, lat: arr.lat, lon: arr.lon },
  });
  return buildFlightCreateData(data, {
    userId,
    externalRef: flightExternalRef({
      flightNumber: data.flightNumber,
      departureLocal,
      depIata,
      arrIata,
    }),
    importBatchId: null,
    enriched,
    companionNames: [],
    fx: CLEARED_FX_COLUMNS,
  });
}

// ------------------------------------------------------------------ stays

interface PreparedStay {
  stay: ProposalStay;
  lodging: Prisma.LodgingUncheckedCreateInput | null;
  columns: StayCreateColumns;
}

async function prepareStay(userId: string, stay: ProposalStay): Promise<PreparedStay> {
  const lodging = stay.lodging.id
    ? null
    : await buildLodgingCreateData(
        userId,
        {
          type: "hotel",
          name: stay.name,
          address: stay.address,
          city: stay.city,
          country: stay.country,
        },
        { dataSource: "import" }
      );
  const board = normalizeBoard(stay.board);
  const input = createStaySchema.parse({
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    datePrecision: "DAY",
    status: "scheduled",
    ...(board ? { board } : {}),
    ...(stay.room ? { roomCategory: stay.room } : {}),
  });
  const zone = stay.lodging.id ? await zoneOfLodging(stay.lodging.id) : null;
  const columns = await buildStayCreateData(userId, zone, input, {
    dataSource: "import",
    origin: "machine",
  });
  return { stay, lodging, columns };
}

// ------------------------------------------------------------------ cruise

async function cruiseRow(
  userId: string,
  contract: PackageContract
): Promise<Omit<Prisma.CruiseUncheckedCreateInput, "tripId" | "bookingId">> {
  const startDate = contract.cruiseStart ? utcDay(contract.cruiseStart) : null;
  const endDate = contract.cruiseEnd ? utcDay(contract.cruiseEnd) : null;
  const route = [contract.cruiseFrom, contract.cruiseTo].filter(Boolean).join(" – ");
  return {
    userId,
    shipNameOverride: contract.cruiseShip ?? null,
    routeName: route || null,
    cabinNumber: contract.cruiseCabin ?? null,
    bookingReference: contract.bookingReference,
    externalRef: packageCruiseRef(contract),
    dataSource: "import",
    startDate,
    endDate,
    status: deriveCruiseStatus({
      startDate,
      endDate,
      current: "scheduled",
      now: dayAnchorNow((await profileZoneOf(userId)).zone),
    }),
    ...(await cruiseDayColumns({ startDate, endDate, departurePortId: null, arrivalPortId: null })),
  };
}

// ------------------------------------------------------------------ commit

async function bookingFx(userId: string, contract: PackageContract): Promise<FxColumns> {
  if (contract.totalPrice == null) return CLEARED_FX_COLUMNS;
  // The day the money was committed is the document's issue day, not today.
  return fxColumnsFor(
    {
      amount: contract.totalPrice,
      currency: contract.currency ?? null,
      date: utcDay(contract.issuedOn),
    },
    await getBaseCurrency(userId)
  );
}

/** Sets `bookingId` only where the row has none — an attach never re-books. */
async function attachRow(
  tx: DbTransaction,
  model: "flight" | "lodgingStay" | "cruise",
  userId: string,
  id: string,
  tripId: string,
  bookingId: string
): Promise<void> {
  const where = { id, userId };
  const delegate = tx[model] as unknown as {
    updateMany(args: { where: object; data: object }): Promise<{ count: number }>;
  };
  await delegate.updateMany({ where: { ...where, tripId: null }, data: { tripId } });
  await delegate.updateMany({ where: { ...where, bookingId: null }, data: { bookingId } });
}

export async function commitPackageProposal(
  userId: string,
  contract: PackageContract,
  options: { documentId?: string; choices?: PackageChoices } = {}
): Promise<PackageCommitResult> {
  const proposal = await buildPackageProposal(userId, contract, options);

  // ---- everything that reads or goes to the network, before the transaction
  const flightRows = new Map<number, Prisma.FlightUncheckedCreateInput>();
  for (const f of proposal.flights) {
    if (f.action === "create") flightRows.set(f.index, await flightRow(userId, contract, f));
  }
  const preparedStays = await Promise.all(
    proposal.stays.filter((s) => s.action === "create").map((s) => prepareStay(userId, s))
  );
  const cruise = proposal.cruise?.action === "create" ? await cruiseRow(userId, contract) : null;
  const fx = await bookingFx(userId, contract);
  const document = proposal.document;
  if (document?.action === "file") {
    await assertLinkable(userId, [document.id]);
  }
  const color =
    proposal.trip.action === "create"
      ? TRIP_COLORS[(await prisma.trip.count({ where: { userId } })) % TRIP_COLORS.length]
      : null;

  const written = await prisma.$transaction(
    async (tx) => {
      // Trip — dates and name are set only when the trip is new.
      const tripId =
        proposal.trip.id ??
        (
          await tx.trip.create({
            data: {
              userId,
              name: proposal.trip.name,
              color: color ?? TRIP_COLORS[0],
              startDate: proposal.trip.startDate ? utcDay(proposal.trip.startDate) : null,
              endDate: proposal.trip.endDate ? utcDay(proposal.trip.endDate) : null,
              ...typedTripDays({
                startDate: proposal.trip.startDate ? utcDay(proposal.trip.startDate) : null,
                endDate: proposal.trip.endDate ? utcDay(proposal.trip.endDate) : null,
              }),
            },
            select: { id: true },
          })
        ).id;

      // Booking — reuse by reference, never overwrite a stored price.
      let bookingId = proposal.booking.id;
      if (bookingId) {
        await tx.booking.updateMany({
          where: { id: bookingId, userId, tripId: null },
          data: { tripId },
        });
        if (contract.totalPrice != null) {
          await tx.booking.updateMany({
            where: { id: bookingId, userId, price: null },
            data: { price: contract.totalPrice, currency: contract.currency ?? null, ...fx },
          });
        }
      } else {
        bookingId = (
          await tx.booking.create({
            data: {
              userId,
              tripId,
              pnr: contract.bookingReference,
              // The document's issue day dates the FX snapshot above; the
              // booking keeps it, with the traveller count (#356).
              bookedOn: utcDay(contract.issuedOn),
              travellers: contract.travellers ?? null,
              operator: contract.operator ?? null,
              price: contract.totalPrice ?? null,
              currency: contract.currency ?? (contract.totalPrice == null ? null : "EUR"),
              ...fx,
            },
            select: { id: true },
          })
        ).id;
      }

      const flights: PackageCommitResult["flights"] = [];
      for (const f of proposal.flights) {
        const row = flightRows.get(f.index);
        if (row) {
          const created = await tx.flight.create({
            data: { ...row, tripId, bookingId },
            select: { id: true },
          });
          flights.push({ index: f.index, action: "create", id: created.id });
        } else if (f.action === "attach" && f.id) {
          await attachRow(tx, "flight", userId, f.id, tripId, bookingId);
          flights.push({ index: f.index, action: "attach", id: f.id });
        } else {
          flights.push({
            index: f.index,
            action: "skip",
            id: f.id,
            ...(f.reason ? { reason: f.reason } : {}),
          });
        }
      }

      const stays: PackageCommitResult["stays"] = [];
      const prepared = new Map(preparedStays.map((p) => [p.stay.index, p]));
      for (const s of proposal.stays) {
        const prep = prepared.get(s.index);
        if (prep) {
          const lodgingId =
            s.lodging.id ??
            (await tx.lodging.create({ data: prep.lodging!, select: { id: true } })).id;
          const created = await tx.lodgingStay.create({
            data: { ...prep.columns, lodgingId, userId, tripId, bookingId },
            select: { id: true },
          });
          stays.push({ index: s.index, action: "create", id: created.id, lodgingId });
        } else if (s.action === "attach" && s.id) {
          await attachRow(tx, "lodgingStay", userId, s.id, tripId, bookingId);
          stays.push({ index: s.index, action: "attach", id: s.id, lodgingId: s.lodging.id });
        } else {
          stays.push({
            index: s.index,
            action: "skip",
            id: s.id,
            lodgingId: s.lodging.id,
            ...(s.reason ? { reason: s.reason } : {}),
          });
        }
      }

      let cruiseResult: CommittedEntity | null = null;
      if (proposal.cruise) {
        const c = proposal.cruise;
        if (cruise) {
          const created = await tx.cruise.create({
            data: { ...cruise, tripId, bookingId },
            select: { id: true },
          });
          cruiseResult = { action: "create", id: created.id };
        } else if (c.action === "attach" && c.id) {
          await attachRow(tx, "cruise", userId, c.id, tripId, bookingId);
          cruiseResult = { action: "attach", id: c.id };
        } else {
          cruiseResult = { action: "skip", id: c.id, ...(c.reason ? { reason: c.reason } : {}) };
        }
      }

      if (document?.action === "file") {
        const filed = await linkDocumentsInTx(tx, userId, [document.id], {
          type: "trip",
          id: tripId,
        });
        if (filed !== 1) {
          throw new AppError("Document is already filed with another entry", 409);
        }
      }

      // Filed on a shared trip: copied to its other members.
      const idsOf = (rows: { id: string | null }[]) => rows.flatMap((r) => (r.id ? [r.id] : []));
      await propagateWrites(tx, userId, "flight", idsOf(flights));
      await propagateWrites(tx, userId, "lodgingStay", idsOf(stays));
      await propagateWrites(tx, userId, "cruise", idsOf(cruiseResult ? [cruiseResult] : []));

      return { tripId, bookingId, flights, stays, cruise: cruiseResult };
    },
    { timeout: 30_000 }
  );

  await recomputeTripStatus(written.tripId);
  try {
    await checkAndUpdateAchievements(userId);
  } catch (err) {
    // Non-critical, as after a batch import: the rows are written.
    logger.error({ operation: "package_commit_achievements_failed", userId, err });
  }

  return {
    trip: { action: proposal.trip.action, id: written.tripId },
    booking: { action: proposal.booking.action, id: written.bookingId },
    flights: written.flights,
    stays: written.stays,
    cruise: written.cruise,
    document: document
      ? {
          id: document.id,
          action: document.action,
          ...(document.reason ? { reason: document.reason } : {}),
        }
      : null,
    proposal,
  };
}
