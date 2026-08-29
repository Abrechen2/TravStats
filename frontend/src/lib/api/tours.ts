import { api } from "./client";
import type {
  TourRoute,
  TourStop,
  TourLeg,
  TourGeometry,
  LegMode,
  LegSource,
} from "../../types/tour";

export interface CreateTourRouteInput {
  name: string;
  mode: LegMode;
}

// PATCH semantics: explicit `null` clears `color`, `undefined` leaves it
// untouched — the same convention `UpdateTripInput` in `trips.ts` follows.
export interface UpdateTourRouteInput {
  name?: string;
  mode?: LegMode;
  color?: string | null;
}

// `drivingMinutes`/`tollCost`/`currency` are nullable AND optional: sending
// `null` clears the field server-side, omitting the key leaves it
// untouched. Collapsing the two into one `| null` type would make it
// impossible to express "leave alone" — see `legOverrideSchema` in
// `backend/src/schemas/tour.ts` and its `"drivingMinutes" in body` check.
export interface SetTourLegInput {
  source: LegSource;
  mode?: LegMode;
  waypoints?: Array<[number, number]>;
  drivingMinutes?: number | null;
  tollCost?: number | null;
  currency?: string | null;
}

export const toursApi = {
  list: async (tripId: string): Promise<TourRoute[]> => {
    const { data } = await api.get<{ routes: TourRoute[] }>(`/trips/${tripId}/routes`);
    return data.routes;
  },

  create: async (tripId: string, input: CreateTourRouteInput): Promise<TourRoute> => {
    const { data } = await api.post<{ route: TourRoute }>(`/trips/${tripId}/routes`, input);
    return data.route;
  },

  /**
   * One section with its stops (ordered) and its legs — the SAME envelope
   * `assignStops` returns, so a caller can share one response type for
   * both the read and the write. A plain GET: no transaction, nothing
   * written server-side. Added in Task 14's fix round 1 to replace an
   * earlier bug where the page re-sent the section's own stop order
   * through `assignStops` (a write, with its own 409 concurrency guard)
   * just to read this shape back — a read must never be able to trip a
   * write's concurrency guard or take its row locks.
   */
  get: async (
    tripId: string,
    routeId: string
  ): Promise<{ route: TourRoute; stops: TourStop[]; legs: TourLeg[] }> => {
    const { data } = await api.get<{ route: TourRoute; stops: TourStop[]; legs: TourLeg[] }>(
      `/trips/${tripId}/routes/${routeId}`
    );
    return data;
  },

  update: async (
    tripId: string,
    routeId: string,
    input: UpdateTourRouteInput
  ): Promise<TourRoute> => {
    const { data } = await api.patch<{ route: TourRoute }>(
      `/trips/${tripId}/routes/${routeId}`,
      input
    );
    return data.route;
  },

  remove: async (tripId: string, routeId: string): Promise<void> => {
    await api.delete(`/trips/${tripId}/routes/${routeId}`);
  },

  /**
   * Replaces the section's ENTIRE stop membership with this ordered list.
   * `stopIds` must contain no repeats — a loop is modelled as two distinct
   * stops at the same place, never one stop id twice (the server rejects a
   * repeat with 400; see `assignStopsSchema`).
   */
  assignStops: async (
    tripId: string,
    routeId: string,
    stopIds: string[]
  ): Promise<{ route: TourRoute; stops: TourStop[]; legs: TourLeg[] }> => {
    const { data } = await api.put<{ route: TourRoute; stops: TourStop[]; legs: TourLeg[] }>(
      `/trips/${tripId}/routes/${routeId}/stops`,
      { stopIds }
    );
    return data;
  },

  setLeg: async (
    tripId: string,
    routeId: string,
    fromStopId: string,
    toStopId: string,
    input: SetTourLegInput
  ): Promise<TourLeg> => {
    const { data } = await api.put<{ leg: TourLeg }>(
      `/trips/${tripId}/routes/${routeId}/legs/${fromStopId}/${toStopId}`,
      input
    );
    return data.leg;
  },

  clearLeg: async (
    tripId: string,
    routeId: string,
    fromStopId: string,
    toStopId: string
  ): Promise<void> => {
    await api.delete(`/trips/${tripId}/routes/${routeId}/legs/${fromStopId}/${toStopId}`);
  },

  geometry: async (tripId: string, routeId: string): Promise<TourGeometry> => {
    const { data } = await api.get<TourGeometry>(`/trips/${tripId}/routes/${routeId}/geometry`);
    return data;
  },
};
