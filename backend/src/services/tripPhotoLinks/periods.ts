/**
 * Trip-level period links (docs/superpowers/specs/2026-11-26-trip-photo-links.md,
 * decision 1): the photos a library holds for a trip's days, read at request time
 * and streamed through the proxy — no byte is stored.
 *
 * PhotoPrism is the source of truth (owner, 2026-11-26): it holds every photo, Immich
 * only the phone's subset. A period is therefore read from PhotoPrism whenever the
 * account has it, and from Immich only when PhotoPrism is not connected — querying
 * both would show the same picture twice.
 */
import { prisma } from "../../db";
import { haversineKm } from "../../shared/geo/haversine";
import { localDay, toInstant } from "../../shared/time/instant";
import { profileZoneOf } from "../../shared/time/profileZone";
import { getCachedAlbumAssets } from "../immich/immichAssetCache";
import { createPhotoSource, type PhotoSourceKind } from "../photoSource";
import type { PhotoSourceAsset } from "../photoSource/types";
import { getPhotoSourceConnection, toPhotoSourceKind } from "../photoSource/connection";
import { privacyCircleSet } from "../travtrack/privacyCircles";

export interface DayRange {
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  until: string;
}

export interface TripDates {
  startDay: Date | null;
  endDay: Date | null;
  startDate: Date | null;
  endDate: Date | null;
  startZone: string | null;
  endZone: string | null;
}

export interface StoredPeriod {
  id: string;
  provider: string;
  fromDay: Date | null;
  untilDay: Date | null;
}

export type PeriodAssets = PhotoSourceAsset[] & { truncated?: boolean };

/** Day columns store the calendar day as UTC midnight (ADR 0002, D1). */
const dayOfColumn = (value: Date): string => value.toISOString().slice(0, 10);

/** The trip's first and last calendar day, or null when it has no date at all. */
export function tripDayRange(trip: TripDates, zone: string): DayRange | null {
  const from = trip.startDay
    ? dayOfColumn(trip.startDay)
    : trip.startDate
      ? localDay(trip.startDate, trip.startZone ?? zone)
      : null;
  if (from === null) return null;
  const end = trip.endDay
    ? dayOfColumn(trip.endDay)
    : trip.endDate
      ? localDay(trip.endDate, trip.endZone ?? zone)
      : from;
  return { from, until: end < from ? from : end };
}

/**
 * The days a period covers: its own pinned days, else the trip's — so an unpinned
 * period follows the trip when the trip's dates change. Null when neither says.
 */
export function periodDays(period: StoredPeriod, tripDays: DayRange | null): DayRange | null {
  if (period.fromDay === null && period.untilDay === null) return tripDays;
  const from = period.fromDay
    ? dayOfColumn(period.fromDay)
    : (tripDays?.from ?? dayOfColumn(period.untilDay!));
  const until = period.untilDay ? dayOfColumn(period.untilDay) : (tripDays?.until ?? from);
  return { from, until: until < from ? from : until };
}

/** First and last instant of the days, read in the trip's zones (the first day at its start zone). */
export function dayRangeWindow(
  days: DayRange,
  startZone: string,
  endZone: string
): { start: Date; end: Date } {
  return {
    start: toInstant(`${days.from}T00:00:00`, startZone, { origin: "machine" }).utc,
    end: toInstant(`${days.until}T23:59:59`, endZone, { origin: "machine" }).utc,
  };
}

/**
 * The provider a NEW period link reads: PhotoPrism when connected, Immich only as the
 * fallback, null when the account has neither.
 */
export async function preferredPeriodProvider(userId: string): Promise<PhotoSourceKind | null> {
  if (await getPhotoSourceConnection("photoprism", userId)) return "photoprism";
  if (await getPhotoSourceConnection("immich", userId)) return "immich";
  return null;
}

/** The cache key a period's search lives under (the album cache holds it beside albums). */
export const periodCacheKey = (days: DayRange, zones: { start: string; end: string }): string =>
  `period:${days.from}:${days.until}:${zones.start}:${zones.end}`;

/**
 * The images of one period: library-wide search over the window, re-checked against the
 * window (a source may answer a wider set), without undated photos (abstention) and
 * without anything taken inside a privacy zone — a period is not curated like an album,
 * so a photo at home before departure would otherwise land on the trip.
 * Throws `ImmichError` (the kind vocabulary) when the source fails.
 */
export async function loadPeriodAssets(
  userId: string,
  provider: PhotoSourceKind,
  days: DayRange,
  zones: { start: string; end: string }
): Promise<PeriodAssets | null> {
  const connection = await getPhotoSourceConnection(provider, userId);
  if (connection === null) return null;
  const { start, end } = dayRangeWindow(days, zones.start, zones.end);
  const startMs = start.getTime();
  const endMs = end.getTime();
  return (await getCachedAlbumAssets(
    userId,
    periodCacheKey(days, zones),
    async () => {
      const found = await createPhotoSource(provider, connection).searchAssetsByTime({
        takenAfter: start,
        takenBefore: end,
      });
      const circles = await privacyCircleSet(userId);
      const kept: PeriodAssets = found.assets.filter((a) => {
        if (a.type !== "IMAGE" || a.fileCreatedAt === null) return false;
        const at = Date.parse(a.fileCreatedAt);
        if (!Number.isFinite(at) || at < startMs || at > endMs) return false;
        if (a.lat === null || a.lon === null) return true;
        return !circles(at).some(
          (c) => haversineKm({ lat: a.lat!, lon: a.lon! }, c) * 1000 <= c.radiusM
        );
      });
      if (found.truncated) kept.truncated = true;
      return kept;
    },
    provider
  )) as PeriodAssets;
}

export interface TripPeriodContext {
  trip: TripDates & { id: string };
  zone: string;
  tripDays: DayRange | null;
}

/** The trip's dates and the user's profile zone — what every period computation needs. */
export async function tripPeriodContext(
  userId: string,
  tripId: string
): Promise<TripPeriodContext | null> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: {
      id: true,
      startDay: true,
      endDay: true,
      startDate: true,
      endDate: true,
      startZone: true,
      endZone: true,
    },
  });
  if (!trip) return null;
  const { zone } = await profileZoneOf(userId);
  return { trip, zone, tripDays: tripDayRange(trip, zone) };
}

/** The zones a period window is read in. */
export const windowZones = (ctx: TripPeriodContext): { start: string; end: string } => ({
  start: ctx.trip.startZone ?? ctx.zone,
  end: ctx.trip.endZone ?? ctx.zone,
});

/** A stored period as the provider vocabulary knows it. */
export const periodProvider = (p: StoredPeriod): PhotoSourceKind => toPhotoSourceKind(p.provider);
