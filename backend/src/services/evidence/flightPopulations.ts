import { prisma } from "../../db";
import { countableFlightWhere } from "../../shared/flightCounting";
import { withDepartureClock } from "../stats/departureClock";
import type { FlightTimeSemantics } from "../../utils/timezone";

/**
 * The flight populations the fun and unique measures answer over, and the
 * projections they read.
 *
 * Two populations, not one, because `/stats/fun` and `/stats/unique` each
 * split their input the same way and for the same reason
 * (`utils/stats/funStats.ts`'s header): everything geographic reads the
 * COUNTABLE set (`flown` + `historical`), while everything that reads a
 * clock narrows to `flown` rows carrying BOTH times — a historical row's
 * time is often a 12:00 placeholder, and a time-of-day figure built on a
 * placeholder is a figure about the importer, not the traveller.
 *
 * Four projections rather than one wide select, for the reason Task 13
 * measured on `metricEvidenceFlightCore.ts`: `flightCount` was loading
 * prices, coordinates and a joined booking row to count rows. The panel is
 * one click away from a full scan of the account either way, so the columns
 * it does not need are the part worth not fetching.
 */

function countableFlightsOf(userId: string) {
  return { userId, ...countableFlightWhere() };
}

/**
 * The `flown`-with-both-times subset, as a Prisma `where`. Narrower than
 * `countableFlightWhere()` on purpose — see the module header.
 */
function clockedFlightsOf(userId: string) {
  return {
    userId,
    status: "flown",
    departureTime: { not: null },
    arrivalTime: { not: null },
  };
}

export interface FlightCoordinateRow {
  id: string;
  departureTime: Date | null;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
}

/** Coordinates only: the distance bands, the latitude bands, the longitude rules. */
export async function loadCountableCoordinateRows(userId: string): Promise<FlightCoordinateRow[]> {
  return prisma.flight.findMany({
    where: countableFlightsOf(userId),
    select: {
      id: true,
      departureTime: true,
      depLat: true,
      depLon: true,
      arrLat: true,
      arrLon: true,
    },
  });
}

export interface FlightCo2Row extends FlightCoordinateRow {
  seatClass: string | null;
}

/** `co2FootprintKg` alone — the one measure whose per-flight figure needs the cabin. */
export async function loadCountableCo2Rows(userId: string): Promise<FlightCo2Row[]> {
  return prisma.flight.findMany({
    where: countableFlightsOf(userId),
    select: {
      id: true,
      departureTime: true,
      depLat: true,
      depLon: true,
      arrLat: true,
      arrLon: true,
      seatClass: true,
    },
  });
}

export interface FlightCodeRow {
  id: string;
  departureTime: Date | null;
  depIata: string | null;
  depIcao: string | null;
  arrIata: string | null;
  arrIcao: string | null;
}

/** Airport codes only: the timezone, continent, country and round-trip rules. */
export async function loadCountableCodeRows(userId: string): Promise<FlightCodeRow[]> {
  return prisma.flight.findMany({
    where: countableFlightsOf(userId),
    select: {
      id: true,
      departureTime: true,
      depIata: true,
      depIcao: true,
      arrIata: true,
      arrIcao: true,
    },
  });
}

export interface FlightClockRow extends FlightCodeRow {
  departureTime: Date;
  arrivalTime: Date;
  depTimezone: string | null;
  depTimeSemantics: FlightTimeSemantics;
}

/**
 * The clock-reading subset, with the departure airport's zone already
 * attached by `withDepartureClock` — the same helper `routes/stats.ts` runs
 * before handing rows to either calculator, so a time-of-day figure here is
 * read on exactly the clock the tile read it on (#266).
 *
 * The `departureTime`/`arrivalTime` narrowing is a cast in name only: the
 * `where` above rejects a null in either column, and Prisma's generated type
 * cannot express that.
 */
export async function loadClockedFlightRows(userId: string): Promise<FlightClockRow[]> {
  const rows = await prisma.flight.findMany({
    where: clockedFlightsOf(userId),
    select: {
      id: true,
      departureTime: true,
      arrivalTime: true,
      depIata: true,
      depIcao: true,
      arrIata: true,
      arrIcao: true,
      depTimeSemantics: true,
    },
  });
  const dated = await withDepartureClock(rows);
  return dated.map((row) => ({
    ...row,
    departureTime: row.departureTime as Date,
    arrivalTime: row.arrivalTime as Date,
  }));
}
