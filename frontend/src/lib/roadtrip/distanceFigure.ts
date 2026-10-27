import { odometerDistanceKm } from "../../shared/rentalCounting";
import type { RoadtripProgress } from "../../types/roadtrip";

/** The order the measurement sources are named in: the most reliable first. */
export const DISTANCE_SOURCES = ["track", "routed", "drawn", "straight"] as const;

export interface DistanceFigure {
  /**
   * `driven` only when the roadtrip is over AND the drive is proven: a
   * recorded track behind every km, or both odometer readings.
   */
  label: "driven" | "distance";
  /** What proves the drive; null while nothing does. */
  evidence: "track" | "odometer" | null;
  /** The km to show: the odometer's when it is the evidence, else the legs' total. */
  km: number;
  /** Driven so far and still ahead — only while the roadtrip is under way or ahead. */
  split: { driven: number; ahead: number } | null;
  /** Total km per source, most reliable first; empty when nothing is measured. */
  basis: { source: string; km: number }[];
}

/**
 * How the roadtrip page names its kilometres (forgejo#179). The split comes
 * from the server (`progress`), never from the page's own reading of dates:
 *
 *   - under way or ahead: "Strecke", with driven-so-far beside what is ahead;
 *   - over (or undated, i.e. written down afterwards): "Gefahren" only when a
 *     recorded GPS track proves every kilometre, or when both odometer readings
 *     are entered (owner, forgejo#280 point 1) — then the odometer's km are the
 *     figure, the same rule a rental's driven km follow (`odometerDistanceKm`).
 *     A straight line or a planned route is the plan, not proof of the drive;
 *     otherwise "Strecke", with what it was measured on.
 *
 * Without `progress` (an older server) nothing is claimed driven.
 */
export function distanceFigure(
  totalKm: number,
  progress: RoadtripProgress | undefined,
  odometer: { startOdometerKm: number | null; endOdometerKm: number | null } = {
    startOdometerKm: null,
    endOdometerKm: null,
  }
): DistanceFigure {
  if (!progress) {
    return { label: "distance", evidence: null, km: totalKm, split: null, basis: [] };
  }
  const over = progress.phase === "past" || progress.phase === "undated";
  const tracked = progress.roadKmBySource.track ?? 0;
  const provenDrive = totalKm > 0 && tracked >= totalKm - 0.05;
  const basis = DISTANCE_SOURCES.flatMap((source) => {
    const km = progress.roadKmBySource[source] ?? 0;
    return km > 0 ? [{ source, km }] : [];
  });
  const driven = progress.roadKm.recorded;
  const odometerKm = odometerDistanceKm(odometer.startOdometerKm, odometer.endOdometerKm);
  // A track covering every km keeps its figure; the odometer stands in otherwise.
  const evidence = !over ? null : provenDrive ? "track" : odometerKm !== null ? "odometer" : null;
  return {
    label: evidence ? "driven" : "distance",
    evidence,
    km: evidence === "odometer" && odometerKm !== null ? odometerKm : totalKm,
    split: over ? null : { driven, ahead: Math.max(0, totalKm - driven) },
    basis,
  };
}
