import { newPlanId } from "../travplanId";
import { api, parserApi } from "./client";
import { apiErrorMachineCode } from "../apiError";
import type {
  PlanView,
  PlanSummary,
  PlanState,
  PlanOperation,
  PlanProposal,
} from "../../types/travplan";
export type * from "../../types/travplan";
export interface PlanCapabilities {
  version: number;
  /** Instance AND account: what the navigation shows. */
  enabled: boolean;
  /** The instance half (since 2026-10-27); absent on an older server. */
  instanceEnabled?: boolean;
  /** The account's own switch (since 2026-10-27); absent on an older server. */
  userEnabled?: boolean;
  offlineWrites: boolean;
  ai: boolean;
  forecast: boolean;
  notifications: boolean;
}
export interface PlanConfig {
  enabled: boolean;
  aiDailyLimit: number;
  weatherDailyLimit: number;
}
/** `GET /trips/:tripId/plan/actual` — plan versus actual (TravTrack plan L5). Read-only. */
export type PlanStationStatus = "visited" | "shifted" | "skipped" | "unknown";
export interface PlanActual {
  plan: { revision: number };
  actual: {
    origin: "travstats" | "travtrack" | "dawarich";
    coverage: "complete" | "truncated" | "unreachable" | null;
    days: { day: string; state: "recorded" | "noData" }[];
    segments: [number, number][][];
  } | null;
  stations: {
    stationId: string;
    title: string;
    plannedFrom: string | null;
    plannedUntil: string | null;
    status: PlanStationStatus;
    deltaDays: number | null;
    actualFrom: string | null;
    actualUntil: string | null;
  }[];
  stages: {
    stageId: string;
    fromStationId: string;
    toStationId: string;
    plannedKm: number | null;
    actualKm: number | null;
  }[];
  unplanned: { kind: "lodging" | "place"; day: string; lat: number; lon: number; label: string }[];
}
export const travplanApi = {
  locations: async (q: string, language: "de" | "en") =>
    (
      await api.get<{
        locations: {
          id: number;
          name: string;
          country?: string;
          latitude: number;
          longitude: number;
          timezone: string;
        }[];
      }>("/travplan/locations", { params: { q, language } })
    ).data.locations,
  capabilities: async () => (await api.get<PlanCapabilities>("/travplan/capabilities")).data,
  config: async () => (await api.get<PlanConfig>("/travplan/config")).data,
  /** Any subset: the admin switch saves `{enabled}` alone and keeps the limits. */
  setConfig: async (config: Partial<PlanConfig>) =>
    (await api.patch<PlanConfig>("/travplan/config", config)).data,
  list: async () => (await api.get<{ plans: PlanSummary[] }>("/travplan/plans")).data.plans,
  create: async (
    name: string,
    settings: Partial<PlanState>,
    tripId?: string,
    clientRef = newPlanId()
  ) => (await api.post<PlanView>("/travplan/plans", { name, settings, tripId, clientRef })).data,
  get: async (id: string) => (await api.get<PlanView>("/trips/" + id + "/plan")).data,
  write: async (plan: PlanView, operation: PlanOperation, clientRef = newPlanId()) =>
    (
      await api.post<PlanView>("/trips/" + plan.tripId + "/plan/mutations", {
        baseRevision: plan.revision,
        clientRef,
        operation,
      })
    ).data,
  propose: async (id: string, request: string) =>
    (await parserApi.post<PlanProposal>("/trips/" + id + "/plan/proposals", { request })).data,
  proposals: async (id: string) =>
    (await api.get<{ proposals: PlanProposal[] }>("/trips/" + id + "/plan/proposals")).data
      .proposals,
  reject: async (id: string, proposalId: string) =>
    (await api.delete("/trips/" + id + "/plan/proposals/" + proposalId)).data,
  forecast: async (plan: PlanView) =>
    (
      await api.post<PlanView>("/trips/" + plan.tripId + "/plan/forecast", {
        baseRevision: plan.revision,
        clientRef: newPlanId(),
      })
    ).data,
  actual: async (id: string) => (await api.get<PlanActual>("/trips/" + id + "/plan/actual")).data,
  packingSuggestions: async (id: string) =>
    (await api.get<{ suggestions: string[] }>("/trips/" + id + "/plan/packing-suggestions")).data
      .suggestions,
};

/**
 * The admin switch's error copy (Admin → Instanz → TravPlan): `PLAN_DISABLED`
 * is the server's answer while the instance's beta switch is off, everything
 * else is a plain failed save.
 */
export function travPlanErrorKey(err: unknown): string {
  return apiErrorMachineCode(err) === "PLAN_DISABLED"
    ? "admin:travPlan.errors.disabled"
    : "admin:travPlan.errors.saveFailed";
}
