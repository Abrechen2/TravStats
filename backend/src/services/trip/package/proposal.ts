/**
 * Package reading → trip proposal. Read-only; see `types.ts` for the shape
 * and `matching.ts` for the lookups.
 *
 * The decisions, per entity:
 *   create  nothing in the logbook matches
 *   attach  a match exists without a trip (or on THIS trip without the
 *           booking) — the commit files it on the trip and booking
 *   skip    a match already sits on this trip (`duplicate`), on ANOTHER trip
 *           (`onOtherTrip` — moving it would silently undo someone's
 *           grouping, so it stays and the review says so), a leg whose airport
 *           cannot be named (`unresolvedAirport` — never guessed), or what the
 *           reviewer excluded
 */
import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { entryOf } from "../../documents/documentService";
import { normalizeLodgingName } from "../../lodging/lodgingImportPreview";
import { tripNameLanguageOf, tripNameMonth } from "../tripGrouping";
import { packageSpan, type PackageContract } from "./contract";
import {
  bookingByReference,
  endpointContext,
  existingCruise,
  existingFlight,
  lodgingIndex,
  resolveEndpoint,
  tripById,
  tripOverlapping,
  type ExistingEntry,
} from "./matching";
import type {
  EntityAction,
  PackageChoices,
  PackageProposal,
  ProposalBooking,
  ProposalCruise,
  ProposalDocument,
  ProposalFlight,
  ProposalReason,
  ProposalStay,
  ProposalTrip,
  ProposalWarning,
} from "./types";

export interface ProposalOptions {
  documentId?: string;
  choices?: PackageChoices;
}

export interface Decision {
  action: EntityAction;
  id: string | null;
  reason?: ProposalReason;
}

/**
 * What to do with an existing row, given the trip the package lands on.
 * `bookingWanted` is false for an entry the import has no booking for (a
 * rental, a visit, a flight booked without one): a row already on the trip
 * is then a duplicate, not something to attach a booking to.
 */
export function decideExisting(
  existing: ExistingEntry,
  tripId: string | null,
  bookingWanted = true
): Decision {
  if (existing.tripId === null) return { action: "attach", id: existing.id };
  if (existing.tripId === tripId) {
    return existing.bookingId === null && bookingWanted
      ? { action: "attach", id: existing.id }
      : { action: "skip", id: existing.id, reason: "duplicate" };
  }
  return { action: "skip", id: existing.id, reason: "onOtherTrip" };
}

async function defaultTripName(
  userId: string,
  contract: PackageContract,
  first: string | null
): Promise<string> {
  if (contract.tripName) return contract.tripName;
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { data: true },
  });
  const destination =
    contract.stays[0]?.city ??
    contract.flights[0]?.arrCity ??
    contract.flights[0]?.arrIata ??
    contract.bookingReference;
  if (!first) return destination;
  const month = tripNameMonth(new Date(`${first}T00:00:00Z`), tripNameLanguageOf(settings?.data));
  return `${destination} · ${month}`;
}

