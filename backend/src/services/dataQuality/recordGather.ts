import { prisma, type DbTransaction } from "../../db";
import { endHasClock } from "../../shared/railClock";
import { isPlaceholderPrecision } from "../../shared/time/legacyValues";
import { localDay } from "../../shared/time/instant";
import { fromDbDate } from "../../shared/time/localDate";
import { isValidZone } from "../../shared/time/zonedParts";
import {
  serializeTime,
  TIME_PRECISIONS,
  type TimePrecision,
  type TimeValue,
} from "../../shared/time/wire";
import {
  localWallClockOf,
  normalizeFlightTimeUtc,
  type FlightTimeSemantics,
} from "../../utils/timezone";
import { getCachedAirports } from "../airportCache";
import { visitLocalDay } from "../places/visitTrip";
import { flightEndZone, tzMapFromAirports } from "../stats/departureClock";

/**
 * The account's travel records, read once and reduced to what the record
 * checks (forgejo#282) compare: keys, calendar days and — only where the time
 * model makes them certain — instants.
 *
 * One query per table, all in parallel, plus one catalogue lookup for every
 * airport code the account uses. Nothing here decides anything; it only states,
 * per row, which day and which moment the row names, and abstains (null) where
 * the stored value cannot say.
 */

/** One end of a flight as the user wrote it. */
export interface FlightEnd {
  iata: string | null;
  icao: string | null;
  name: string | null;
}

interface RecordBase {
  id: string;
  /** The row's own text, as the inbox names it. */
  label: string;
  createdAt: Date;
  dataSource: string | null;
  status: string;
  tripId: string | null;
  /** First and last calendar day the row covers, on its own clock; null when undated. */
  firstDay: string | null;
  lastDay: string | null;
}

export interface FlightRecord extends RecordBase {
  flightNumber: string | null;
  /** The carrier as written — name, else IATA, else ICAO; null when none is named. */
  airline: string | null;
  specialType: string | null;
  isCargo: boolean | null;
  dep: FlightEnd;
  arr: FlightEnd;
  /**
   * Real instants, or null where the time model does not make them certain:
   * a date-only row (12:00 placeholder), an untagged (`UNKNOWN`) row that may
   * still be fake UTC, a legacy row with no zone, a year/month placeholder.
   */
  departureAt: Date | null;
  arrivalAt: Date | null;
}

export interface GroundRecord extends RecordBase {
  /** Train number (rail) or line name (bus), normalised; null when none. */
  service: string | null;
  depKey: string;
  arrKey: string;
  /** The departure instant when it names a time of day, else null. */
  departureAt: Date | null;
}

export interface CruiseRecord extends RecordBase {
  /** Ship id, else the typed ship name, else the route name — normalised. */
  shipKey: string | null;
}

export interface StayRecord extends RecordBase {
  lodgingId: string;
}

/** A place visit linked to a trip; `placeId` is the page it is edited on. */
export interface VisitRecord {
  id: string;
  placeId: string;
  /** The place's name. */
  label: string;
  tripId: string;
  /** The visit's calendar day at the place; null when it cannot be known. */
  day: string | null;
}

/** A ferry ride, for the ferry match (spec 2026-10-25 C3). */
export interface FerryRecord {
  id: string;
  status: string;
  tripId: string | null;
  /** Linked to a roadtrip leg: its trip is the roadtrip's business, never asked. */
  onRoadtrip: boolean;
  depName: string;
  arrName: string;
  /** The departure on the port's own clock — the time model's wire shape. */
  departure: TimeValue;
  firstDay: string | null;
  lastDay: string | null;
}

export interface TripRecord {
  id: string;
  name: string;
  status: string;
  startDay: string | null;
  endDay: string | null;
}

export interface RecordSnapshot {
  flights: FlightRecord[];
  railJourneys: GroundRecord[];
  busJourneys: GroundRecord[];
  ferryJourneys: FerryRecord[];
  cruises: CruiseRecord[];
  stays: StayRecord[];
  trips: TripRecord[];
  /** Place visits that name a trip — only the trip-days check reads them. */
  placeVisits: VisitRecord[];
  /** Every airport code this account uses that the catalogue knows, upper-case. */
  knownAirportCodes: ReadonlySet<string>;
  /**
   * True when the airport catalogue holds no rows at all — a fresh instance
   * before its seed. The unknown-airport check abstains then: every code
   * would be "unknown", and that is a fact about the server, not the data.
   */
  airportCatalogueEmpty: boolean;
}

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** Case and spacing folded, so "Berlin Hbf" and "berlin  hbf" are one station. */
export const normaliseKey = (value: string | null | undefined): string | null =>
  text(value)?.toLocaleUpperCase("en-US").replace(/\s+/g, " ") ?? null;

