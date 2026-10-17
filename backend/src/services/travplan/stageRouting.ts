import { AppError } from "../../middleware/errorHandler";
import { haversineKm } from "../../shared/geo/haversine";
import { resolveRouteProvider } from "../tour/routing/resolveProvider";
import { routeLegGeometry } from "../tour/routing/routeLeg";
import { providerCallGate } from "../tour/routing/providerBudget";
import type { PlanStage, PlanState } from "./types";

export interface StageCoord {
  lat: number;
  lon: number;
}

export interface StageMetrics {
  distanceKm: number | null;
  durationMinutes: number | null;
  metricsSource: PlanStage["metricsSource"];
  fallbackReason: string | null;
  /** The endpoints the answer is about; the write refuses it if they moved since. */
  fromCoord: StageCoord;
  toCoord: StageCoord;
}

const notFound = (): never => {
  throw new AppError("Plan entry not found", 404, "PLAN_ITEM_NOT_FOUND");
};

/** Whole kilometres to one decimal, so a stored figure is not false precision. */
const roundKm = (km: number) => Math.round(km * 10) / 10;

/**
 * Works out the distance and drive time of one stage. Never writes.
 *
 * A re-derivation never destroys good data: when the router cannot answer, the
 * stored figures stay and only the reason is recorded. A fallback chord is only
 * stored where there was nothing at all.
 */
export async function routeStage(
  userId: string,
  state: PlanState,
  stageId: string
): Promise<StageMetrics> {
  const stage = state.stages.find((s) => s.id === stageId) ?? notFound();
  const from = state.stations.find((s) => s.id === stage.fromStationId) ?? notFound();
  const to = state.stations.find((s) => s.id === stage.toStationId) ?? notFound();
  const fromCoord = { lat: from.place.lat, lon: from.place.lon };
  const toCoord = { lat: to.place.lat, lon: to.place.lon };
  const stored = {
    distanceKm: stage.distanceKm,
    durationMinutes: stage.durationMinutes,
    metricsSource: stage.metricsSource,
  };

  if (stage.mode === "ferry")
    return {
      ...stored,
      distanceKm: roundKm(haversineKm(fromCoord, toCoord)),
      metricsSource: "straight",
      fallbackReason: null,
      fromCoord,
      toCoord,
    };
  if (stage.mode !== "drive")
    return { ...stored, fallbackReason: "unroutable_mode", fromCoord, toCoord };

  const provider = await resolveRouteProvider(userId);
  const leg = await routeLegGeometry(
    provider,
    { from: fromCoord, to: toCoord, mode: "road", vehicle: state.vehicle?.kind ?? null },
    providerCallGate(userId)
  );
  if (leg.source === "routed")
    return {
      distanceKm: roundKm(leg.distanceKm),
      durationMinutes: leg.drivingMinutes === null ? null : Math.round(leg.drivingMinutes),
      metricsSource: "routed",
      fallbackReason: null,
      fromCoord,
      toCoord,
    };
  const fallbackReason = leg.fallbackReason ?? "provider_error";
  if (stage.distanceKm !== null) return { ...stored, fallbackReason, fromCoord, toCoord };
  return {
    distanceKm: roundKm(leg.distanceKm),
    durationMinutes: stage.durationMinutes,
    metricsSource: "straight",
    fallbackReason,
    fromCoord,
    toCoord,
  };
}
