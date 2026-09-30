import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { zoneOf } from "../../shared/time/zoneOf";
import { toLocalDateString } from "../../utils/timezone";
import { dayColumn, storedDay } from "../tripSuggestions/time";

/**
 * The day of a day tour (acceptance D2, 2026-09-26).
 *
 * A standalone tour had no date anywhere — neither the "Neue Tour" form nor its
 * points took one — so the trip suggestions, which place every entry by its
 * day, could never include one, although What's New promised they would.
 *
 * `tourDate` is the place's local day (ADR 0002: a DATE, "YYYY-MM-DD" across
 * every boundary); `tourStartMinute` the time of that day the user entered.
 * A recorded track's start prefills the day where the user has not set one.
 */

export interface TourDayInput {
  /** `YYYY-MM-DD`; null clears the day and the start time with it. */
  date?: string | null;
  /** `HH:MM` on that day; null clears it. */
  startTime?: string | null;
}

export interface TourDayColumns {
  tourDate?: Date | null;
  tourStartMinute?: number | null;
}

const MINUTES_PER_HOUR = 60;

function minuteOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * MINUTES_PER_HOUR + m;
}

function timeOf(minute: number): string {
  const h = Math.floor(minute / MINUTES_PER_HOUR);
  const m = minute % MINUTES_PER_HOUR;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const refuse = (message: string): AppError => new AppError(message, 400, "VALIDATION_FAILED");

/**
 * The columns a create or PATCH body writes. `current` is the stored row on a
 * PATCH (null on a create): a start time needs a day, from the body or the row.
 * Only a tour has a day of its own — a roadtrip's days are its stations'.
 */
export function tourDayColumns(
  input: TourDayInput,
  kind: string,
  current: { tourDate: Date | null } | null
): TourDayColumns {
  if (input.date === undefined && input.startTime === undefined) return {};
  if (kind !== "tour") throw refuse("Only a day tour carries a date of its own");
  if (input.date === null) return { tourDate: null, tourStartMinute: null };

  const columns: TourDayColumns = {};
  if (input.date !== undefined) columns.tourDate = dayColumn(input.date);
  if (input.startTime !== undefined) {
    const hasDay = input.date !== undefined || (current?.tourDate ?? null) !== null;
    if (input.startTime !== null && !hasDay) throw refuse("A start time needs the tour's date");
    columns.tourStartMinute = input.startTime === null ? null : minuteOf(input.startTime);
  }
  return columns;
}

/** The day and start time as every tour response carries them. */
export function tourDayDto(row: { tourDate: Date | null; tourStartMinute: number | null }): {
  date: string | null;
  startTime: string | null;
} {
  return {
    date: row.tourDate ? storedDay(row.tourDate) : null,
    startTime: row.tourStartMinute === null ? null : timeOf(row.tourStartMinute),
  };
}

/** `[lon, lat]` of a stored track line's first vertex, or null. */
export function firstVertex(geometry: unknown): { lat: number; lon: number } | null {
  if (!Array.isArray(geometry) || geometry.length === 0) return null;
  const first: unknown = geometry[0];
  if (!Array.isArray(first) || typeof first[0] !== "number" || typeof first[1] !== "number") {
    return null;
  }
  return { lon: first[0], lat: first[1] };
}

/**
 * The local day a recording started, at the place it started — or null when
 * the place's zone is unknown (never read in UTC, ADR 0002 D2).
 */
export function recordedDay(startedAt: Date, geometry: unknown): string | null {
  const at = firstVertex(geometry);
  const zone = at ? zoneOf(at) : null;
  return zone ? toLocalDateString(startedAt, zone) : null;
}

/**
 * Prefill a day tour's date from a recording just stored for it. Only where
 * the tour has no date yet — a date the user set is theirs — and only for a
 * tour; one conditional update, so two recordings racing cannot both win.
 */
export async function prefillTourDateFromTrack(
  routeId: string,
  track: { startedAt: Date; geometry: unknown }
): Promise<void> {
  const day = recordedDay(track.startedAt, track.geometry);
  if (!day) return;
  await prisma.tripRoute.updateMany({
    where: { id: routeId, kind: "tour", tourDate: null },
    data: { tourDate: dayColumn(day) },
  });
}
