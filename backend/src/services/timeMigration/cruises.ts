import { prisma } from "../../db";
import type { TimeMigrationReason } from "../../schemas/timeMigration";
import { fakeUtcToInstant } from "../../shared/time/legacyValues";
import { toDbDate } from "../../shared/time/localDate";
import type { TimePrecision } from "../../shared/time/wire";
import {
  dayColumn,
  iso,
  ledgeredRowIds,
  placeZone,
  writeRows,
  type LedgerEntry,
  type PlaceZone,
  type RowWrite,
} from "./core";

/**
 * Cruises and their stops (ADR 0002 phase 3b).
 *
 * A port call's `arrivalTime`/`departureTime` are the PORT's wall clock stored
 * as fake UTC; with the port's zone (catalogue, then coordinates) they become
 * real instants. A sea day and an unresolved port have no zone: their times
 * stay in the legacy columns (and in the ledger), the precision says
 * `unknown`, and the owner is asked — when the user later resolves the port,
 * the write path converts from there. The stop's day and the cruise's
 * start/end days follow the legacy-day rule.
 */

type PortRow = { timezone: string | null; lat: number; lon: number } | null;

function zoneOfStop(stop: { isAtSea: boolean; port: PortRow }): PlaceZone {
  if (stop.port) {
    return placeZone({ catalogueZone: stop.port.timezone, lat: stop.port.lat, lon: stop.port.lon });
  }
  return { zone: null, reason: stop.isAtSea ? "sea_day_time" : "port_unresolved" };
}

interface StopRow {
  id: string;
  date: Date | null;
  isAtSea: boolean;
  arrivalTime: Date | null;
  departureTime: Date | null;
  port: PortRow;
  cruise: { userId: string };
}

function timeAt(
  time: Date,
  place: PlaceZone,
  columnName: string
): { utc: Date | null; entry: LedgerEntry } {
  const base = { columnName, legacyValue: iso(time), zone: place.zone };
  if (place.zone === null) {
    const reason: TimeMigrationReason = place.reason;
    return { utc: null, entry: { ...base, newValue: null, rule: "cruise_stop.no_zone", reason } };
  }
  const reading = fakeUtcToInstant(time, place.zone);
  if (reading.status === "nonexistent") {
    return {
      utc: null,
      entry: {
        ...base,
        newValue: null,
        rule: "cruise_stop.port_call",
        reason: "local_time_nonexistent",
      },
    };
  }
  return {
    utc: reading.utc,
    entry: {
      ...base,
      newValue: iso(reading.utc),
      rule: reading.ambiguous ? "cruise_stop.port_call_fold_earlier" : "cruise_stop.port_call",
      reason: null,
    },
  };
}

function stopWrite(stop: StopRow): RowWrite {
  const place = zoneOfStop(stop);
  const arrival = stop.arrivalTime ? timeAt(stop.arrivalTime, place, "arrival_time") : null;
  const departure = stop.departureTime ? timeAt(stop.departureTime, place, "departure_time") : null;
  const times = [arrival, departure].filter((t) => t !== null);
  const entries: LedgerEntry[] = times.map((t) => t.entry);

  let stopDate: Date | null = null;
  if (stop.date) {
    const day = dayColumn(stop.date, "date", place.zone);
    stopDate = day.value;
    entries.push(day.entry);
  } else {
    // No day anchor: the first wall clock's own date IS the local day.
    const firstClock = stop.arrivalTime ?? stop.departureTime;
    if (firstClock) stopDate = toDbDate(firstClock.toISOString().slice(0, 10));
  }
  const precision: TimePrecision | null =
    times.length > 0
      ? times.every((t) => t.utc !== null)
        ? "minute"
        : "unknown"
      : stopDate
        ? "day"
        : null;
  return {
    rowId: stop.id,
    userId: stop.cruise.userId,
    data: {
      arrivalUtc: arrival?.utc ?? null,
      departureUtc: departure?.utc ?? null,
      stopZone: place.zone,
      stopDate,
      timePrecision: precision,
    },
    entries,
  };
}

export async function backfillCruiseStops() {
  const done = await ledgeredRowIds("cruise_stops");
  const rows = await prisma.cruiseStop.findMany({
    where: {
      timePrecision: null,
      stopDate: null,
      OR: [
        { date: { not: null } },
        { arrivalTime: { not: null } },
        { departureTime: { not: null } },
      ],
    },
    select: {
      id: true,
      date: true,
      isAtSea: true,
      arrivalTime: true,
      departureTime: true,
      port: { select: { timezone: true, lat: true, lon: true } },
      cruise: { select: { userId: true } },
    },
    orderBy: { id: "asc" },
  });
  return writeRows("cruise_stops", rows.filter((r) => !done.has(r.id)).map(stopWrite), (id, data) =>
    prisma.cruiseStop.update({ where: { id }, data })
  );
}

export async function backfillCruises() {
  const done = await ledgeredRowIds("cruises");
  const rows = await prisma.cruise.findMany({
    where: {
      startDay: null,
      endDay: null,
      OR: [{ startDate: { not: null } }, { endDate: { not: null } }],
    },
    select: {
      id: true,
      userId: true,
      startDate: true,
      endDate: true,
      departurePort: { select: { timezone: true, lat: true, lon: true } },
      arrivalPort: { select: { timezone: true, lat: true, lon: true } },
    },
    orderBy: { id: "asc" },
  });
  const portZone = (port: PortRow): string | null =>
    port ? placeZone({ catalogueZone: port.timezone, lat: port.lat, lon: port.lon }).zone : null;
  const writes: RowWrite[] = rows
    .filter((r) => !done.has(r.id))
    .map((row) => {
      const startZone = row.startDate ? portZone(row.departurePort) : null;
      const endZone = row.endDate ? portZone(row.arrivalPort) : null;
      const start = row.startDate ? dayColumn(row.startDate, "start_date", startZone) : null;
      const end = row.endDate ? dayColumn(row.endDate, "end_date", endZone) : null;
      return {
        rowId: row.id,
        userId: row.userId,
        data: {
          startDay: start?.value ?? null,
          endDay: end?.value ?? null,
          startZone,
          endZone,
        },
        entries: [start?.entry, end?.entry].filter((e): e is LedgerEntry => Boolean(e)),
      };
    });
  return writeRows("cruises", writes, (id, data) => prisma.cruise.update({ where: { id }, data }));
}
