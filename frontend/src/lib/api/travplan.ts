import { newPlanId } from "../travplanId";
import { api, parserApi } from "./client";
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
  enabled: boolean;
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
  setConfig: async (config: PlanConfig) =>
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
  packingSuggestions: async (id: string) =>
    (await api.get<{ suggestions: string[] }>("/trips/" + id + "/plan/packing-suggestions")).data
      .suggestions,
};
