/**
 * The one read interface for positions (TravTrack plan T4): TravTrack and
 * Dawarich answer the same questions in the same shape, so a flight or trip
 * track is computed alike from either. No Dawarich alias anywhere — the shape
 * is TravStats' own.
 */

export type LocationObservation = {
  /** The provider's own id: TravTrack's seq, Dawarich's point id — as a string. */
  ref: string;
  atMs: number;
  lat: number;
  lon: number;
  accuracyM: number | null;
  altitudeM: number | null;
  speedMps: number | null;
  courseDeg: number | null;
  /** The device that recorded it; Dawarich does not say (null). */
  deviceId: string | null;
};

/** `[fromMs, untilMs)`. */
export type ReadWindow = { fromMs: number; untilMs: number };

/**
 * `complete`: the window as the provider holds it. `truncated`: it held more
 * than one read returns. `unreachable`: it could not be read at all. A short
 * read is said to be short, never served as the whole.
 */
export type Coverage = "complete" | "truncated" | "unreachable";

export type ReadResult = { points: LocationObservation[]; next: string | null; coverage: Coverage };

export type CoverageGap = { fromMs: number; untilMs: number; reason: "deleted" | "reported" };

export interface LocationProvider {
  kind: "travtrack" | "dawarich";
  readPoints(window: ReadWindow, cursor?: string): Promise<ReadResult>;
  getCoverage(
    window: ReadWindow
  ): Promise<{ coverage: Coverage; pointCount: number | null; gaps: CoverageGap[] }>;
}

/** Every page of a window, followed to its end. */
export async function readAll(
  provider: LocationProvider,
  window: ReadWindow
): Promise<{ points: LocationObservation[]; coverage: Coverage }> {
  const points: LocationObservation[] = [];
  let cursor: string | undefined;
  let coverage: Coverage = "complete";
  do {
    const page = await provider.readPoints(window, cursor);
    points.push(...page.points);
    if (page.coverage !== "complete") coverage = page.coverage;
    cursor = page.next ?? undefined;
  } while (cursor);
  return { points, coverage };
}