const arrow = (from: string | null, to: string | null): string => `${from ?? "?"} → ${to ?? "?"}`;

/** `@db.Date` first; else the day part of a legacy midnight value. */
const dayOf = (day: Date | null, legacy: Date | null): string | null =>
  day ? fromDbDate(day) : legacy ? legacy.toISOString().slice(0, 10) : null;

/** A rail or bus end's day on its own clock; the stored UTC day without a zone. */
const groundDay = (at: Date, zone: string | null): string =>
  isValidZone(zone) ? localDay(at, zone) : at.toISOString().slice(0, 10);

/**
 * A flight time as a real instant, or null when it is not certain.
 *
 * `normalizeFlightTimeUtc` is the one rule; this only adds the abstentions a
 * comparison of moments needs: DATE_ONLY is a day, UNKNOWN may be fake UTC.
 */
function certainFlightInstant(
  stored: Date | null,
  semantics: string,
  zone: string | null,
  precision: string | null
): Date | null {
  if (!stored || isPlaceholderPrecision(precision)) return null;
  if (semantics !== "UTC" && semantics !== "LEGACY_FAKE_UTC") return null;
  return normalizeFlightTimeUtc(stored, semantics as FlightTimeSemantics, zone);
}

const NOT_DAY_PRECISE = new Set(["year", "month"]);

const isTimePrecision = (value: string | null): value is TimePrecision =>
  (TIME_PRECISIONS as readonly (string | null)[]).includes(value);

/**
 * The client the snapshot reads through. The global one by default; an answer
 * that re-validates inside its transaction passes the transaction, so it never
 * asks the pool for a second connection while holding row locks.
 */
export type RecordDb = Pick<
  DbTransaction,
  | "flight"
  | "railJourney"
  | "busJourney"
  | "cruise"
  | "lodgingStay"
  | "trip"
  | "airport"
  | "placeVisit"
  | "ferryJourney"
>;

async function loadFlights(userId: string, db: RecordDb) {
  return db.flight.findMany({
    where: { userId },
    orderBy: { id: "asc" },
    select: {
      id: true,
      createdAt: true,
      dataSource: true,
      status: true,
      tripId: true,
      flightNumber: true,
      airline: true,
      airlineIata: true,
      airlineIcao: true,
      specialType: true,
      isCargo: true,
      depIata: true,
      depIcao: true,
      depName: true,
      arrIata: true,
      arrIcao: true,
      arrName: true,
      departureTime: true,
      arrivalTime: true,
      depTimeSemantics: true,
      arrTimeSemantics: true,
      depTimezone: true,
      arrTimezone: true,
      depPrecision: true,
      arrPrecision: true,
    },
  });
}

type FlightRow = Awaited<ReturnType<typeof loadFlights>>[number];

function toFlightRecord(row: FlightRow, tzMap: ReadonlyMap<string, string>): FlightRecord {
  const depZone = flightEndZone(row.depTimezone, tzMap, row.depIata, row.depIcao);
  const arrZone = flightEndZone(row.arrTimezone, tzMap, row.arrIata, row.arrIcao);
  const dayOfEnd = (
    stored: Date | null,
    zone: string | null,
    semantics: string,
    precision: string | null
  ): string | null =>
    stored && !isPlaceholderPrecision(precision)
      ? localWallClockOf(stored, zone, semantics as FlightTimeSemantics, precision).date
      : null;
  const firstDay = dayOfEnd(row.departureTime, depZone, row.depTimeSemantics, row.depPrecision);
  const arrivalDay = dayOfEnd(row.arrivalTime, arrZone, row.arrTimeSemantics, row.arrPrecision);
  const route = arrow(
    row.depIata ?? row.depIcao ?? row.depName,
    row.arrIata ?? row.arrIcao ?? row.arrName
  );
  return {
    id: row.id,
    label: row.flightNumber ? `${row.flightNumber} ${route}` : route,
    createdAt: row.createdAt,
    dataSource: row.dataSource,
    status: row.status,
    tripId: row.tripId,
    firstDay,
    lastDay: firstDay ? (arrivalDay ?? firstDay) : null,
    flightNumber: text(row.flightNumber),
    airline: text(row.airline) ?? text(row.airlineIata) ?? text(row.airlineIcao),
    specialType: row.specialType,
    isCargo: row.isCargo,
    dep: { iata: text(row.depIata), icao: text(row.depIcao), name: text(row.depName) },
    arr: { iata: text(row.arrIata), icao: text(row.arrIcao), name: text(row.arrName) },
    departureAt: certainFlightInstant(
      row.departureTime,
      row.depTimeSemantics,
      depZone,
      row.depPrecision
    ),
    arrivalAt: certainFlightInstant(
      row.arrivalTime,
      row.arrTimeSemantics,
      arrZone,
      row.arrPrecision
    ),
  };
}

