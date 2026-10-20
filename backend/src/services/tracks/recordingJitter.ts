import type { ParsedTrack } from "../tour/tracks/parseGpx";
import { filterJitter, type JitterFix } from "./jitterFilter";
import { JITTER_PROFILES, type JitterMode } from "./jitterProfiles";

/**
 * The jitter filter (`jitterFilter.ts`) on a `ParsedTrack` — the shape every
 * stored recording passes through on its way to `ingestTrack`. Run FIRST,
 * before holes are marked, before measuring, before simplifying: a teleport
 * spike 60 km out would otherwise be read as two holes by `splitAtLongSteps`,
 * and the stay cloud at a gate would be measured as kilometres.
 *
 * The recording's window (`startedAt`/`endedAt`) is the phone's and is kept
 * as it came: a stay collapsed at the start still began when it began.
 */
export function filterParsedTrack(parsed: ParsedTrack, mode: JitterMode): ParsedTrack {
  const total = parsed.points.length;
  const aligned = <T>(values: Array<T | null> | undefined): values is Array<T | null> =>
    Array.isArray(values) && values.length === total;
  const times = aligned(parsed.times) ? parsed.times : undefined;
  const accuracies = aligned(parsed.accuracies) ? parsed.accuracies : undefined;
  const elevations = aligned(parsed.elevations) ? parsed.elevations : undefined;

  const fixes: JitterFix[] = parsed.points.map(([lon, lat], i) => ({
    lon,
    lat,
    t: times?.[i] ?? null,
    accuracyM: accuracies?.[i] ?? null,
  }));
  const result = filterJitter(fixes, parsed.segmentStarts, JITTER_PROFILES[mode]);

  return {
    ...parsed,
    points: result.fixes.map((f): [number, number] => [f.lon, f.lat]),
    segmentStarts: result.segmentStarts,
    times: times ? result.fixes.map((f) => f.t) : undefined,
    accuracies: accuracies ? result.fixes.map((f) => f.accuracyM) : undefined,
    elevations: elevations
      ? result.sources.map((s) => meanOf(s.map((i) => elevations[i])))
      : undefined,
    jitterDropped: result.checked ? result.dropped : null,
    rawPointCount: parsed.rawPointCount ?? total,
  };
}

/** A stay's height: the mean of the readings it has, or none when it has none. */
function meanOf(values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0) / known.length;
}
