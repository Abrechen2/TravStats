import { api } from "./client";

/** A bulk re-route (`backend/src/services/tour/routing/rerouteRun.ts`, forgejo#436). */
export type RerouteStatus = "running" | "paused" | "done" | "cancelled" | "failed";
export type RerouteMode = "straight" | "all";

export interface RerouteRun {
  id: string;
  scope: "instance" | "roadtrip" | "rail";
  routeId: string | null;
  mode: RerouteMode;
  status: RerouteStatus;
  total: number;
  processed: number;
  routed: number;
  kept: number;
  /** Per reason: a route-fallback reason, `timeout`, `no_coordinates` or `changed`. */
  failureCounts: Record<string, number>;
  failureSample: Array<{ kind: string; id: string; reason: string }>;
  stopReason: string | null;
  resumeAfter: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** The administrator's pass over every account's legs and coach rides. */
export const adminRerouteApi = {
  latest: async (): Promise<RerouteRun | null> =>
    (await api.get<{ run: RerouteRun | null }>("/admin/instance-settings/routing/reroute")).data
      .run,
  start: async (mode: RerouteMode): Promise<RerouteRun> =>
    (await api.post<{ run: RerouteRun }>("/admin/instance-settings/routing/reroute", { mode })).data
      .run,
  cancel: async (id: string): Promise<RerouteRun> =>
    (await api.post<{ run: RerouteRun }>(`/admin/instance-settings/routing/reroute/${id}/cancel`))
      .data.run,
};

/** "Alle Etappen neu routen" on one roadtrip, for the account's own legs. */
export const roadtripRerouteApi = {
  start: async (routeId: string): Promise<RerouteRun> =>
    (await api.post<{ run: RerouteRun }>(`/tours/${routeId}/reroute-all`)).data.run,
  latest: async (routeId: string): Promise<RerouteRun | null> =>
    (await api.get<{ run: RerouteRun | null }>(`/tours/${routeId}/reroute-all`)).data.run,
  get: async (id: string): Promise<RerouteRun> =>
    (await api.get<{ run: RerouteRun }>(`/routing-runs/${id}`)).data.run,
  cancel: async (id: string): Promise<RerouteRun> =>
    (await api.post<{ run: RerouteRun }>(`/routing-runs/${id}/cancel`)).data.run,
};

/** What the rail pass needs to show: the latest run and how many rides are still straight lines. */
export interface RailRerouteStatus {
  run: RerouteRun | null;
  /** Rides on the whole instance drawn as the chord between their stations. */
  straightJourneys: number;
  /** A rail router (OpenRailRouting) is set and not switched off. */
  routerConfigured: boolean;
}

/** "Bahnstrecken neu routen": the administrator's pass over every account's rail journeys. */
export const railRerouteApi = {
  status: async (): Promise<RailRerouteStatus> =>
    (await api.get<RailRerouteStatus>("/admin/instance-settings/routing/reroute-rail")).data,
  start: async (mode: RerouteMode): Promise<RerouteRun> =>
    (
      await api.post<{ run: RerouteRun }>("/admin/instance-settings/routing/reroute-rail", {
        mode,
      })
    ).data.run,
  cancel: async (id: string): Promise<RerouteRun> =>
    (
      await api.post<{ run: RerouteRun }>(
        `/admin/instance-settings/routing/reroute-rail/${id}/cancel`
      )
    ).data.run,
};
