import type { DriveSplit, PlanStage, PlanState } from "./types";

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Suggests how to cut each drive longer than the vehicle's daily limit into
 * day stages. Needs a duration or a distance on the stage AND a limit of the
 * same kind on the vehicle; with both limits the one that needs more days wins.
 * Suggestions only — nothing here creates a station.
 */
export function suggestDriveSplits(state: PlanState): DriveSplit[] {
  const maxMin = state.vehicle?.maxDriveMinutesPerDay ?? null;
  const maxKm = state.vehicle?.maxDriveKmPerDay ?? null;
  if (maxMin === null && maxKm === null) return [];
  const out: DriveSplit[] = [];
  for (const stage of state.stages) {
    const split = splitOne(state, stage, maxMin, maxKm);
    if (split) out.push(split);
  }
  return out;
}

function splitOne(
  state: PlanState,
  stage: PlanStage,
  maxMin: number | null,
  maxKm: number | null
): DriveSplit | null {
  if (stage.mode !== "drive") return null;
  const from = state.stations.find((s) => s.id === stage.fromStationId);
  const to = state.stations.find((s) => s.id === stage.toStationId);
  if (!from || !to) return null;
  const byMinutes =
    maxMin !== null && stage.durationMinutes !== null
      ? Math.ceil(stage.durationMinutes / maxMin)
      : 1;
  const byKm =
    maxKm !== null && stage.distanceKm !== null ? Math.ceil(stage.distanceKm / maxKm) : 1;
  const days = Math.max(byMinutes, byKm);
  if (days < 2) return null;
  const share = (total: number | null) => (total === null ? null : total / days);
  const minutes = share(stage.durationMinutes);
  const km = share(stage.distanceKm);
  return {
    stageId: stage.id,
    days,
    legs: Array.from({ length: days }, () => ({
      minutes: minutes === null ? null : Math.round(minutes),
      km: km === null ? null : round1(km),
    })),
    stops: Array.from({ length: days - 1 }, (_, i) => {
      const f = (i + 1) / days;
      return {
        lat: Math.round((from.place.lat + (to.place.lat - from.place.lat) * f) * 1000) / 1000,
        lon: Math.round((from.place.lon + (to.place.lon - from.place.lon) * f) * 1000) / 1000,
        afterMinutes: minutes === null ? null : Math.round(minutes * (i + 1)),
        afterKm: km === null ? null : round1(km * (i + 1)),
      };
    }),
    approximate: true,
  };
}
