import type { RoadtripProgress } from "../../types/roadtrip";

/** The order the measurement sources are named in: the most reliable first. */
export const DISTANCE_SOURCES = ["track", "routed", "drawn", "straight"] as const;

export interface DistanceFigure {
  /** `driven` only when the roadtrip is over AND every km is a recorded track. */
  label: "driven" | "distance";
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
 *     recorded GPS track proves every kilometre — a straight line or a planned
 *     route is the plan, not proof of the drive; otherwise "Strecke", with what
 *     it was measured on.
 *
 * Without `progress` (an older server) nothing is claimed driven.
 */
export function distanceFigure(
  totalKm: number,
  progress: RoadtripProgress | undefined
): DistanceFigure {
  if (!progress) return { label: "distance", split: null, basis: [] };
  const over = progress.phase === "past" || progress.phase === "undated";
  const tracked = progress.roadKmBySource.track ?? 0;
  const provenDrive = totalKm > 0 && tracked >= totalKm - 0.05;
  const basis = DISTANCE_SOURCES.flatMap((source) => {
    const km = progress.roadKmBySource[source] ?? 0;
    return km > 0 ? [{ source, km }] : [];
  });
  const driven = progress.roadKm.recorded;
  return {
    label: over && provenDrive ? "driven" : "distance",
    split: over ? null : { driven, ahead: Math.max(0, totalKm - driven) },
    basis,
  };
}