interface GroundRow {
  id: string;
  createdAt: Date;
  status: string;
  tripId: string | null;
  depStationName: string;
  arrStationName: string;
  depTimezone: string | null;
  arrTimezone: string | null;
  departureTime: Date;
  arrivalTime: Date | null;
  depPrecision: string | null;
  arrPrecision: string | null;
}

function toGroundRecord(
  row: GroundRow,
  service: string | null,
  depKey: string,
  arrKey: string,
  dataSource: string | null
): GroundRecord {
  const firstDay = NOT_DAY_PRECISE.has(row.depPrecision ?? "")
    ? null
    : groundDay(row.departureTime, row.depTimezone);
  const lastDay =
    row.arrivalTime && !NOT_DAY_PRECISE.has(row.arrPrecision ?? "")
      ? groundDay(row.arrivalTime, row.arrTimezone)
      : firstDay;
  return {
    id: row.id,
    label: arrow(row.depStationName, row.arrStationName),
    createdAt: row.createdAt,
    dataSource,
    status: row.status,
    tripId: row.tripId,
    firstDay,
    lastDay: firstDay ? lastDay : null,
    service,
    depKey,
    arrKey,
    // A `day`-precision ride names no time of day; only a timed one is a moment.
    departureAt: endHasClock(row.depPrecision) ? row.departureTime : null,
  };
}

const GROUND_SELECT = {
  id: true,
  createdAt: true,
  status: true,
  tripId: true,
  depStationName: true,
  arrStationName: true,
  depTimezone: true,
  arrTimezone: true,
  departureTime: true,
  arrivalTime: true,
  depPrecision: true,
  arrPrecision: true,
} as const;