async function proposeTrip(
  userId: string,
  contract: PackageContract,
  choices: PackageChoices
): Promise<{ trip: ProposalTrip; booking: ProposalBooking; warnings: ProposalWarning[] }> {
  const span = packageSpan(contract);
  const warnings: ProposalWarning[] = [];
  const existingBooking = await bookingByReference(userId, contract.bookingReference);

  let trip: ProposalTrip | null = null;
  const bookedTrip = existingBooking?.tripId
    ? await tripById(userId, existingBooking.tripId)
    : null;
  if (bookedTrip) {
    trip = {
      action: "attach",
      id: bookedTrip.id,
      name: bookedTrip.name,
      matchedBy: "bookingReference",
      startDate: span?.first ?? null,
      endDate: span?.last ?? null,
    };
  } else {
    const overlapping = await tripOverlapping(userId, span);
    const found = overlapping ? await tripById(userId, overlapping) : null;
    if (found) {
      trip = {
        action: "attach",
        id: found.id,
        name: found.name,
        matchedBy: "dateOverlap",
        startDate: span?.first ?? null,
        endDate: span?.last ?? null,
      };
    }
  }
  trip ??= {
    action: "create",
    id: null,
    name: choices.tripName ?? (await defaultTripName(userId, contract, span?.first ?? null)),
    matchedBy: null,
    startDate: span?.first ?? null,
    endDate: span?.last ?? null,
  };

  // The stored price stands when the document says otherwise (rule 4: a
  // re-reading never overwrites good data) — and the review says so.
  const priceDiffers =
    existingBooking !== null &&
    existingBooking.price !== null &&
    contract.totalPrice != null &&
    (existingBooking.price !== contract.totalPrice ||
      (existingBooking.currency ?? null) !== (contract.currency ?? null));
  if (priceDiffers) warnings.push({ code: "priceConflict", subject: contract.bookingReference });
  const booking: ProposalBooking = {
    action: existingBooking ? "attach" : "create",
    id: existingBooking?.id ?? null,
    reference: contract.bookingReference,
    issuedOn: contract.issuedOn,
    price: contract.totalPrice ?? null,
    currency: contract.currency ?? null,
    travellers: contract.travellers ?? null,
    ...(priceDiffers && existingBooking
      ? { storedPrice: { price: existingBooking.price, currency: existingBooking.currency } }
      : {}),
  };
  return { trip, booking, warnings };
}

async function proposeFlights(
  userId: string,
  contract: PackageContract,
  choices: PackageChoices,
  tripId: string | null
): Promise<{ flights: ProposalFlight[]; warnings: ProposalWarning[] }> {
  const ctx = await endpointContext(contract, choices);
  const excluded = new Set(choices.excludeFlights ?? []);
  const warnings: ProposalWarning[] = [];
  const flights: ProposalFlight[] = [];
  for (const [index, f] of contract.flights.entries()) {
    const departure = resolveEndpoint(f.depIata, f.depCity, ctx);
    const arrival = resolveEndpoint(f.arrIata, f.arrCity, ctx);
    for (const end of [departure, arrival]) {
      const subject = end.city ?? end.iata ?? f.flightNumber;
      if (end.status === "ambiguous") warnings.push({ code: "airportAmbiguous", subject });
      if (end.status === "unknown") warnings.push({ code: "airportUnknown", subject });
    }
    const existing = await existingFlight(userId, f, departure.iata, arrival.iata);
    let decision: Decision = existing
      ? decideExisting(existing, tripId)
      : departure.iata && arrival.iata
        ? { action: "create", id: null }
        : { action: "skip", id: null, reason: "unresolvedAirport" };
    if (decision.reason === "onOtherTrip") {
      warnings.push({ code: "flightOnOtherTrip", subject: f.flightNumber });
    }
    if (excluded.has(index) && decision.action !== "skip") {
      decision = { action: "skip", id: decision.id, reason: "excluded" };
    }
    flights.push({
      index,
      ...decision,
      flightNumber: f.flightNumber,
      airline: f.airline ?? null,
      date: f.date,
      depTime: f.depTime ?? null,
      arrTime: f.arrTime ?? null,
      arrDayOffset: f.arrDayOffset ?? 0,
      departure,
      arrival,
    });
  }
  return { flights, warnings };
}

