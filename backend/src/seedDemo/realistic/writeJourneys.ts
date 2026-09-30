import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { calculateCo2Kg, toSeatClass } from "../../services/co2Calculator";
import { linkRowsFor } from "../../services/companionService";
import { stationColumns } from "../../services/rail/railJourneyWrite";
import { deriveFlightStatus, deriveRailStatus } from "../../shared/statusDerivation";
import { normalizeFlightNumber } from "../../schemas/flight";
import { seedPriceFxColumns } from "../stayFx";
import { AIRLINES } from "./data/airlines";
import { STATIONS } from "./data/stations";
import type { FlightSpec, RailSpec } from "./data/types";
import { companionIds, type AirportRow, type SeedContext } from "./context";
import { demoRailLine } from "./railLines";
import { addDays, localInstant } from "./time";

/**
 * Flights and train rides of one trip. Clocks are the local ones on the
 * ticket, converted at each end's own place; the status comes from the same
 * derivation the routes use, so a ride after "now" is `scheduled` and one
 * before it is done — never the other way round.
 */

/** A delay is a fact about a journey that happened; a planned one has none yet. */
const noted = (delay: number | undefined, done: boolean): number | null =>
  done && delay !== undefined ? delay : null;

const addMinutes = (at: Date, minutes: number): Date => new Date(at.getTime() + minutes * 60_000);

function airport(ctx: SeedContext, code: string): AirportRow {
  const row = ctx.airports.get(code);
  if (!row) throw new Error(`Demo seed: airport ${code} was not loaded`);
  return row;
}

function airlineOf(spec: FlightSpec): { name: string; iata: string | null; icao: string | null } {
  if (spec.no === null) return { name: spec.airline ?? "", iata: null, icao: null };
  const prefix = spec.no.split(" ")[0];
  const airline = AIRLINES[prefix];
  if (!airline) throw new Error(`Demo seed: no airline for flight ${spec.no}`);
  return { name: airline.name, iata: prefix, icao: airline.icao };
}

function flightRow(
  ctx: SeedContext,
  tripId: string | null,
  day: Date,
  spec: FlightSpec,
  companions: string[]
) {
  const dep = airport(ctx, spec.from);
  const arr = airport(ctx, spec.to);
  const departureTime = localInstant(addDays(day, spec.d), spec.dep, dep);
  const arrivalTime = localInstant(addDays(day, spec.d), spec.arr, arr);
  const status =
    spec.status ??
    deriveFlightStatus({ departureTime, arrivalTime, current: "scheduled", now: ctx.now });
  const flown = status === "flown";
  const delayMinutes = noted(spec.delay, flown);
  const airline = airlineOf(spec);
  const seatClass = spec.cls ?? "economy";
  const special = spec.special;
  return {
    userId: ctx.userId,
    tripId,
    airline: airline.name || null,
    airlineIata: airline.iata,
    airlineIcao: airline.icao,
    flightNumber: normalizeFlightNumber(spec.no) ?? null,
    aircraft: spec.aircraft,
    aircraftRegistration: spec.reg ?? null,
    depIcao: dep.icao,
    depIata: dep.iata,
    depName: dep.name,
    depLat: dep.lat,
    depLon: dep.lon,
    arrIcao: arr.icao,
    arrIata: arr.iata,
    arrName: arr.name,
    arrLat: arr.lat,
    arrLon: arr.lon,
    departureTime,
    arrivalTime,
    actualDeparture:
      delayMinutes === null ? null : addMinutes(departureTime, Math.round(delayMinutes * 0.8)),
    actualArrival: delayMinutes === null ? null : addMinutes(arrivalTime, delayMinutes),
    delayMinutes,
    status,
    seatNumber: spec.status === "cancelled" ? null : (spec.seat ?? null),
    seatClass,
    terminal: spec.terminal ?? null,
    gate: spec.gate ?? null,
    notes: spec.notes ?? null,
    companions,
    price: spec.price ?? null,
    currency: spec.price === undefined ? null : "EUR",
    ...seedPriceFxColumns(
      spec.price,
      spec.price === undefined ? null : "EUR",
      departureTime,
      ctx.baseCurrency
    ),
    co2Kg:
      special || spec.status === "cancelled"
        ? null
        : calculateCo2Kg({
            depLat: dep.lat,
            depLon: dep.lon,
            arrLat: arr.lat,
            arrLon: arr.lon,
            seatClass: toSeatClass(seatClass),
          }),
    specialType: special?.type ?? null,
    eventLat: special?.eventLat ?? null,
    eventLon: special?.eventLon ?? null,
    eventLabel: special?.eventLabel ?? null,
    specialData: (special?.data ?? undefined) as Prisma.InputJsonValue | undefined,
    dataSource: "manual",
    lastModifiedBy: "user",
  };
}

