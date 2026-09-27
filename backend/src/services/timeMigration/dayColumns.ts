import { prisma } from "../../db";
import { LocalTimeNonexistentError } from "../../shared/time/errors";
import { localDay, toInstant } from "../../shared/time/instant";
import { toDbDate } from "../../shared/time/localDate";
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
 * The day columns (ADR 0002 phase 3b): lodging stays, trips, journal
 * entries, birthdays — each legacy anchor read with the legacy-day rule
 * (`shared/time/legacyValues.ts`). Two tables need more than the rule:
 *
 * - A lodging stay also gets the instants its check-in and check-out begin —
 *   the day plus its "HH:mm" in the hotel's zone. Without coordinates there is
 *   no zone; a stay with a time of day is then reported, one without is not
 *   (its days are complete as they are).
 * - A trip whose start or end was FILLED FROM ITS SEGMENTS
 *   (`fillTripDatesFromSegments`) holds a real departure/arrival instant, not
 *   a day. Its day is that instant's local day at the airport or station
 *   (owner decision 2026-09-26, open point 1), with the zone. A typed day
 *   keeps the rule and no zone.
 */

function stayInstant(
  day: string,
  time: string,
  place: PlaceZone,
  columnName: string
): { at: Date | null; entry: LedgerEntry } {
  const base = { columnName, legacyValue: time, zone: place.zone };
  if (!place.zone) {
    return {
      at: null,
      entry: { ...base, newValue: null, rule: "lodging.no_zone", reason: place.reason },
    };
  }
  try {
    const at = toInstant(`${day}T${time}`, place.zone, { origin: "typed" }).utc;
    return {
      at,
      entry: { ...base, newValue: iso(at), rule: "lodging.day_and_time", reason: null },
    };
  } catch (error) {
    if (!(error instanceof LocalTimeNonexistentError)) throw error;
    return {
      at: null,
      entry: {
        ...base,
        newValue: null,
        rule: "lodging.day_and_time",
        reason: "local_time_nonexistent",
      },
    };
  }
}

export async function backfillLodgingStays() {
  const done = await ledgeredRowIds("lodging_stays");
  const rows = await prisma.lodgingStay.findMany({
    where: {
      checkInDate: null,
      checkOutDate: null,
      OR: [{ checkIn: { not: null } }, { checkOut: { not: null } }],
    },
    select: {
      id: true,
      userId: true,
      checkIn: true,
      checkOut: true,
      checkInTime: true,
      checkOutTime: true,
      lodging: { select: { lat: true, lon: true } },
    },
    orderBy: { id: "asc" },
  });
  const writes: RowWrite[] = [];
  for (const row of rows.filter((r) => !done.has(r.id))) {
    const place = placeZone({ lat: row.lodging.lat, lon: row.lodging.lon });
    const entries: LedgerEntry[] = [];
    const data: Record<string, unknown> = { stayZone: place.zone };
    for (const [anchor, time, dayKey, atKey, column] of [
      [row.checkIn, row.checkInTime, "checkInDate", "checkInAt", "check_in"],
      [row.checkOut, row.checkOutTime, "checkOutDate", "checkOutAt", "check_out"],
    ] as const) {
      if (!anchor) continue;
      const day = dayColumn(anchor, column, place.zone);
      data[dayKey] = day.value;
      entries.push(day.entry);
      if (time) {
        const instant = stayInstant(day.entry.newValue as string, time, place, `${column}_time`);
        data[atKey] = instant.at;
        entries.push(instant.entry);
      }
    }
    writes.push({ rowId: row.id, userId: row.userId, data, entries });
  }
  return writeRows("lodging_stays", writes, (id, data) =>
    prisma.lodgingStay.update({ where: { id }, data })
  );
}

interface SegmentEnd {
  at: Date;
  zone: string | null;
  lat: number | null;
  lon: number | null;
}

