import type { DawarichClient, DawarichPoint, DawarichPointsWindow } from "../../dawarich/dawarichClient";
import { tripDateBounds } from "../../../shared/statusDerivation";
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
}

/** Caller-supplied override for either side of the window, or both. */
export interface DawarichWindowOverride {
  startedAt?: Date;
  endedAt?: Date;
}

/**
 * Resolve the actual `[startAt, endAt]` window to pull from Dawarich: an
 * explicit override wins per side; whichever side is NOT overridden falls
 * back to the section's own date span, derived from its stops.
 *
 * That fallback reuses `tripDateBounds` (`shared/statusDerivation.ts`)
 * rather than a second earliest-start/latest-end implementation —
 * `TripStop`'s `{startDate, endDate}` shape is structurally identical to
 * the cruise shape that function already accepts, and its two rules
 * (earliest start, latest end, a one-ended row still contributes a
 * point-in-time bound) apply to a section's stops completely unchanged.
 * `flights` is passed as `[]` since a section has no flights of its own.
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
  override: DawarichWindowOverride,
): { startAt: Date; endAt: Date } | null {
  const bounds = tripDateBounds([], stops);
  const startAt = override.startedAt ?? bounds.earliestStart;
  const endAt = override.endedAt ?? bounds.latestEnd;
  if (startAt === null || endAt === null) return null;
  return { startAt, endAt };
}

/**
 * A window that reached Dawarich fine but came back with no points at
 * all — a real, distinct outcome from every `DawarichError` kind (the
 * connection worked), so it gets its own error type rather than being
 * folded into one of those kinds or silently stored as a zero-point track.
 */
export class EmptyDawarichWindowError extends Error {}

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
  window: DawarichPointsWindow,
): Promise<PulledDawarichTrack> {
  const { points, truncated } = await client.getPoints(window);
  if (points.length === 0) {
    throw new EmptyDawarichWindowError(
      "No location data was found in the requested time window",
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
    );
  }
  return { ingested, truncated };
}