export async function writeFlights(
  ctx: SeedContext,
  tripId: string | null,
  day: Date,
  specs: readonly FlightSpec[],
  names: readonly string[],
  category: string
): Promise<number> {
  const ids = companionIds(ctx, names);
  for (const spec of specs) {
    const flight = await prisma.flight.create({
      data: { ...flightRow(ctx, tripId, day, spec, [...names]), category },
    });
    if (ids.length > 0) {
      await prisma.flightCompanion.createMany({
        data: linkRowsFor(ids).map((l) => ({ flightId: flight.id, ...l })),
        skipDuplicates: true,
      });
    }
  }
  return specs.length;
}

export async function writeRail(
  ctx: SeedContext,
  tripId: string | null,
  day: Date,
  specs: readonly RailSpec[],
  names: readonly string[]
): Promise<number> {
  const ids = companionIds(ctx, names);
  for (const spec of specs) {
    const from = STATIONS[spec.from];
    const to = STATIONS[spec.to];
    const departureTime = localInstant(addDays(day, spec.d), spec.dep, from);
    const arrivalTime = localInstant(addDays(day, spec.d), spec.arr, to);
    const status = deriveRailStatus({
      departureTime,
      arrivalTime,
      current: "scheduled",
      now: ctx.now,
    });
    const line = demoRailLine(spec.from, spec.to);
    const currency = spec.price === undefined ? null : (spec.currency ?? "EUR");
    const journey = await prisma.railJourney.create({
      data: {
        userId: ctx.userId,
        tripId,
        operator: spec.operator,
        trainCategory: spec.category,
        trainNumber: spec.number,
        ...stationColumns("dep", {
          name: from.name,
          code: from.uic,
          stationId: from.uic ? (ctx.stationIdByUic.get(from.uic) ?? null) : null,
          lat: from.lat,
          lon: from.lon,
          country: from.country,
        }),
        ...stationColumns("arr", {
          name: to.name,
          code: to.uic,
          stationId: to.uic ? (ctx.stationIdByUic.get(to.uic) ?? null) : null,
          lat: to.lat,
          lon: to.lon,
          country: to.country,
        }),
        departureTime,
        arrivalTime,
        // Routed once, offline, over the OSM rail network (BRouter) and
        // labelled so — the map says "routed", never "from the timetable" —
        // and measured along that line, as a routed journey is.
        geometry: line.geometry as unknown as Prisma.InputJsonValue,
        geometrySource: "brouter",
        distanceKm: line.km,
        distanceSource: "route",
        travelClass: spec.cls,
        coach: spec.coach ?? null,
        seat: spec.seat ?? null,
        price: spec.price ?? null,
        currency,
        ...seedPriceFxColumns(spec.price, currency, departureTime, ctx.baseCurrency),
        status,
        delayMinutes: noted(spec.delay, status === "completed"),
        notes: spec.notes ?? null,
        companions: [...names],
      },
    });
    if (ids.length > 0) {
      await prisma.railJourneyCompanion.createMany({
        data: linkRowsFor(ids).map((l) => ({ railJourneyId: journey.id, ...l })),
        skipDuplicates: true,
      });
    }
  }
  return specs.length;
}
