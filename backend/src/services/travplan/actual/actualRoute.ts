import { prisma } from "../../../db";
import { classifyStay } from "../../../shared/lodgingCounting";
import { classifyVisit } from "../../../shared/placeCounting";
import { localDay } from "../../../shared/time/instant";
import { fromDbDate, toDbDate } from "../../../shared/time/localDate";
import { tripEntryTrack, type TrackOrigin } from "../../locationProvider/entryTrack";
import type { Coverage } from "../../locationProvider/types";
import type { ZoneCircle } from "../../travtrack/classify";
import { privacyCirclesFor } from "../../travtrack/privacyCircles";
import { privacyCut, privacyCutBy, type LonLat } from "../../travtrack/privacyCut";
import {
  TRIP_RECORDING_TRIP_SELECT,
  tripClockZone,
  type RecordingTrip,
} from "../../tripRecording/bounds";
import { localDayReader } from "../../tripRecording/localDays";
import { privacySafeDevices } from "../../tripRecording/privacySafe";
import {
  displaySegments,
  pointsByDevice,
  recordingDays,
  withoutJitter,
  type DevicePoints,
  type StoredPoint,
} from "../../tripRecording/segments";

/**
 * Where the trip actually went (TravTrack plan L5), for comparing it with the
 * plan. The track is `tripEntryTrack`'s (T5): the own recording, else
 * TravTrack or Dawarich by the account's provider — TravTrack off means
 * TravTrack is simply not a source. So a Dawarich user gets the comparison
 * too, and nothing here reads a provider directly.
 *
 * Privacy (review focus 10, 15): every point inside a circle is gone before
 * anything is counted or compared, and the line is `privacyCut` again on its
 * final, simplified form as it leaves. Own account only: this is read for the
 * owner's plan page and never selected by a share, an export, a public link, a
 * comparison or a federation payload.
 *
 * `positions` and `circles` are for the comparison on the server and are never
 * serialised; the route answers with an explicit shape.
 */

export type ActualPosition = {
  atMs: number;
  /** The day on the trip's clock. */
  day: string;
  lat: number;
  lon: number;
  deviceId: string | null;
};

export type ActualStay = {
  id: string;
  kind: "lodging" | "place";
  day: string;
  lat: number;
  lon: number;
  label: string;
};

export type ActualDay = { day: string; state: "recorded" | "noData" };

export type ActualRoute = {
  segments: LonLat[][];
  days: ActualDay[];
  stays: ActualStay[];
  coverage: Coverage | null;
  origin: TrackOrigin;
  positions: ActualPosition[];
  circles: ZoneCircle[];
};

const DAY_MS = 86_400_000;
const MAX_DAYS = 366;
const addDays = (day: string, n: number): string =>
  fromDbDate(new Date(toDbDate(day).getTime() + n * DAY_MS));

function dayRange(from: string, until: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= until && out.length < MAX_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The trip's days and every recorded day, each said to hold data or not. */
function tripDays(trip: RecordingTrip, recorded: readonly string[]): ActualDay[] {
  const span =
    trip.startDay && trip.endDay
      ? dayRange(fromDbDate(trip.startDay), fromDbDate(trip.endDay))
      : [];
  const has = new Set(recorded);
  return [...new Set([...span, ...recorded])]
    .sort()
    .map((day) => ({ day, state: has.has(day) ? "recorded" : "noData" }));
}

/**
 * The trip's accepted TravStats records with a place and a day: lodging stays
 * that are over (the counting rule: a stay counts once its check-out is past)
 * and place visits that happened. A month- or year-precision stay names no day
 * and is left out rather than spread over invented days.
 */
async function tripStays(userId: string, tripId: string, zone: string): Promise<ActualStay[]> {
  const [lodging, visits] = await Promise.all([
    prisma.lodgingStay.findMany({
      where: { userId, tripId },
      select: {
        id: true,
        status: true,
        checkIn: true,
        checkOut: true,
        checkInDate: true,
        checkOutDate: true,
        datePrecision: true,
        lodging: { select: { name: true, lat: true, lon: true } },
      },
    }),
    prisma.placeVisit.findMany({
      where: { userId, tripId },
      select: {
        id: true,
        visitedAt: true,
        visitedAtUtc: true,
        visitedZone: true,
        place: { select: { name: true, lat: true, lon: true } },
      },
    }),
  ]);
  const stays: ActualStay[] = [];
  for (const s of lodging) {
    const { lat, lon, name } = s.lodging;
    if (lat === null || lon === null || s.datePrecision !== "DAY") continue;
    if (!s.checkInDate || classifyStay(s) !== "visited") continue;
    const until = s.checkOutDate ? fromDbDate(s.checkOutDate) : fromDbDate(s.checkInDate);
    for (const day of dayRange(fromDbDate(s.checkInDate), until)) {
      stays.push({ id: s.id, kind: "lodging", day, lat, lon, label: name });
    }
  }
  for (const v of visits) {
    if (classifyVisit(v) !== "visited") continue;
    const day = v.visitedAtUtc
      ? localDay(v.visitedAtUtc, v.visitedZone ?? zone)
      : v.visitedAt
        ? localDay(v.visitedAt, "UTC") // the legacy column's wall clock, stored as fake UTC
        : null;
    if (!day) continue;
    stays.push({
      id: v.id,
      kind: "place",
      day,
      lat: v.place.lat,
      lon: v.place.lon,
      label: v.place.name,
    });
  }
  return stays;
}

const coord = (p: StoredPoint): LonLat => [p[2], p[1]];

/** Jitter-free, privacy-safe positions, device by device, with their day. */
async function positionsOf(
  devices: readonly DevicePoints[],
  circles: readonly ZoneCircle[],
  zone: string
): Promise<{ positions: ActualPosition[]; stretches: StoredPoint[][] }> {
  const positions: ActualPosition[] = [];
  const stretches: StoredPoint[][] = [];
  const dayOf = localDayReader(zone);
  for (const device of devices) {
    const clean = await withoutJitter([device]);
    for (const stretch of privacyCutBy(clean.segments, circles, coord)) {
      stretches.push(stretch);
      for (const [atMs, lat, lon] of stretch) {
        positions.push({ atMs, day: dayOf(atMs), lat, lon, deviceId: device.deviceId });
      }
    }
  }
  return { positions, stretches };
}

/** Null when the trip is not this user's, or when no source holds a track for it. */
export async function getActualRoute(userId: string, tripId: string): Promise<ActualRoute | null> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: TRIP_RECORDING_TRIP_SELECT,
  });
  if (!trip) return null;
  const [entry, zone] = await Promise.all([
    tripEntryTrack(userId, trip),
    tripClockZone(userId, trip),
  ]);
  if (!entry.origin) return null;

  const raw = pointsByDevice(entry.batches, zone);
  const first = Math.min(...raw.map((d) => d.points[0]?.[0] ?? Infinity));
  const circles = await privacyCirclesFor(userId, Number.isFinite(first) ? first : 0);
  // Whatever a zone hides is gone before anything is counted (T5).
  const safe = privacySafeDevices(raw, circles);
  const recorded = recordingDays(
    safe.flatMap((d) => d.points),
    zone
  );
  const [{ positions, stretches }, stays] = await Promise.all([
    positionsOf(safe, circles, zone),
    tripStays(userId, trip.id, zone),
  ]);
  return {
    // Cut again on the final, simplified line: a chord simplification makes is checked as it leaves.
    segments: privacyCut(displaySegments(stretches), circles),
    days: tripDays(trip, recorded),
    stays,
    coverage: entry.coverage,
    origin: entry.origin,
    positions,
    circles,
  };
}
