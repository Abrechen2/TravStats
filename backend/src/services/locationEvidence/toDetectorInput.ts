/**
 * TravTrack's derivation points in the shapes the TravStats detectors read
 * (TravTrack plan E2). Explicit and pure, so the detectors keep their code and
 * the other provider keeps its own point type: the stay and market detectors
 * take `DetectorPoint`, the country reducer `TimedPosition`.
 */
import type { TimedPosition } from "../countryDays/reduce";
import type { DerivationPoint } from "./derivationRead";

/**
 * The fields the stay and market detectors read. `id` is the point's digest —
 * a TravTrack point has no provider id worth keeping in evidence, and the
 * digest is what a stored finding names its points by.
 */
export type DetectorPoint = {
  id: string;
  timestampMs: number;
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  /** m/s, as stored — no conversion. */
  velocity: number | null;
  trackId: null;
};

/** The detectors' input; the course, the provider ref and the device are dropped. */
export function toDetectorInput(p: DerivationPoint): DetectorPoint {
  return {
    id: p.digest,
    timestampMs: p.atMs,
    latitude: p.lat,
    longitude: p.lon,
    altitude: p.altitudeM,
    accuracy: p.accuracyM,
    velocity: p.speedMps,
    trackId: null,
  };
}

/** The country reducer's input: a time and a position, nothing else. */
export function toTimedPosition(p: DerivationPoint): TimedPosition {
  return { latitude: p.lat, longitude: p.lon, timestampMs: p.atMs };
}
