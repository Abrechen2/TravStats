import type { Prisma } from "../../prisma";
import {
  readAll,
  type Coverage,
  type LocationObservation,
  type LocationProvider,
} from "../locationProvider/types";

import { classifyPoint, tripRecordingBounds, type RecordingTrip } from "./bounds";
import { storedPoints, type RecordingBatchRow, type StoredPoint } from "./segments";

/**
 * A trip's share of the account's location history (TravTrack plan T4; from
 * the archived `historyPoints.ts`, rewritten onto the `LocationProvider`
 * interface): what the provider holds for the trip's days, as one batch per
 * device — the shape of the trip recording's own batches (forgejo#316), so the
 * map, the day filter, the GPX and the jitter filter read both alike.
 *
 * Like the trip recording, a point inside a flight's recorder window stays
 * out: the flight has those hours, and the trip track shows them as a break —
 * an explicit one (`RecordingBreak`), carried to the map and the GPX.
 * A point the trip recording also holds (same device, same second, same
 * position) is shown once. `extra` are observations the caller adds — the
 * TravTrack points linked to the trip — deduplicated by the provider's ref.
 *
 * The answer carries the provider's coverage: a truncated or unreachable read
 * is said to be one, never served as the whole recording.
 */
export type HistoryBatches = {
  batches: RecordingBatchRow[];
  coverage: Coverage | null;
};

export async function locationHistoryBatches(
  userId: string,
  trip: RecordingTrip,
  provider: LocationProvider | null,
  opts: { legacy?: readonly RecordingBatchRow[]; extra?: readonly LocationObservation[] } = {}
): Promise<HistoryBatches> {
  if (!provider) return { batches: [], coverage: null };
  const bounds = await tripRecordingBounds(userId, trip);
  if (!bounds) return { batches: [], coverage: null };
  const read = await readAll(provider, { fromMs: bounds.fromMs, untilMs: bounds.untilMs });

  const key = (deviceId: string | null, p: StoredPoint) =>
    `${deviceId}|${Math.floor(p[0] / 1000)}|${p[1]}|${p[2]}`;
  const held = new Set(
    (opts.legacy ?? []).flatMap((b) => storedPoints(b.points).map((p) => key(b.deviceId, p)))
  );
  const seen = new Set<string>();
  const byDevice = new Map<string | null, StoredPoint[]>();
  const observations = [...read.points, ...(opts.extra ?? [])].sort((a, b) => a.atMs - b.atMs);
  for (const o of observations) {
    if (seen.has(o.ref)) continue;
    seen.add(o.ref);
    const point: StoredPoint = [o.atMs, o.lat, o.lon, o.accuracyM];
    // A linked fix may lie outside the trip's days; the flight window stays a break.
    const verdict = classifyPoint(o.atMs, bounds);
    if (verdict === "inFlight" || held.has(key(o.deviceId, point))) continue;
    if (verdict === "outsideTrip" && !(opts.extra ?? []).includes(o)) continue;
    const list = byDevice.get(o.deviceId) ?? [];
    list.push(point);
    byDevice.set(o.deviceId, list);
  }
  return {
    // The flight windows go along as explicit breaks: with their points left
    // out, two fixes either side of a short flight are close enough in time and
    // space for the gap rule to join them, and the line would fly the plane.
    batches: [...byDevice.entries()].map(([deviceId, points]) => ({
      deviceId,
      points: points as unknown as Prisma.JsonValue,
      breaks: bounds.flightWindows,
    })),
    coverage: read.coverage,
  };
}