/** The segment end a trip bound was copied from, when it was copied from one. */
function segmentDay(
  bound: Date,
  ends: SegmentEnd[],
  columnName: string
): { value: Date; zone: string | null; entry: LedgerEntry } | null {
  const match = ends.find((e) => e.at.getTime() === bound.getTime());
  if (!match) return null;
  const place: PlaceZone = match.zone ? { zone: match.zone, reason: null } : placeZone(match);
  const day = place.zone ? localDay(bound, place.zone) : bound.toISOString().slice(0, 10);
  return {
    value: toDbDate(day),
    zone: place.zone,
    entry: {
      columnName,
      legacyValue: iso(bound),
      newValue: day,
      zone: place.zone,
      rule: "trip.segment_day",
      reason: place.reason,
    },
  };
}

type Segment = {
  departureTime: Date | null;
  arrivalTime: Date | null;
  depTimezone: string | null;
  arrTimezone: string | null;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
};

function segmentEnds(segments: Segment[]): { starts: SegmentEnd[]; ends: SegmentEnd[] } {
  const starts: SegmentEnd[] = [];
  const ends: SegmentEnd[] = [];
  for (const s of segments) {
    if (s.departureTime) {
      starts.push({ at: s.departureTime, zone: s.depTimezone, lat: s.depLat, lon: s.depLon });
    }
    if (s.arrivalTime) {
      ends.push({ at: s.arrivalTime, zone: s.arrTimezone, lat: s.arrLat, lon: s.arrLon });
    } else if (s.departureTime) {
      ends.push({ at: s.departureTime, zone: s.depTimezone, lat: s.depLat, lon: s.depLon });
    }
  }
  return { starts, ends };
}

const SEGMENT_SELECT = {
  departureTime: true,
  arrivalTime: true,
  depTimezone: true,
  arrTimezone: true,
  depLat: true,
  depLon: true,
  arrLat: true,
  arrLon: true,
} as const;

export async function backfillTrips() {
  const done = await ledgeredRowIds("trips");
  const rows = await prisma.trip.findMany({
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
      flights: { select: SEGMENT_SELECT },
      railJourneys: { select: SEGMENT_SELECT },
    },
    orderBy: { id: "asc" },
  });
  const writes: RowWrite[] = rows
    .filter((r) => !done.has(r.id))
    .map((row) => {
      const { starts, ends } = segmentEnds([...row.flights, ...row.railJourneys]);
      const data: Record<string, unknown> = {};
      const entries: LedgerEntry[] = [];
      for (const [bound, candidates, dayKey, zoneKey, column] of [
        [row.startDate, starts, "startDay", "startZone", "start_date"],
        [row.endDate, ends, "endDay", "endZone", "end_date"],
      ] as const) {
        if (!bound) continue;
        const fromSegment = segmentDay(bound, candidates, column);
        const day = fromSegment ?? { ...dayColumn(bound, column), zone: null };
        data[dayKey] = day.value;
        data[zoneKey] = day.zone;
        entries.push(day.entry);
      }
      return { rowId: row.id, userId: row.userId, data, entries };
    });
  return writeRows("trips", writes, (id, data) => prisma.trip.update({ where: { id }, data }));
}

export async function backfillJournal() {
  const done = await ledgeredRowIds("trip_journal_entries");
  const rows = await prisma.tripJournalEntry.findMany({
    where: { day: null },
    select: { id: true, date: true, trip: { select: { userId: true } } },
    orderBy: { id: "asc" },
  });
  const writes: RowWrite[] = rows
    .filter((r) => !done.has(r.id))
    .map((row) => {
      const day = dayColumn(row.date, "date");
      return {
        rowId: row.id,
        userId: row.trip.userId,
        data: { day: day.value },
        entries: [day.entry],
      };
    });
  return writeRows("trip_journal_entries", writes, (id, data) =>
    prisma.tripJournalEntry.update({ where: { id }, data })
  );
}

export async function backfillBirthdays() {
  const done = await ledgeredRowIds("users");
  const rows = await prisma.user.findMany({
    where: { birthDay: null, birthdate: { not: null } },
    select: { id: true, birthdate: true },
    orderBy: { id: "asc" },
  });
  const writes: RowWrite[] = rows
    .filter((r) => !done.has(r.id))
    .map((row) => {
      const day = dayColumn(row.birthdate as Date, "birthdate");
      return {
        rowId: row.id,
        userId: row.id,
        data: { birthDay: day.value, birthPrecision: "day" },
        entries: [day.entry],
      };
    });
  return writeRows("users", writes, (id, data) => prisma.user.update({ where: { id }, data }));
}
