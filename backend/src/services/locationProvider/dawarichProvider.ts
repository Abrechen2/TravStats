import { createDawarichClient } from "../dawarich/dawarichClient";
import type { DawarichConnection } from "../dawarich/errors";
import logger from "../../utils/logger";
import type { LocationProvider, ReadResult, ReadWindow } from "./types";

/**
 * The user's Dawarich as a `LocationProvider` (TravTrack plan T4). Read-only —
 * nothing is ever written into or deleted from Dawarich (rule 5).
 *
 * Dawarich's window is inclusive on both ends, so `[from, until)` becomes
 * `endAt = until - 1`. The client already pages up to its ceiling and says
 * `truncated` when the window held more; there is no cursor past that. Any
 * failure is an answer — `unreachable`, logged — never a throw into an entry
 * page, which keeps showing whatever else it holds.
 */
export function dawarichProvider(connection: DawarichConnection): LocationProvider {
  const client = createDawarichClient(connection);
  const read = async (window: ReadWindow): Promise<ReadResult> => {
    try {
      const { points, truncated } = await client.getPoints({
        startAt: new Date(window.fromMs),
        endAt: new Date(window.untilMs - 1),
      });
      return {
        points: points
          .filter((p) => p.timestampMs >= window.fromMs && p.timestampMs < window.untilMs)
          .map((p) => ({
            ref: String(p.id),
            atMs: p.timestampMs,
            lat: p.latitude,
            lon: p.longitude,
            accuracyM: p.accuracy,
            altitudeM: p.altitude,
            speedMps: p.velocity,
            courseDeg: null,
            deviceId: null,
          })),
        next: null,
        coverage: truncated ? "truncated" : "complete",
      };
    } catch (error) {
      logger.warn({ operation: "location_provider_dawarich_read_failed", error });
      return { points: [], next: null, coverage: "unreachable" };
    }
  };
  return {
    kind: "dawarich",
    readPoints: (window) => read(window),
    async getCoverage(window) {
      const result = await read(window);
      return {
        coverage: result.coverage,
        pointCount: result.coverage === "unreachable" ? null : result.points.length,
        gaps: [],
      };
    },
  };
}
