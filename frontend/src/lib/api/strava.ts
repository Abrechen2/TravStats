import { isAxiosError } from "axios";

import { api } from "./client";

/** Mirrors backend `StravaErrorKind` (`services/strava/stravaErrors.ts`). */
export type StravaFailureKind =
  "notConfigured" | "unreachable" | "auth" | "notFound" | "protocol" | "rateLimited";

const KINDS: readonly StravaFailureKind[] = [
  "notConfigured",
  "unreachable",
  "auth",
  "notFound",
  "protocol",
  "rateLimited",
];

export interface StravaStatus {
  configured: boolean;
  connected: boolean;
  athleteId: string | null;
}

export interface StravaActivity {
  id: string;
  name: string;
  sportType: string;
  startDate: string;
  distanceKm: number;
  movingSeconds: number;
  ascentM: number | null;
  hasRoute: boolean;
}

export interface StravaAdminSettings {
  clientId: string | null;
  secretSet: boolean;
  envConfigured: boolean;
}

/** The instance's own callback page — the only redirect the server accepts. */
export const STRAVA_CALLBACK_PATH = "/integrations/strava/callback";

/** The fixed failure kind a Strava error answered with, or null for anything else. */
export function stravaFailureKind(err: unknown): StravaFailureKind | null {
  if (!isAxiosError(err)) return null;
  const kind = (err.response?.data as { kind?: unknown } | undefined)?.kind;
  return typeof kind === "string" && (KINDS as readonly string[]).includes(kind)
    ? (kind as StravaFailureKind)
    : null;
}

export const stravaApi = {
  status: async (): Promise<StravaStatus> => {
    const { data } = await api.get<StravaStatus>("/integrations/strava/status");
    return data;
  },

  /** Strava's consent URL; the caller navigates the browser there. */
  authorizeUrl: async (): Promise<string> => {
    const redirectUri = `${window.location.origin}${STRAVA_CALLBACK_PATH}`;
    const { data } = await api.post<{ url: string }>("/integrations/strava/authorize", {
      redirectUri,
    });
    return data.url;
  },

  exchange: async (input: {
    code: string;
    state: string;
    scope?: string;
  }): Promise<StravaStatus> => {
    const { data } = await api.post<StravaStatus>("/integrations/strava/exchange", input);
    return data;
  },

  disconnect: async (): Promise<void> => {
    await api.delete("/integrations/strava");
  },

  activities: async (
    window: { after?: string; before?: string } = {}
  ): Promise<StravaActivity[]> => {
    const { data } = await api.get<{ activities: StravaActivity[] }>(
      "/integrations/strava/activities",
      { params: window }
    );
    return data.activities;
  },

  /** Make a new day tour from an activity; returns the new tour's id. */
  importAsTour: async (activityId: string, tripId?: string | null): Promise<string> => {
    const { data } = await api.post<{ routeId: string }>("/tours/import/strava", {
      activityId,
      tripId: tripId ?? null,
    });
    return data.routeId;
  },

  /** Add an activity's recording to an existing tour or roadtrip. */
  importInto: async (routeId: string, activityId: string): Promise<void> => {
    await api.post(`/tours/${routeId}/tracks/strava`, { activityId });
  },

  admin: {
    get: async (): Promise<StravaAdminSettings> => {
      const { data } = await api.get<StravaAdminSettings>("/admin/strava");
      return data;
    },
    update: async (input: {
      clientId?: string | null;
      clientSecret?: string | null;
    }): Promise<StravaAdminSettings> => {
      const { data } = await api.put<StravaAdminSettings>("/admin/strava", input);
      return data;
    },
  },
};
