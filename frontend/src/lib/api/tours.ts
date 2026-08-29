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
   * One section with its stops (ordered), its legs, and `routingAvailable`
   * — the SAME envelope `assignStops` returns, so a caller can share one
   * response type for both the read and the write. A plain GET: no
   * transaction, nothing written server-side. Added in Task 14's fix round
   * 1 to replace an earlier bug where the page re-sent the section's own
   * stop order through `assignStops` (a write, with its own 409
   * concurrency guard) just to read this shape back — a read must never be
   * able to trip a write's concurrency guard or take its row locks.
   *
   * `routingAvailable` (Task 6/7, phase 3) tells the caller whether a
   * routing provider is actually usable right now — the route editor uses
   * it to decide whether "Route this leg" / "Route the whole section" can
   * be offered at all, rather than offering a control that always answers
   * 409. See `describeRoutingAvailability` in
   * `backend/src/routes/trips/tourRoutes.ts`.
   */
  get: async (
    tripId: string,
    routeId: string
  ): Promise<{
    route: TourRoute;
    stops: TourStop[];
    legs: TourLeg[];
    routingAvailable: boolean;
  }> => {
    const { data } = await api.get<{
      route: TourRoute;
      stops: TourStop[];
      legs: TourLeg[];
      routingAvailable: boolean;
    }>(`/trips/${tripId}/routes/${routeId}`);
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

  /**
   * Routes ONE leg through the configured provider
   * (`POST .../legs/:fromStopId/:toStopId/route` —
   * `backend/src/routes/trips/tourRouting.ts`). No provider configured is a
   * **409**, distinct from every other error this call can raise — the
   * caller must surface that as its own message, not the generic
   * "leg could not be changed" text `setLeg`'s failures use. A provider
   * that IS configured but fails still answers 200: the returned leg's
   * `confidence` is `"low"` and `source` reverts to `"straight"`, an
   * honest fallback rather than an error.
   */
  routeLeg: async (
    tripId: string,
    routeId: string,
    fromStopId: string,
    toStopId: string
  ): Promise<TourLeg> => {
    const { data } = await api.post<{ leg: TourLeg }>(
      `/trips/${tripId}/routes/${routeId}/legs/${fromStopId}/${toStopId}/route`
    );
    return data.leg;
  },

  /**
   * Routes every routable leg of the section in one call
   * (`POST .../route-all` — `backend/src/routes/trips/tourRouting.ts`).
   * Unlike `routeLeg` above, this never 409s on an unconfigured provider —
   * it degrades every routable leg to its honest straight-chord fallback
   * and still answers 200. `routedCount`/`skippedCount` are the honest
   * report the caller must show, never a blanket "success" toast.
   */
  routeAll: async (
    tripId: string,
    routeId: string
  ): Promise<{ route: TourRoute; legs: TourLeg[]; routedCount: number; skippedCount: number }> => {
    const { data } = await api.post<{
      route: TourRoute;
      legs: TourLeg[];
      routedCount: number;
      skippedCount: number;
    }>(`/trips/${tripId}/routes/${routeId}/route-all`);
    return data;
  },
};
