import { prisma } from "../../db";
import { fakeUtcToInstant, startOfDayAt } from "../../shared/time/legacyValues";
import { fromDbDate } from "../../shared/time/localDate";
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
 * Trip stops (ADR 0002 phase 3b). Two kinds share the table:
 *
 * - a timeline stop, whose `startDate`/`endDate` are its wall clock stored as
 *   fake UTC → real instants in the stop's zone, precision `minute`;
 * - a roadtrip station (`domain = "roadtrip"`), dated by the DAYS it was
 *   slept at → the legacy-day rule, the instant that day begins at the
 *   station, precision `day`.
 *
 * The zone comes from the stop's coordinates, or — for a stop without them —
 * from the entry it wraps (`sourceId`: a place, a lodging, a flight's
 * departure). Without either it is reported, never read as UTC.
 */

interface StopRow {
  id: string;
  domain: string | null;
  sourceId: string | null;
  lat: number | null;
  lon: number | null;
  startDate: Date | null;
  endDate: Date | null;
  trip: { userId: string } | null;
  route: { userId: string } | null;
}

/** Coordinates of the entry a coordinate-less stop wraps, if it names one. */
async function wrappedPlace(
  sourceId: string
): Promise<{ lat: number | null; lon: number | null } | null> {
  const place = await prisma.place.findUnique({
    where: { id: sourceId },
    select: { lat: true, lon: true },
  });
  if (place) return place;
  const lodging = await prisma.lodging.findUnique({
    where: { id: sourceId },
    select: { lat: true, lon: true },
  });
  if (lodging) return lodging;
  const flight = await prisma.flight.findUnique({
    where: { id: sourceId },
    select: { depLat: true, depLon: true },
  });
  return flight ? { lat: flight.depLat, lon: flight.depLon } : null;
}

async function zoneOfStop(stop: StopRow): Promise<PlaceZone> {
  const own = placeZone({ lat: stop.lat, lon: stop.lon });
  if (own.zone || own.reason !== "no_position" || !stop.sourceId) return own;
  const wrapped = await wrappedPlace(stop.sourceId);
  return wrapped ? placeZone(wrapped) : own;
}

function stationWrite(stop: StopRow, place: PlaceZone): Pick<RowWrite, "data" | "entries"> {
  const ends = (["start", "end"] as const).map((key) => {
    const anchor = key === "start" ? stop.startDate : stop.endDate;
    if (!anchor) return null;
    const day = dayColumn(anchor, `${key}_date`, place.zone);
    const utc = place.zone ? startOfDayAt(fromDbDate(day.value), place.zone) : null;
    const entry: LedgerEntry = {
      ...day.entry,
      rule: `trip_stop.station_${day.entry.rule}`,
      newValue: utc ? iso(utc) : null,
      reason: day.entry.reason ?? place.reason,
    };
    return { utc, entry };
  });
  return {
    data: {
      startUtc: ends[0]?.utc ?? null,
      endUtc: ends[1]?.utc ?? null,
      stopZone: place.zone,
      precision: place.zone ? "day" : "unknown",
    },
    entries: ends.filter((e) => e !== null).map((e) => e.entry),
  };
}

function timelineWrite(stop: StopRow, place: PlaceZone): Pick<RowWrite, "data" | "entries"> {
  const ends = (["start", "end"] as const).map((key) => {
    const time = key === "start" ? stop.startDate : stop.endDate;
    if (!time) return null;
    const base = { columnName: `${key}_date`, legacyValue: iso(time), zone: place.zone };
    if (!place.zone) {
      return {
        utc: null,
        entry: { ...base, newValue: null, rule: "trip_stop.no_zone", reason: place.reason },
      };
    }
    const reading = fakeUtcToInstant(time, place.zone);
    if (reading.status === "nonexistent") {
      return {
        utc: null,
        entry: {
          ...base,
          newValue: null,
          rule: "trip_stop.fake_utc",
          reason: "local_time_nonexistent" as const,
        },
      };
    }
    return {
      utc: reading.utc,
      entry: {
        ...base,
        newValue: iso(reading.utc),
        rule: reading.ambiguous ? "trip_stop.fake_utc_fold_earlier" : "trip_stop.fake_utc",
        reason: null,
      },
    };
  });
  const present = ends.filter((e) => e !== null);
  const precision: TimePrecision = present.every((e) => e.utc !== null) ? "minute" : "unknown";
  return {
    data: {
      startUtc: ends[0]?.utc ?? null,
      endUtc: ends[1]?.utc ?? null,
      stopZone: place.zone,
      precision,
    },
    entries: present.map((e) => e.entry),
  };
}

export async function backfillTripStops() {
  const done = await ledgeredRowIds("trip_stops");
  const rows = await prisma.tripStop.findMany({
    where: {
      precision: null,
      OR: [{ startDate: { not: null } }, { endDate: { not: null } }],
    },
    select: {
      id: true,
      domain: true,
      sourceId: true,
      lat: true,
      lon: true,
      startDate: true,
      endDate: true,
      trip: { select: { userId: true } },
      route: { select: { userId: true } },
    },
    orderBy: { id: "asc" },
  });
  const writes: RowWrite[] = [];
  for (const stop of rows.filter((r) => !done.has(r.id))) {
    const place = await zoneOfStop(stop);
    const write =
      stop.domain === "roadtrip" ? stationWrite(stop, place) : timelineWrite(stop, place);
    writes.push({
      rowId: stop.id,
      userId: stop.trip?.userId ?? stop.route?.userId ?? null,
      ...write,
    });
  }
  return writeRows("trip_stops", writes, (id, data) =>
    prisma.tripStop.update({ where: { id }, data })
  );
}