async function proposeStays(
  userId: string,
  contract: PackageContract,
  choices: PackageChoices,
  tripId: string | null
): Promise<{ stays: ProposalStay[]; warnings: ProposalWarning[] }> {
  const index = await lodgingIndex(
    userId,
    contract.stays.map((s) => s.name)
  );
  const excluded = new Set(choices.excludeStays ?? []);
  const warnings: ProposalWarning[] = [];
  const stays = contract.stays.map((s, i): ProposalStay => {
    const lodgingId = index.lodgings.get(normalizeLodgingName(s.name)) ?? null;
    const existing = lodgingId ? index.stays.get(`${lodgingId}|${s.checkIn}`) : undefined;
    let decision: Decision = existing
      ? decideExisting(existing, tripId)
      : { action: "create", id: null };
    if (decision.reason === "onOtherTrip") {
      warnings.push({ code: "stayOnOtherTrip", subject: s.name });
    }
    if (excluded.has(i) && decision.action !== "skip") {
      decision = { action: "skip", id: decision.id, reason: "excluded" };
    }
    return {
      index: i,
      ...decision,
      lodging: { action: lodgingId ? "reuse" : "create", id: lodgingId },
      name: s.name,
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      address: s.address ?? null,
      city: s.city ?? null,
      country: s.country ?? null,
      board: s.board ?? null,
      room: s.room ?? null,
    };
  });
  return { stays, warnings };
}

async function proposeCruise(
  userId: string,
  contract: PackageContract,
  choices: PackageChoices,
  tripId: string | null
): Promise<{ cruise: ProposalCruise | null; warnings: ProposalWarning[] }> {
  if (!contract.cruiseShip && !contract.cruiseFrom) return { cruise: null, warnings: [] };
  const warnings: ProposalWarning[] = [];
  const existing = await existingCruise(userId, contract);
  let decision: Decision = existing
    ? decideExisting(existing, tripId)
    : contract.cruiseStart
      ? { action: "create", id: null }
      : { action: "skip", id: null, reason: "undated" };
  if (decision.reason === "undated") {
    warnings.push({
      code: "cruiseUndated",
      subject: contract.cruiseShip ?? contract.cruiseFrom ?? "",
    });
  }
  if (choices.excludeCruise && decision.action !== "skip") {
    decision = { action: "skip", id: decision.id, reason: "excluded" };
  }
  return {
    cruise: {
      ...decision,
      ship: contract.cruiseShip ?? null,
      from: contract.cruiseFrom ?? null,
      to: contract.cruiseTo ?? null,
      cabin: contract.cruiseCabin ?? null,
      startDate: contract.cruiseStart ?? null,
      endDate: contract.cruiseEnd ?? null,
    },
    warnings,
  };
}

async function proposeDocument(
  userId: string,
  documentId: string | undefined,
  tripId: string | null
): Promise<{ document: ProposalDocument | null; warnings: ProposalWarning[] }> {
  if (!documentId) return { document: null, warnings: [] };
  const doc = await prisma.document.findFirst({ where: { id: documentId, userId } });
  if (!doc) throw new AppError("Document not found", 404);
  const filed = entryOf(doc);
  if (!filed) return { document: { id: doc.id, action: "file" }, warnings: [] };
  if (filed.type === "trip" && filed.id === tripId) {
    return { document: { id: doc.id, action: "skip", reason: "alreadyOnTrip" }, warnings: [] };
  }
  return {
    document: { id: doc.id, action: "skip", reason: "filedElsewhere" },
    warnings: [{ code: "documentFiledElsewhere", subject: doc.originalName ?? doc.id }],
  };
}

export async function buildPackageProposal(
  userId: string,
  contract: PackageContract,
  options: ProposalOptions = {}
): Promise<PackageProposal> {
  const choices = options.choices ?? {};
  const head = await proposeTrip(userId, contract, choices);
  const tripId = head.trip.id;
  const [flights, stays, cruise, document] = [
    await proposeFlights(userId, contract, choices, tripId),
    await proposeStays(userId, contract, choices, tripId),
    await proposeCruise(userId, contract, choices, tripId),
    await proposeDocument(userId, options.documentId, tripId),
  ];
  return {
    trip: head.trip,
    booking: head.booking,
    flights: flights.flights,
    stays: stays.stays,
    cruise: cruise.cruise,
    document: document.document,
    warnings: [
      ...head.warnings,
      ...flights.warnings,
      ...stays.warnings,
      ...cruise.warnings,
      ...document.warnings,
    ],
  };
}
