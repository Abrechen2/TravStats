import { newPlanId } from "../travplanId";
import { api, parserApi } from "./client";
import { apiErrorMachineCode } from "../apiError";
import type {
  PlanCollab,
  PlanMember,
  PlanMemberShare,
  PlanPlace,
  PlaceholderMatch,
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
/** `GET /travplan/invitations`: an open invitation to plan together. */
export interface PlanInvitation {
  memberId: string;
  tripId: string;
  planName: string;
  ownerName: string;
  createdAt: string;
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
/** `GET /travplan/places`: every hit carries what a form needs; a failing source is named. */
export interface PlaceHit {
  source: "own" | "port" | "geocoder";
  visits: number | null;
  place: PlanPlace;
}
export interface PlaceSearch {
  places: PlaceHit[];
  unavailable: { source: PlaceHit["source"]; code: string }[];
}
/** `GET /trips/:id/plan/delete-preview`: what the confirmation block lists. */
export interface PlanDeletePreview {
  removes: Record<
    | "items"
    | "ideas"
    | "bookings"
    | "placeholders"
    | "stations"
    | "stages"
    | "variants"
    | "tasks"
    | "packing"
    | "receipts"
    | "proposals",
    number
  >;
  keeps: { stations: number; confirmedItems: number };
  tripIsEmptyShell: boolean;
}
export const travplanApi = {
  places: async (q: string, language: "de" | "en", kind: "any" | "port" = "any") =>
    (await api.get<PlaceSearch>("/travplan/places", { params: { q, language, kind } })).data,
  deletePreview: async (tripId: string) =>
    (await api.get<PlanDeletePreview>("/trips/" + tripId + "/plan/delete-preview")).data,
  deletePlan: async (tripId: string) =>
    (await api.delete<{ deleted: true }>("/trips/" + tripId + "/plan")).data,
  /** Routes one stage on the server; a failed router keeps the stored figures. */
  routeStage: async (plan: PlanView, stageId: string) =>
    (
      await api.post<PlanView>("/trips/" + plan.tripId + "/plan/stages/" + stageId + "/route", {
        baseRevision: plan.revision,
        clientRef: newPlanId(),
      })
    ).data,
  placeholderMatches: async (tripId: string, booking: Record<string, unknown>) =>
    (
      await api.post<{ matches: PlaceholderMatch[] }>(
        "/trips/" + tripId + "/plan/placeholder-matches",
        { booking }
      )
    ).data.matches,
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
  /** The polling read: null while nothing changed (304 against the held revision). */
  poll: async (held: PlanView) => {
    const res = await api.get<PlanView>("/trips/" + held.tripId + "/plan", {
      headers: { "If-None-Match": '"' + held.revision + "-" + (held.self?.memberId ?? "") + '"' },
      validateStatus: (status) => status === 200 || status === 304,
    });
    return res.status === 304 ? null : res.data;
  },
  collab: async (id: string) => (await api.get<PlanCollab>("/trips/" + id + "/plan/collab")).data,
  readNotices: async (id: string) =>
    (await api.post<{ read: number }>("/trips/" + id + "/plan/notices/read")).data,
  invite: async (id: string, username: string) =>
    (await api.post<PlanMember>("/trips/" + id + "/plan/members", { username })).data,
  removeMember: async (id: string, memberId: string) =>
    (await api.delete<{ revoked: true }>("/trips/" + id + "/plan/members/" + memberId)).data,
  shareWithMember: async (id: string, memberId: string) =>
    (await api.post<PlanMemberShare>("/trips/" + id + "/plan/members/" + memberId + "/share")).data,
  leave: async (id: string) =>
    (await api.post<{ left: true }>("/trips/" + id + "/plan/leave")).data,
  invitations: async () =>
    (await api.get<{ invitations: PlanInvitation[] }>("/travplan/invitations")).data.invitations,
  answerInvitation: async (memberId: string, answer: "accept" | "decline") =>
    (
      await api.post<{ status: "active" | "left" }>(
        "/travplan/invitations/" + memberId + "/" + answer
      )
    ).data,
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