export async function loadRecordSnapshot(
  userId: string,
  db: RecordDb = prisma
): Promise<RecordSnapshot> {
  const [
    flightRows,
    railRows,
    busRows,
    cruiseRows,
    stayRows,
    tripRows,
    anyAirport,
    visitRows,
    ferryRows,
  ] = await Promise.all([
    loadFlights(userId, db),
    db.railJourney.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      select: {
        ...GROUND_SELECT,
        trainCategory: true,
        trainNumber: true,
        depStationId: true,
        depStationCode: true,
        arrStationId: true,
        arrStationCode: true,
      },
    }),
    db.busJourney.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      select: { ...GROUND_SELECT, lineName: true },
    }),
    db.cruise.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        createdAt: true,
        dataSource: true,
        status: true,
        tripId: true,
        shipId: true,
        shipNameOverride: true,
        cruiseLine: true,
        routeName: true,
        startDay: true,
        endDay: true,
        startDate: true,
        endDate: true,
        ship: { select: { name: true } },
      },
    }),
    db.lodgingStay.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        lodgingId: true,
        createdAt: true,
        dataSource: true,
        status: true,
        tripId: true,
        datePrecision: true,
        checkIn: true,
        checkOut: true,
        checkInDate: true,
        checkOutDate: true,
        lodging: { select: { name: true } },
      },
    }),
    db.trip.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        status: true,
        startDay: true,
        endDay: true,
        startDate: true,
        endDate: true,
      },
    }),
    db.airport.findFirst({ select: { id: true } }),
    db.placeVisit.findMany({
      where: { userId, tripId: { not: null } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        placeId: true,
        tripId: true,
        visitedAtUtc: true,
        visitedZone: true,
        visitedPrecision: true,
        place: { select: { name: true } },
      },
    }),
    db.ferryJourney.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      select: { ...GROUND_SELECT, roadtripLegId: true },
    }),
  ]);

  const codes = [
    ...new Set(
      flightRows
        .flatMap((f) => [f.depIata, f.depIcao, f.arrIata, f.arrIcao])
        .map((c) => text(c)?.toUpperCase() ?? null)
        .filter((c): c is string => c !== null)
    ),
  ];
  const airports = codes.length > 0 ? await getCachedAirports(codes, db) : new Map();
  const tzMap = tzMapFromAirports(airports);

  return {
    flights: flightRows.map((row) => toFlightRecord(row, tzMap)),
    railJourneys: railRows.map((row) =>
      toGroundRecord(
        row,
        normaliseKey(
          row.trainNumber
            ? `${row.trainCategory ?? ""}${row.trainNumber}`.replace(/\s+/g, "")
            : null
        ),
        row.depStationId !== null
          ? `#${row.depStationId}`
          : (normaliseKey(row.depStationCode) ?? normaliseKey(row.depStationName) ?? ""),
        row.arrStationId !== null
          ? `#${row.arrStationId}`
          : (normaliseKey(row.arrStationCode) ?? normaliseKey(row.arrStationName) ?? ""),
        null
      )
    ),
    busJourneys: busRows.map((row) =>
      toGroundRecord(
        row,
        normaliseKey(row.lineName),
        normaliseKey(row.depStationName) ?? "",
        normaliseKey(row.arrStationName) ?? "",
        null
      )
    ),
    cruises: cruiseRows.map((row) => {
      const firstDay = dayOf(row.startDay, row.startDate);
      return {
        id: row.id,
        label: row.routeName ?? row.shipNameOverride ?? row.ship?.name ?? row.cruiseLine ?? "",
        createdAt: row.createdAt,
        dataSource: row.dataSource,
        status: row.status,
        tripId: row.tripId,
        firstDay,
        lastDay: dayOf(row.endDay, row.endDate) ?? firstDay,
        shipKey:
          row.shipId !== null
            ? `#${row.shipId}`
            : (normaliseKey(row.shipNameOverride) ?? normaliseKey(row.routeName)),
      };
    }),
    stays: stayRows.map((row) => {
      // Only a DAY-precision stay names days; a month or a year is a placeholder.
      const exact = row.datePrecision === "DAY";
      const firstDay = exact ? dayOf(row.checkInDate, row.checkIn) : null;
      const lastDay = exact ? dayOf(row.checkOutDate, row.checkOut) : null;
      return {
        id: row.id,
        lodgingId: row.lodgingId,
        label: row.lodging.name,
        createdAt: row.createdAt,
        dataSource: row.dataSource,
        status: row.status,
        tripId: row.tripId,
        firstDay: firstDay ?? lastDay,
        lastDay: lastDay ?? firstDay,
      };
    }),
    ferryJourneys: ferryRows.map((row) => {
      const ground = toGroundRecord(row, null, "", "", null);
      return {
        id: row.id,
        status: row.status,
        tripId: row.tripId,
        onRoadtrip: row.roadtripLegId !== null,
        depName: row.depStationName,
        arrName: row.arrStationName,
        departure: serializeTime(
          row.departureTime,
          isValidZone(row.depTimezone) ? row.depTimezone : null,
          isTimePrecision(row.depPrecision) ? row.depPrecision : "minute"
        ),
        firstDay: ground.firstDay,
        // Its own arrival day, or null: `toGroundRecord` falls back to the
        // departure day, and the ferry match must not offer a crossing on an
        // arrival day nobody recorded.
        lastDay:
          row.arrivalTime && !NOT_DAY_PRECISE.has(row.arrPrecision ?? "") ? ground.lastDay : null,
      };
    }),
    trips: tripRows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      startDay: dayOf(row.startDay, row.startDate),
      endDay: dayOf(row.endDay, row.endDate),
    })),
    // `visitLocalDay` is the one rule for a visit's day: it abstains on a
    // visit with no zone or a precision coarser than a day.
    placeVisits: visitRows.map((row) => ({
      id: row.id,
      placeId: row.placeId,
      label: row.place.name,
      tripId: row.tripId as string,
      day: visitLocalDay(row),
    })),
    knownAirportCodes: new Set(airports.keys()),
    airportCatalogueEmpty: anyAirport === null,
  };
}
