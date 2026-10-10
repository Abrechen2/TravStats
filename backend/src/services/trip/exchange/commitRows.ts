/**
 * `trip.json` entries → Prisma create rows. Pure: everything that reads the
 * catalogue, the companions or the FX rates is resolved before (see
 * `resolveContext`) and handed in, so the commit's transaction only writes.
 *
 * Columns are copied exactly as the file carries them — the instant, the
 * zone, the calendar day — never re-derived (ADR 0002). A private field is
 * written only when the file has it; otherwise the column keeps its default.
 */
import { prisma } from "../../../db";
import type { Prisma } from "../../../prisma";
import { resolveCompanions, linkRowsFor } from "../../companionService";
import {
  CLEARED_FX_COLUMNS,
  fxColumnsFor,
  getBaseCurrency,
  type FxColumns,
} from "../../fx/snapshot";
import { fileFlightDay } from "../package/flightClock";
import { dayAt } from "../package/matchingEntries";
import type {
  TripFile,
  TripFileCruise,
  TripFileFlight,
  TripFilePortRef,
  TripFileRail,
  TripFileRental,
  TripFileStay,
} from "./format";

const date = (iso: string | null): Date | null => (iso ? new Date(iso) : null);
const calendar = (day: string | null): Date | null =>
  day ? new Date(`${day}T00:00:00.000Z`) : null;

export const IMPORT_SOURCE = "import";

export interface ResolvedContext {
  /** unlocode → port id */
  ports: Map<string, number>;
  /** IMO → ship id */
  ships: Map<string, number>;
  /** rail station source id → station id */
  stations: Map<string, number>;
  /** IATA → airport id */
  airports: Map<string, number>;
  /** companion display name → companion id (private files only) */
  companions: Map<string, string>;
  /** entry key (or `b:<key>` for a booking) → FX columns of its own price */
  fx: Map<string, FxColumns>;
}

async function fxFor(
  amount: number | null | undefined,
  currency: string | null | undefined,
  day: string | null,
  base: string
): Promise<FxColumns> {
  if (amount == null || !currency || !day) return CLEARED_FX_COLUMNS;
  return fxColumnsFor({ amount, currency, date: calendar(day)! }, base);
}

/** Every lookup the rows need, done once, before the transaction. */
export async function resolveContext(userId: string, file: TripFile): Promise<ResolvedContext> {
  const portRefs = file.cruises.flatMap((c) => [
    c.departurePort,
    c.arrivalPort,
    ...c.stops.map((s) => s.port),
  ]);
  const unlocodes = [...new Set(portRefs.flatMap((p) => (p?.unlocode ? [p.unlocode] : [])))];
  const imos = [...new Set(file.cruises.flatMap((c) => (c.ship?.imo ? [c.ship.imo] : [])))];
  const sourceIds = [
    ...new Set(
      file.rail.flatMap((r) => [r.dep.sourceId, r.arr.sourceId]).filter((s): s is string => !!s)
    ),
  ];
  const iatas = [
    ...new Set(
      file.rentals
        .flatMap((r) => [r.pickup.airportIata, r.return.airportIata])
        .filter((s): s is string => !!s)
    ),
  ];
  const [ports, ships, stations, airports] = await Promise.all([
    prisma.port.findMany({
      where: { unlocode: { in: unlocodes } },
      select: { id: true, unlocode: true },
    }),
    prisma.ship.findMany({ where: { imo: { in: imos } }, select: { id: true, imo: true } }),
    prisma.railStation.findMany({
      where: { sourceId: { in: sourceIds } },
      select: { id: true, sourceId: true },
    }),
    prisma.airport.findMany({ where: { iata: { in: iatas } }, select: { id: true, iata: true } }),
  ]);

  const names = [
    ...(file.trip.private?.companions ?? []),
    ...file.flights.flatMap((f) => f.private?.companions ?? []),
    ...file.cruises.flatMap((c) => c.private?.companions ?? []),
    ...file.rail.flatMap((r) => r.private?.companions ?? []),
    ...file.rentals.flatMap((r) => r.private?.companions ?? []),
  ];
  const companions = new Map<string, string>();
  // One name at a time: the service dedupes by canonical form, so asking per
  // name is the only way to know which id each spelling became.
  for (const name of new Set(names)) {
    const [hit] = await resolveCompanions(userId, [name]);
    if (hit) companions.set(name, hit.id);
  }

  const base = await getBaseCurrency(userId);
  const fx = new Map<string, FxColumns>();
  const firstDay = file.trip.startDay ?? file.trip.startDate?.slice(0, 10) ?? null;
  for (const b of file.bookings)
    fx.set(`b:${b.key}`, await fxFor(b.price, b.currency, firstDay, base));
  for (const f of file.flights) {
    fx.set(f.key, await fxFor(f.private?.price, f.private?.currency, fileFlightDay(f), base));
  }
  for (const s of file.stays) {
    fx.set(s.key, await fxFor(s.private?.totalPrice, s.private?.currency, s.checkInDate, base));
  }
  for (const c of file.cruises) {
    fx.set(c.key, await fxFor(c.private?.price, c.private?.currency, c.startDay, base));
  }
  for (const r of file.rail) {
    fx.set(
      r.key,
      await fxFor(
        r.private?.price,
        r.private?.currency,
        dayAt(r.departureTime, r.dep.timezone),
        base
      )
    );
  }
  for (const r of file.rentals) {
    fx.set(
      r.key,
      await fxFor(
        r.private?.price,
        r.private?.currency,
        dayAt(r.pickupTime, r.pickup.timezone),
        base
      )
    );
  }

  return {
    ports: new Map(ports.flatMap((p) => (p.unlocode ? [[p.unlocode, p.id] as const] : []))),
    ships: new Map(ships.flatMap((s) => (s.imo ? [[s.imo, s.id] as const] : []))),
    stations: new Map(stations.flatMap((s) => (s.sourceId ? [[s.sourceId, s.id] as const] : []))),
    airports: new Map(airports.flatMap((a) => (a.iata ? [[a.iata, a.id] as const] : []))),
    companions,
    fx,
  };
}

