import type { ZoneCircle } from "../classify";
import { distanceM } from "../classify";
import { isBadFix } from "../../locationEvidence/anomaly";
import { FOLD_BAND_M } from "../legs/fold";

/**
 * A silence explained by standing still (forgejo, TravTrack "home silence"). iOS
 * suspends the app when the phone does not move, so a quiet day at home has no
 * points at all. When the last good fix before a silence and the first good fix
 * after it lie inside the SAME known place, the owner was most likely there the
 * whole time: the day view says so, marked as inferred — never as recorded points.
 *
 * Abstention is a result: two ends in different places, or outside every known
 * place, stay "no data", and the verdict says which of the two it was.
 */

export type StationaryPlaceKind = "home" | "work" | "custom" | "place";

export type StationaryPlace = {
  /** `home`, a fixed place's id, or `place:<id>` for an accepted stay place. */
  id: string;
  name: string;
  kind: StationaryPlaceKind;
  lat: number;
  lon: number;
  radiusM: number;
};

export type SilenceEnd = { tMs: number; lat: number; lon: number };

/** Why a silence stays "no data". Closed vocabulary: the UI maps each to DE/EN copy. */
export type UnexplainedReason =
  /** No fix before it, or none after it yet (the silence may still be going on). */
  | "openEnd"
  /** It begins and ends at different places. */
  | "differentPlaces"
  /** Both ends are outside every known place. */
  | "outsidePlaces"
  /** A logbook entry, a pause or a deletion lies inside it. */
  | "contradicted";

export type SilenceVerdict =
  | { kind: "stationary"; place: StationaryPlace }
  | { kind: "unexplained"; reason: UnexplainedReason };

/** The smallest place whose circle (plus the fold's edge band) holds the fix. */
function placeAt(end: SilenceEnd, places: readonly StationaryPlace[]): StationaryPlace | null {
  const holding = places.filter((p) => distanceM(end, p) <= p.radiusM + FOLD_BAND_M);
  holding.sort(
    (a, b) =>
      a.radiusM - b.radiusM || distanceM(end, a) - distanceM(end, b) || a.id.localeCompare(b.id)
  );
  return holding[0] ?? null;
}

/**
 * Whether both ends lie in one place. Where two places hold an end, the one
 * that holds BOTH ends wins (smaller radius first), so overlapping circles do
 * not turn a stay into a "different places" silence.
 */
export function judgeSilence(
  before: SilenceEnd | null,
  after: SilenceEnd | null,
  places: readonly StationaryPlace[]
): SilenceVerdict {
  if (!before || !after) return { kind: "unexplained", reason: "openEnd" };
  const shared = places
    .filter(
      (p) =>
        distanceM(before, p) <= p.radiusM + FOLD_BAND_M &&
        distanceM(after, p) <= p.radiusM + FOLD_BAND_M
    )
    .sort((a, b) => a.radiusM - b.radiusM || a.id.localeCompare(b.id));
  if (shared[0]) return { kind: "stationary", place: shared[0] };
  const [a, b] = [placeAt(before, places), placeAt(after, places)];
  return {
    kind: "unexplained",
    reason: a === null && b === null ? "outsidePlaces" : "differentPlaces",
  };
}

/** Whether a fix may serve as the end of a silence: plausible, and outside every privacy circle. */
export function usableEnd(
  p: { lat: number; lon: number; accuracyM: number | null },
  circles: readonly ZoneCircle[]
): boolean {
  return !isBadFix({ ...p, atMs: 0 }) && !circles.some((z) => distanceM(p, z) <= z.radiusM);
}
