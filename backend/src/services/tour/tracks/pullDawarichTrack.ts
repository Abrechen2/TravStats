import type {
  DawarichClient,
  DawarichPoint,
  DawarichPointsWindow,
} from "../../dawarich/dawarichClient";
import { timezoneOfLodging } from "../../../utils/stayInstant";
import { legacyFakeUtcToRealUtc } from "../../../utils/timezone";
import { ingestTrack, IngestedTrack } from "./ingestTrack";
import type { ParsedTrack } from "./parseGpx";

/**
 * Pure logic for task 7 (pull a Dawarich time window into a track), split
 * out of `routes/trips/tourTracks.ts` so that file stays thin — it already
 * holds four endpoints. No Express, no Prisma: the route owns loading the
 * trip/section, resolving the Dawarich connection, and persisting the
 * result; this module only decides WHAT window to pull and turns the raw
 * points into something `ingestTrack` (task 3) can consume.
 */

/** The shape a `TripStop` row needs for `resolveDawarichWindow` below. */
export interface SectionStopDates {
  startDate: Date | null;
  endDate: Date | null;
  /** The stop's position — whose clock its dates are written in. */
  lat?: number | null;
  lon?: number | null;
}

/** Caller-supplied override for either side of the window, or both. */
export interface DawarichWindowOverride {
  startedAt?: Date;
  endedAt?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC is the stop time model's "only the day is known" (frontend `joinDateTimeInput`). */
function isDayOnly(d: Date): boolean {
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
}

/**
 * A stop's stored value is the stop's LOCAL wall clock written as UTC (the
 * stop time model: the user typed 08:00 in Bergen and sees 08:00). Dawarich
 * points are real instants, so the value is re-read in the stop's own zone.
 * A stop without coordinates has no zone to borrow and stays as stored.
 */
function toInstant(wallClock: Date, stop: SectionStopDates): Date {
  const zone = timezoneOfLodging(stop.lat, stop.lon);
  return zone ? legacyFakeUtcToRealUtc(wallClock, zone) : wallClock;
}

/**
 * Resolve the actual `[startAt, endAt]` window to pull from Dawarich: an
 * explicit override wins per side; whichever side is NOT overridden falls
 * back to the section's own span, derived from its stops — the earliest
 * start and the latest end (a one-ended stop contributes its one date to
 * both sides, the same rule `tripDateBounds` applies to cruises).
 *
 * The span is a LOCAL-calendar one. Until 2026-09-26 the stored day anchors
 * were used as UTC instants: a one-day tour asked Dawarich for
 * 00:00Z–00:00Z, an empty window that answered "no location data", and a
 * multi-day tour never pulled its last day. A day-only end now runs to the
 * NEXT local midnight (exclusive), a day-only start from its own local
 * midnight, and a timed value is that wall clock in the stop's zone.
 *
 * Returns `null` when neither an override nor a dated stop can supply a
 * given side — there is nothing to pull, and the caller (the route) turns
 * that into a 400 asking for an explicit window. Does NOT validate that
 * `startAt <= endAt` — a window with one explicit side and one derived
 * side can still come out inverted, and only the route is in a position to
 * report that clearly (it knows which side came from where).
 */
export function resolveDawarichWindow(
  stops: SectionStopDates[],
  override: DawarichWindowOverride
): { startAt: Date; endAt: Date } | null {
  let first: { at: Date; stop: SectionStopDates } | null = null;
  let last: { at: Date; stop: SectionStopDates } | null = null;
  for (const stop of stops) {
    const s = stop.startDate ?? stop.endDate;
    const e = stop.endDate ?? stop.startDate;
    if (s && (!first || s.getTime() < first.at.getTime())) first = { at: s, stop };
    if (e && (!last || e.getTime() > last.at.getTime())) last = { at: e, stop };
  }

  const startAt = override.startedAt ?? (first ? toInstant(first.at, first.stop) : null);
  const endAt =
    override.endedAt ??
    (last
      ? toInstant(isDayOnly(last.at) ? new Date(last.at.getTime() + DAY_MS) : last.at, last.stop)
      : null);
  if (startAt === null || endAt === null) return null;
  return { startAt, endAt };
}

/**
 * A window that reached Dawarich fine but came back with no points at
 * all — a real, distinct outcome from every `DawarichError` kind (the
 * connection worked), so it gets its own error type rather than being
 * folded into one of those kinds or silently stored as a zero-point track.
 */
export class EmptyDawarichWindowError extends Error {
  constructor(
    message: string,
    /** `empty` = no points at all; `tooFewPoints` = one point, no track. */
    public readonly reason: "empty" | "tooFewPoints"
  ) {
    super(message);
    this.name = "EmptyDawarichWindowError";
  }
}

/**
 * Dawarich points -> `ParsedTrack`. The client (`dawarichClient.ts`, task
 * 6) already normalises all four measured Dawarich quirks — bare array,
 * string lat/lon, second-precision timestamp, newest-first ordering — so
 * this is a plain shape conversion, never a second parse or a second sort.
 * `points` is guaranteed non-empty and ascending by the caller below.
 */
function toParsedTrack(points: DawarichPoint[]): ParsedTrack {
  return {
    points: points.map((p): [number, number] => [p.longitude, p.latitude]),
    // One continuous stretch: Dawarich hands back a time-ordered window with
    // no notion of the receiver being switched off, so there is no boundary
    // to carry. A future gap-detection pass would fill this in.
    segmentStarts: [0],
    startedAt: new Date(points[0].timestampMs),
    endedAt: new Date(points[points.length - 1].timestampMs),
    name: null,
  };
}

/** `pullDawarichWindow`'s result: the ingested track plus whether the pull
 * was cut short by `dawarichClient.ts`'s `MAX_PAGES` cap. `truncated` must
 * reach the caller (the route, and from there the stored row and the API
 * response) — it is never enough to only log it, because a track's
 * `distanceKm` looks identical whether it is complete or clipped. */
export interface PulledDawarichTrack {
  ingested: IngestedTrack;
  truncated: boolean;
}

/**
 * Fetch `window` from `client` and run it through the SAME ingestion the
 * GPX upload uses (`ingestTrack`, task 3) — no second simplification, no
 * second distance measurement. Throws `EmptyDawarichWindowError` when the
 * window has no points, or too few to form a track; the caller (the route)
 * turns that into a 409.
 */
export async function pullDawarichWindow(
  client: DawarichClient,
  window: DawarichPointsWindow
): Promise<PulledDawarichTrack> {
  const { points, truncated } = await client.getPoints(window);
  if (points.length === 0) {
    throw new EmptyDawarichWindowError(
      "No location data was found in the requested time window",
      "empty"
    );
  }

  const parsed = toParsedTrack(points);
  const ingested = ingestTrack(parsed);
  if (!ingested) {
    // Reachable: `parsed.startedAt`/`endedAt` are always set above (from
    // real points), so a `null` here means `ingestTrack`'s shared
    // minimum-points rule rejected a window with exactly one point — the
    // one case genuinely distinct from "no points at all" above.
    throw new EmptyDawarichWindowError(
      "The requested time window has too few location points to form a track",
      "tooFewPoints"
    );
  }
  return { ingested, truncated };
}
