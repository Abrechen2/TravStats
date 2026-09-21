import { api } from "./client";
import type {
  TourRoute,
  TourStop,
  TourLeg,
  TourGeometry,
  TourTrack,
  TourTrackMeta,
  LegMode,
  LegSource,
} from "../../types/tour";

export interface CreateTourRouteInput {
  name: string;
  mode: LegMode;
}

/** One authored point of a standalone tour. `id` identifies an existing
 *  one; omitting it creates a new point. */
export interface TourPointInput {
  id?: string;
  title: string;
  lat: number;
  lon: number;
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
/**
 * `trackId` is REQUIRED when `source` is `"track"` (mirrors
 * `legOverrideSchema`'s discriminated union on the backend — the
 * `track` branch there has no default/fallback either, because a `track`
 * leg with no `trackId` would be a leg claiming geometry it does not
 * have). Left as one flat optional field rather than a TypeScript
 * discriminated union, the same "hand-mirrored literal types" convention
 * every other type in this file follows — the server is the actual
 * enforcement boundary.
 */
export interface SetTourLegInput {
  source: LegSource;
  mode?: LegMode;
  waypoints?: Array<[number, number]>;
  drivingMinutes?: number | null;
  tollCost?: number | null;
  currency?: string | null;
  trackId?: string;
}

/**
 * The section's path, in whichever shape it has.
 *
 * A tour that belongs to a trip is `/trips/:id/routes/:routeId`; one that
 * belongs to no trip has no id to put there and is `/tours/:routeId`. The
 * server answers both under the same handlers (2026-09-21), so every call
 * below takes `tripId` as possibly-undefined and the editor works on
 * either kind without knowing which it has.
 */
function sectionPath(tripId: string | undefined, routeId: string): string {
  return tripId === undefined ? `/tours/${routeId}` : `/trips/${tripId}/routes/${routeId}`;
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
   * Creates a tour with NO trip — it stands on its own (owner ruling,
   * 2026-09-21). `create` above is the same thing with a trip; both exist
   * because the trip page already speaks in terms of its own id and has no
   * reason to repeat it in a body.
   */
  createStandalone: async (input: CreateTourRouteInput): Promise<TourRoute> => {
    const { data } = await api.post<{ route: TourRoute }>("/tours", input);
    return data.route;
  },

  /**
   * Replaces a standalone tour's ENTIRE point list — added, moved, removed
   * and renumbered in one write. A tour that belongs to a trip answers 409:
   * there the vertices come from the trip's timeline (`assignStops`).
   */
  replacePoints: async (
    routeId: string,
    points: TourPointInput[]
  ): Promise<{ route: TourRoute; stops: TourStop[]; legs: TourLeg[] }> => {
    const { data } = await api.put<{ route: TourRoute; stops: TourStop[]; legs: TourLeg[] }>(
      `/tours/${routeId}/points`,
      { points }
    );
    return data;
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
    tripId: string | undefined,
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
    }>(sectionPath(tripId, routeId));
    return data;
  },

  update: async (
    tripId: string | undefined,
    routeId: string,
    input: UpdateTourRouteInput
  ): Promise<TourRoute> => {
    const { data } = await api.patch<{ route: TourRoute }>(sectionPath(tripId, routeId), input);
    return data.route;
  },

  remove: async (tripId: string | undefined, routeId: string): Promise<void> => {
    await api.delete(sectionPath(tripId, routeId));
  },

  /** The same delete, reached without a trip in the path — the only way to
   *  reach a tour that has none. */
  removeStandalone: async (routeId: string): Promise<void> => {
    await api.delete(`/tours/${routeId}`);
  },

  /**
   * Replaces the section's ENTIRE stop membership with this ordered list.
   * `stopIds` must contain no repeats — a loop is modelled as two distinct
   * stops at the same place, never one stop id twice (the server rejects a
   * repeat with 400; see `assignStopsSchema`).
   */
  assignStops: async (
    tripId: string | undefined,
    routeId: string,
    stopIds: string[]
  ): Promise<{ route: TourRoute; stops: TourStop[]; legs: TourLeg[] }> => {
    const { data } = await api.put<{ route: TourRoute; stops: TourStop[]; legs: TourLeg[] }>(
      `${sectionPath(tripId, routeId)}/stops`,
      { stopIds }
    );
    return data;
  },

