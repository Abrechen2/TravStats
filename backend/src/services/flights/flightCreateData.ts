/**
 * The row a document-sourced flight is written as — moved out of
 * `routes/flightsBatch.ts` so the batch import and the package-tour commit
 * (`services/trip/package/commit.ts`) write a flight through the SAME
 * derivations: status from the dates, airline codes from a name, CO2 and the
 * route distance from the enriched ends, the zone columns, and the shared
 * create fields. A second copy is how the two paths would come to disagree
 * (AUD-022 is that story for the single-create route).
 *
 * Pure with respect to the database except for `flightZoneColumns`' catalogue
 * read, so a caller can build every row BEFORE it opens its transaction. The
 * enrichment, companion resolution and FX snapshot stay with the caller: each
 * goes to the network or writes, and a write transaction must not wait on it.
 */
import type { Prisma } from "../../prisma";
import type { CreateFlightInput } from "../../schemas/flight";
import type { enrichFlightAirports } from "../airportLookup";
import { calculateCo2Kg, haversineKm, toSeatClass } from "../co2Calculator";
import { resolveAirlineCodes } from "../../utils/airlineNormalize";
import { calculateNextApiCheckAt } from "../../utils/smartCheckSchedule";
import { deriveFlightStatus, FLIGHT_PASSTHROUGH } from "../../shared/statusDerivation";
import { normalizeAircraft } from "../../utils/aircraftNormalize";
import { sharedFlightCreateFields } from "./flightCreateFields";
import { toUtcDate } from "./mergedChronology";
import { flightZoneColumns } from "../../routes/flights/timeInput";
import type { FxColumns } from "../fx/snapshot";

export interface FlightCreateContext {
  userId: string;
  externalRef: string | null;
  importBatchId: string | null;
  enriched: Awaited<ReturnType<typeof enrichFlightAirports>>;
  /** Resolved display names — the legacy array, dual-written with the links. */
  companionNames: string[];
  fx: FxColumns;
}

export async function buildFlightCreateData(
  data: CreateFlightInput,
  ctx: FlightCreateContext
): Promise<Prisma.FlightUncheckedCreateInput> {
  const { enriched } = ctx;
  const departureUtc = toUtcDate(data.departureLocal, data.depTimezone, data.departureFold);
  const arrivalUtc = toUtcDate(data.arrivalLocal, data.arrTimezone, data.arrivalFold);
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
  const resolvedAirline =
    data.airline && !data.airlineIata && !data.airlineIcao
      ? resolveAirlineCodes(data.airline)
      : null;
  const resolvedOperating =
    data.operatingAirline && !data.operatingAirlineIata && !data.operatingAirlineIcao
      ? resolveAirlineCodes(data.operatingAirline)
      : null;

  return {
    userId: ctx.userId,
    externalRef: ctx.externalRef,
    importBatchId: ctx.importBatchId,
    // The zone each end was written with (ADR 0002 phase 2).
    ...(await flightZoneColumns(data, enriched)),
    airline: data.airline,
    airlineIata: data.airlineIata ?? resolvedAirline?.iata,
    airlineIcao: data.airlineIcao ?? resolvedAirline?.icao,
    operatingAirline: data.operatingAirline,
    operatingAirlineIata: data.operatingAirlineIata ?? resolvedOperating?.iata,
    operatingAirlineIcao: data.operatingAirlineIcao ?? resolvedOperating?.icao,
    isCodeshare: data.isCodeshare,
    flightNumber: data.flightNumber,
    callsign: data.callsign,
    // Normalised, like the single-create route — an unnormalised
    // model string makes the same aircraft read as two.
    aircraft: data.aircraft ? normalizeAircraft(data.aircraft) : null,
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
    depTimeSemantics: data.depTimeSemantics ?? "UTC",
    arrTimeSemantics: data.arrTimeSemantics ?? "UTC",
    delayMinutes:
      actualDepartureUtc && departureUtc
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
      enriched.arrival.lon
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
    companions: ctx.companionNames,
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
    // The columns both create paths must write. Ten of them were
    // missing here, so a bulk import answered 201 and stored nulls for
    // the cabin, the registration, the Mode-S address and every
    // special-flight field (AUD-022).
    ...sharedFlightCreateFields(data),
    // The same FX snapshot the single-create route takes. Resolved
    // BEFORE the transaction (it goes to the network), so a slow rate
    // lookup cannot hold a write transaction open.
    ...ctx.fx,
    // Default to 'email_import' for backward compat (this route was
    // originally only called from the email/PDF parsers). AI-agent
    // and xlsx imports can override with 'bulk_import'.
    dataSource: data.dataSource ?? "email_import",
    lastModifiedBy: "user",
    nextApiCheckAt: calculateNextApiCheckAt(
      departureUtc,
      arrivalUtc,
      effectiveStatus,
      data.flightNumber
    ),
  };
}