/** Join rows for the companion names a private file carries. */
export function companionLinks(
  ctx: ResolvedContext,
  names: string[] | undefined
): { create: { companionId: string; position: number }[] } | undefined {
  const ids = [...new Set((names ?? []).flatMap((n) => ctx.companions.get(n) ?? []))];
  return ids.length > 0 ? { create: linkRowsFor(ids) } : undefined;
}

const fxOf = (ctx: ResolvedContext, key: string): FxColumns =>
  ctx.fx.get(key) ?? CLEARED_FX_COLUMNS;

export function tripRow(
  userId: string,
  trip: TripFile["trip"],
  name: string,
  color: string,
  ctx: ResolvedContext
): Prisma.TripUncheckedCreateInput {
  return {
    userId,
    name,
    description: trip.description,
    color: trip.color ?? color,
    icon: trip.icon,
    category: trip.category,
    tags: trip.tags,
    status: trip.status ?? "planned",
    startDate: date(trip.startDate),
    endDate: date(trip.endDate),
    startDay: calendar(trip.startDay),
    endDay: calendar(trip.endDay),
    startZone: trip.startZone,
    endZone: trip.endZone,
    originLabel: trip.originLabel,
    destinationLabel: trip.destinationLabel,
    countries: trip.countries,
    ...(trip.private
      ? {
          notes: trip.private.notes,
          summary: trip.private.summary,
          companions: trip.private.companions,
          companionLinks: companionLinks(ctx, trip.private.companions),
        }
      : {}),
  };
}

type Linked = { tripId: string; bookingId: string | null };

export function flightRow(
  userId: string,
  f: TripFileFlight,
  ctx: ResolvedContext,
  link: Linked
): Prisma.FlightUncheckedCreateInput {
  const p = f.private;
  return {
    userId,
    ...link,
    externalRef: f.externalRef,
    flightNumber: f.flightNumber,
    airline: f.airline,
    airlineIata: f.airlineIata,
    airlineIcao: f.airlineIcao,
    operatingAirline: f.operatingAirline,
    operatingAirlineIata: f.operatingAirlineIata,
    operatingAirlineIcao: f.operatingAirlineIcao,
    aircraft: f.aircraft,
    aircraftRegistration: f.aircraftRegistration,
    depIata: f.depIata,
    depIcao: f.depIcao,
    depName: f.depName,
    depLat: f.depLat,
    depLon: f.depLon,
    arrIata: f.arrIata,
    arrIcao: f.arrIcao,
    arrName: f.arrName,
    arrLat: f.arrLat,
    arrLon: f.arrLon,
    departureTime: date(f.departureTime),
    arrivalTime: date(f.arrivalTime),
    depTimezone: f.depTimezone,
    arrTimezone: f.arrTimezone,
    depTimeSemantics: f.depTimeSemantics,
    arrTimeSemantics: f.arrTimeSemantics,
    depPrecision: f.depPrecision,
    arrPrecision: f.arrPrecision,
    status: f.status,
    specialType: f.specialType,
    dataSource: IMPORT_SOURCE,
    lastModifiedBy: "user",
    ...(p
      ? {
          seatNumber: p.seatNumber,
          seatClass: p.seatClass,
          boardingGroup: p.boardingGroup,
          ticketNumber: p.ticketNumber,
          frequentFlyerNumber: p.frequentFlyerNumber,
          bookingClassLetter: p.bookingClassLetter,
          notes: p.notes,
          price: p.price,
          currency: p.currency,
          ...fxOf(ctx, f.key),
          companions: p.companions,
          companionLinks: companionLinks(ctx, p.companions),
        }
      : { currency: null }),
  };
}