  setLeg: async (
    tripId: string | undefined,
    routeId: string,
    fromStopId: string,
    toStopId: string,
    input: SetTourLegInput
  ): Promise<TourLeg> => {
    const { data } = await api.put<{ leg: TourLeg }>(
      `${sectionPath(tripId, routeId)}/legs/${fromStopId}/${toStopId}`,
      input
    );
    return data.leg;
  },

  clearLeg: async (
    tripId: string | undefined,
    routeId: string,
    fromStopId: string,
    toStopId: string
  ): Promise<void> => {
    await api.delete(`${sectionPath(tripId, routeId)}/legs/${fromStopId}/${toStopId}`);
  },

  geometry: async (tripId: string | undefined, routeId: string): Promise<TourGeometry> => {
    const { data } = await api.get<TourGeometry>(`${sectionPath(tripId, routeId)}/geometry`);
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
    tripId: string | undefined,
    routeId: string,
    fromStopId: string,
    toStopId: string
  ): Promise<TourLeg> => {
    const { data } = await api.post<{ leg: TourLeg }>(
      `${sectionPath(tripId, routeId)}/legs/${fromStopId}/${toStopId}/route`
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
    tripId: string | undefined,
    routeId: string
  ): Promise<{ route: TourRoute; legs: TourLeg[]; routedCount: number; skippedCount: number }> => {
    const { data } = await api.post<{
      route: TourRoute;
      legs: TourLeg[];
      routedCount: number;
      skippedCount: number;
    }>(`${sectionPath(tripId, routeId)}/route-all`);
    return data;
  },

  /**
   * Recorded tracks for one section (phase 3b, task 8). Split into its own
   * nested object rather than four more flat methods on `toursApi` — the
   * pattern this file's `SetTourLegInput` doc comment and
   * `backend/src/routes/trips/tourTracks.ts` both already establish: a
   * track hangs off the SECTION and a time window, never a leg.
   */
  tracks: {
    /**
     * Metadata only — matches `GET .../tracks`'s own doc comment
     * (`backend/src/routes/trips/tourTracks.ts`): no `geometry` field at
     * all, not merely an empty one.
     */
    list: async (tripId: string | undefined, routeId: string): Promise<TourTrackMeta[]> => {
      const { data } = await api.get<{ tracks: TourTrackMeta[] }>(
        `${sectionPath(tripId, routeId)}/tracks`
      );
      return data.tracks;
    },

    /** One track WITH geometry — needed to gate/adopt a leg's `track` option. */
    get: async (
      tripId: string | undefined,
      routeId: string,
      trackId: string
    ): Promise<TourTrack> => {
      const { data } = await api.get<{ track: TourTrack }>(
        `${sectionPath(tripId, routeId)}/tracks/${trackId}`
      );
      return data.track;
    },

    /**
     * Uploads a GPX file. The multipart field name is `file` — matching it
     * to anything else silently makes multer see "no file uploaded" (a 400
     * that reads like a server bug and is entirely a client one, the same
     * trap `uploadVisitPhotos` in `lib/api/places.ts` documents for its own
     * field name). A malformed GPX and a GPX with no timestamps both 400
     * with DIFFERENT server messages — this call surfaces whichever one the
     * server sent; callers must not invent a generic replacement.
     */
    upload: async (tripId: string | undefined, routeId: string, file: File): Promise<TourTrack> => {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post<{ track: TourTrack }>(
        `${sectionPath(tripId, routeId)}/tracks`,
        form,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      return data.track;
    },

    remove: async (tripId: string | undefined, routeId: string, trackId: string): Promise<void> => {
      await api.delete(`${sectionPath(tripId, routeId)}/tracks/${trackId}`);
    },

    /**
     * Pulls a time window from the caller's Dawarich connection. Both
     * sides are optional — an omitted side falls back to the section's own
     * date span server-side (`resolveDawarichWindow`), so the common case
     * is an empty body. Failures use the fixed kind vocabulary
     * `dawarichFailureKind()` (`lib/api/dawarich.ts`) parses — `notConfigured`
     * included — except the "empty window" and "no dated stops" cases,
     * which carry plain prose and no kind; callers must handle both.
     */
    pullDawarich: async (
      tripId: string | undefined,
      routeId: string,
      input: { startedAt?: string; endedAt?: string }
    ): Promise<TourTrack> => {
      const { data } = await api.post<{ track: TourTrack }>(
        `${sectionPath(tripId, routeId)}/tracks/dawarich`,
        input
      );
      return data.track;
    },
  },
};
