import { useEffect, useState } from "react";
import { trackErrorKey } from "../../../lib/api/travtrack";
import { travTrackViewsApi } from "../../../lib/api/travtrackViews";
import { logger } from "../../../lib/logger";
import { lonLat, type LonLat } from "./trackGeometry";
import { readRangeParts } from "./useRangeRead";

/** At most this many range parts for one flight: a long-haul flight is a handful. */
export const FLIGHT_TRACK_MAX_PARTS = 8;

export type FlightTrackState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; lines: LonLat[][]; partial: boolean }
  | { kind: "failed"; key: string };

/**
 * The open flight's whole line for the map (owner 2026-10-26, "den kompletten
 * Flug zeigen"): the server's range read over the flight's own instants, so a
 * flight past midnight is drawn whole while the day stays the day. The
 * privacy-safe stretches of every part are kept side by side and never joined
 * — neither inside a part nor across two. Bounded: past
 * FLIGHT_TRACK_MAX_PARTS the line drawn is what arrived, marked `partial`.
 */
export function useFlightTrack(
  window: { fromMs: number; untilMs: number } | null,
  generation = 0
): FlightTrackState {
  const [state, setState] = useState<FlightTrackState>({ kind: "idle" });
  const from = window?.fromMs ?? null;
  const until = window?.untilMs ?? null;

  useEffect(() => {
    if (from === null || until === null || !(until > from)) {
      setState({ kind: "idle" });
      return;
    }
    let live = true;
    const lines: LonLat[][] = [];
    let parts = 0;
    let partial = false;
    setState({ kind: "loading" });
    readRangeParts(
      { from: new Date(from).toISOString(), to: new Date(until).toISOString() },
      travTrackViewsApi.range,
      (part) => {
        if (!live) return false;
        for (const stretch of part.segments)
          if (stretch.length > 1) lines.push(stretch.map(lonLat));
        parts += 1;
        if (parts >= FLIGHT_TRACK_MAX_PARTS && part.next) {
          partial = true;
          return false;
        }
        return true;
      },
      null,
      () => live
    )
      .then(() => {
        if (live) setState({ kind: "loaded", lines, partial });
      })
      .catch((err: unknown) => {
        logger.warn("TravTrack flight track could not be loaded", err);
        if (live) setState({ kind: "failed", key: trackErrorKey(err) });
      });
    return () => {
      live = false;
    };
  }, [from, until, generation]);

  return state;
}