export function lodgingRow(userId: string, s: TripFileStay): Prisma.LodgingUncheckedCreateInput {
  const l = s.lodging;
  return {
    userId,
    type: l.type,
    name: l.name,
    address: l.address,
    city: l.city,
    country: l.country,
    isoCountryCode: l.isoCountryCode,
    lat: l.lat,
    lon: l.lon,
    stars: l.stars,
    website: l.website,
    wikidataId: l.wikidataId,
    dataSource: IMPORT_SOURCE,
  };
}

export function stayRow(
  userId: string,
  s: TripFileStay,
  ctx: ResolvedContext,
  link: Linked & { lodgingId: string }
): Prisma.LodgingStayUncheckedCreateInput {
  const p = s.private;
  const fx = fxOf(ctx, s.key);
  return {
    userId,
    ...link,
    externalRef: s.externalRef,
    checkIn: date(s.checkIn),
    checkOut: date(s.checkOut),
    checkInTime: s.checkInTime,
    checkOutTime: s.checkOutTime,
    checkInDate: calendar(s.checkInDate),
    checkOutDate: calendar(s.checkOutDate),
    checkInAt: date(s.checkInAt),
    checkOutAt: date(s.checkOutAt),
    stayZone: s.stayZone,
    datePrecision: s.datePrecision,
    nights: s.nights,
    status: s.status,
    board: s.board,
    roomCategory: s.roomCategory,
    guests: s.guests,
    dataSource: IMPORT_SOURCE,
    ...(p
      ? {
          roomNumber: p.roomNumber,
          ratingRoom: p.ratingRoom,
          ratingBreakfast: p.ratingBreakfast,
          ratingService: p.ratingService,
          ratingOverall: p.ratingOverall,
          pricePerNight: p.pricePerNight,
          totalPrice: p.totalPrice,
          ...(p.currency ? { currency: p.currency } : {}),
          totalPriceBase: fx.priceBase,
          fxRate: fx.fxRate,
          fxRateDate: fx.fxRateDate,
          fxBaseCurrency: fx.fxBaseCurrency,
          fxSource: fx.fxSource,
          notes: p.notes,
          companions: p.companions,
        }
      : {}),
  };
}

const portId = (ctx: ResolvedContext, port: TripFilePortRef | null): number | null =>
  port?.unlocode ? (ctx.ports.get(port.unlocode) ?? null) : null;

export function cruiseRow(
  userId: string,
  c: TripFileCruise,
  ctx: ResolvedContext,
  link: Linked
): Prisma.CruiseUncheckedCreateInput {
  const p = c.private;
  const shipId = c.ship?.imo ? (ctx.ships.get(c.ship.imo) ?? null) : null;
  return {
    userId,
    ...link,
    externalRef: c.externalRef,
    bookingReference: c.bookingReference,
    shipId,
    // A ship the catalogue here does not hold keeps its name as the override.
    shipNameOverride: c.shipNameOverride ?? (shipId === null ? (c.ship?.name ?? null) : null),
    cruiseLine: c.cruiseLine ?? c.ship?.cruiseLine ?? null,
    routeName: c.routeName,
    departurePortId: portId(ctx, c.departurePort),
    arrivalPortId: portId(ctx, c.arrivalPort),
    startDate: date(c.startDate),
    endDate: date(c.endDate),
    startDay: calendar(c.startDay),
    endDay: calendar(c.endDay),
    startZone: c.startZone,
    endZone: c.endZone,
    status: c.status,
    dataSource: IMPORT_SOURCE,
    stops: {
      create: c.stops.map((s) => {
        const id = s.isAtSea ? null : portId(ctx, s.port);
        // The 3-state invariant: a port call this catalogue cannot match keeps
        // its name as an unresolved port, never becomes a sea day.
        const unresolved =
          s.isAtSea || id !== null ? null : (s.unresolvedPortName ?? s.port?.name ?? null);
        return {
          dayNumber: s.dayNumber,
          date: date(s.date),
          isAtSea: s.isAtSea || (id === null && !unresolved),
          portId: id,
          unresolvedPortName: unresolved,
          arrivalTime: date(s.arrivalTime),
          departureTime: date(s.departureTime),
          arrivalUtc: date(s.arrivalUtc),
          departureUtc: date(s.departureUtc),
          stopZone: s.stopZone,
          stopDate: calendar(s.stopDate),
          timePrecision: s.timePrecision,
        };
      }),
    },
    ...(p
      ? {
          cabinNumber: p.cabinNumber,
          cabinType: p.cabinType,
          deck: p.deck,
          price: p.price,
          currency: p.currency,
          ...fxOf(ctx, c.key),
          notes: p.notes,
          companions: p.companions,
          companionLinks: companionLinks(ctx, p.companions),
        }
      : { currency: null }),
  };
}

