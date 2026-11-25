import { api } from "./client";
import type { UseConfirmation } from "./serviceUse";
import type { TravTrackDay } from "./travtrack";

/**
 * The optional cleanup of a sparse or noisy TravTrack day (rc46 extras C).
 * Raw points never change: smoothing is a drawing choice, a road match a
 * stored drawing aid whose delete is the undo.
 */

/** `[tMs, lat, lon, accuracyM]`, aligned with the day's `segments`. */
type Vertex = TravTrackDay["segments"][number][number];

export interface TravTrackDayCleanup {
  smoothing: {
    /** A source the day draws from scores below `threshold`. */
    eligible: boolean;
    on: boolean;
    from: "day" | "global";
    global: boolean;
    threshold: number;
  };
  /** `segments` with the low-scoring stretches smoothed; null while off or not eligible. */
  smoothed: Vertex[][] | null;
  matched: TravTrackRoadMatch[];
}

export interface TravTrackRoadMatch {
  id: string;
  fromMs: number;
  untilMs: number;
  /** `[lon, lat]` lines, privacy-cut. */
  lines: [number, number][][];
  confidence: number;
  provider: string;
}

/**
 * Swap in the smoothed stretches for drawing. They have the very shape of the
 * raw ones (same segments, same vertex count), so point ids, details and leg
 * ranges stay aligned. A new object; the answer is not changed.
 */
export function drawnDay(day: TravTrackDay): TravTrackDay {
  const smoothed = day.cleanup?.smoothed;
  const aligned =
    smoothed &&
    smoothed.length === day.segments.length &&
    smoothed.every((s, i) => s.length === day.segments[i].length);
  return aligned ? { ...day, segments: smoothed, smoothedShown: true } : day;
}

export const travTrackCleanupApi = {
  availability: async (): Promise<{ available: boolean; reason: string | null }> =>
    (await api.get("/travtrack/cleanup/availability")).data.mapMatching,
  setSmoothing: async (
    input: { scope: "global"; enabled: boolean } | { scope: "day"; date: string; enabled: boolean }
  ): Promise<void> => {
    await api.put("/travtrack/cleanup/smoothing", input);
  },
  /** One stretch, at most a day; a first use answers 409 CONFIRMATION_REQUIRED (`withUseConsent`). */
  match: async (
    span: { fromMs: number; untilMs: number },
    confirmation?: UseConfirmation
  ): Promise<TravTrackRoadMatch> =>
    (
      await api.post(
        "/travtrack/cleanup/match",
        { ...span, ...(confirmation ? { confirmation } : {}) },
        {
          timeout: 30_000,
        }
      )
    ).data,
  undo: async (id: string): Promise<void> => {
    await api.delete(`/travtrack/cleanup/match/${id}`);
  },
};