export function railRow(
  userId: string,
  r: TripFileRail,
  ctx: ResolvedContext,
  link: Linked
): Prisma.RailJourneyUncheckedCreateInput {
  const p = r.private;
  const station = (sourceId: string | null) =>
    sourceId ? (ctx.stations.get(sourceId) ?? null) : null;
  return {
    userId,
    ...link,
    externalRef: r.externalRef,
    operator: r.operator,
    trainCategory: r.trainCategory,
    trainNumber: r.trainNumber,
    bookingReference: r.bookingReference,
    depStationName: r.dep.name,
    depStationCode: r.dep.code,
    depStationId: station(r.dep.sourceId),
    depLat: r.dep.lat,
    depLon: r.dep.lon,
    depCountry: r.dep.country,
    depTimezone: r.dep.timezone,
    arrStationName: r.arr.name,
    arrStationCode: r.arr.code,
    arrStationId: station(r.arr.sourceId),
    arrLat: r.arr.lat,
    arrLon: r.arr.lon,
    arrCountry: r.arr.country,
    arrTimezone: r.arr.timezone,
    departureTime: new Date(r.departureTime),
    arrivalTime: date(r.arrivalTime),
    depPrecision: r.depPrecision,
    arrPrecision: r.arrPrecision,
    distanceKm: r.distanceKm,
    distanceSource: r.distanceSource,
    status: r.status,
    ...(p
      ? {
          travelClass: p.travelClass,
          coach: p.coach,
          seat: p.seat,
          price: p.price,
          currency: p.currency,
          ...fxOf(ctx, r.key),
          notes: p.notes,
          companions: p.companions,
          companionLinks: companionLinks(ctx, p.companions),
        }
      : { currency: null }),
  };
}

export function rentalRow(
  userId: string,
  r: TripFileRental,
  ctx: ResolvedContext,
  tripId: string
): Prisma.RentalBookingUncheckedCreateInput {
  const p = r.private;
  const airport = (iata: string | null) => (iata ? (ctx.airports.get(iata) ?? null) : null);
  return {
    userId,
    tripId,
    externalRef: r.externalRef,
    provider: r.provider,
    operatedBy: r.operatedBy,
    broker: r.broker,
    confirmationNumber: r.confirmationNumber,
    pickupStationName: r.pickup.stationName,
    pickupAddress: r.pickup.address,
    pickupAirportId: airport(r.pickup.airportIata),
    pickupLat: r.pickup.lat,
    pickupLon: r.pickup.lon,
    pickupCountry: r.pickup.country,
    pickupTimezone: r.pickup.timezone,
    returnStationName: r.return.stationName,
    returnAddress: r.return.address,
    returnAirportId: airport(r.return.airportIata),
    returnLat: r.return.lat,
    returnLon: r.return.lon,
    returnCountry: r.return.country,
    returnTimezone: r.return.timezone,
    pickupTime: new Date(r.pickupTime),
    returnTime: new Date(r.returnTime),
    pickupPrecision: r.pickupPrecision,
    returnPrecision: r.returnPrecision,
    vehicleClass: r.vehicleClass,
    acrissCode: r.acrissCode,
    vehicleExample: r.vehicleExample,
    mileagePolicy: r.mileagePolicy,
    mileageCapKm: r.mileageCapKm,
    fuelPolicy: r.fuelPolicy,
    paymentTiming: r.paymentTiming,
    inclusions: r.inclusions,
    arrivalFlightNumber: r.arrivalFlightNumber,
    status: r.status,
    ...(p
      ? {
          brokerReference: p.brokerReference,
          agreementNumber: p.agreementNumber,
          invoiceNumber: p.invoiceNumber,
          vehicleDriven: p.vehicleDriven,
          licensePlate: p.licensePlate,
          odometerOutKm: p.odometerOutKm,
          odometerInKm: p.odometerInKm,
          price: p.price,
          currency: p.currency,
          ...fxOf(ctx, r.key),
          finalAmount: p.finalAmount,
          finalCurrency: p.finalCurrency,
          notes: p.notes,
          companions: p.companions,
          companionLinks: companionLinks(ctx, p.companions),
        }
      : {}),
  };
}
