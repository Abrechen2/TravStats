import { api } from "./client";
import type { TourGeometry } from "../../types/tour";

/**
 * One tour section as the dashboard-wide list sees it. Mirrors
 * `toTourSummary()` in `backend/src/routes/trips/tourIndex.ts` exactly —
 * including `mode: string` rather than the frontend's `LegMode` union.
 * The wire value is a plain Prisma column, not something this endpoint
 * validates against `LEG_MODES`; treating it as the narrower union here
 * would claim a guarantee the server does not make. Consumers that need a
 * colour for a mode (the map layer, the legend) already go through
 * `TOUR_MODE_RGB`'s `??` fallback for exactly this reason.
 */
export interface TourSummary {
  id: string;
  tripId: string;
  tripName: string;
  name: string;
  mode: string;
  distanceKm: number;
  stopCount: number;
  startDate: string | null;
  endDate: string | null;
}

/**
 * One tour's geometry, paired with the section name `buildTourPaths`
 * (`components/layers/tourPathsLayer.ts`) uses to label each leg.
 */
export interface TourGeometryEntry {
  routeId: string;
  name: string;
  geometry: TourGeometry;
}

/**
 * `POST /tours/geometry/batch` caps a single call at 100 ids
 * (`tourGeometryBatchSchema`, `backend/src/schemas/tour.ts`). A single trip
 * never has enough legs to hit that, but the dashboard-wide list this file
 * exists for can easily exceed it across many trips — so `geometryBatch`
 * below chunks past this size instead of failing, and still never falls
 * back to one request per id (the N+1 the batch endpoint exists to
 * prevent in the first place).
 */
const GEOMETRY_BATCH_MAX_IDS = 100;

export const tourIndexApi = {
  /** Every tour section the caller owns, across every trip. No geometry —
   *  see `TOUR_SUMMARY_SELECT`'s doc comment on the backend route. */
  list: async (): Promise<TourSummary[]> => {
    const { data } = await api.get<{ tours: TourSummary[] }>("/tours");
    return data.tours;
  },

  /**
   * Geometry for a set of tour ids in as few round trips as the 100-id cap
   * allows. An id the caller does not own (or that no longer exists) is
   * silently absent from the returned map — same contract the backend
   * route documents, and the same one `cruiseApi.getGeometryBatch` follows
   * for the equivalent cruise call.
   */
  geometryBatch: async (ids: readonly string[]): Promise<Map<string, TourGeometry>> => {
    if (ids.length === 0) return new Map();

    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += GEOMETRY_BATCH_MAX_IDS) {
      chunks.push(ids.slice(i, i + GEOMETRY_BATCH_MAX_IDS));
    }

    const responses = await Promise.all(
      chunks.map((chunk) =>
        api.post<{ data: Record<string, TourGeometry> }>("/tours/geometry/batch", {
          ids: chunk,
        })
      )
    );

    const out = new Map<string, TourGeometry>();
    for (const { data } of responses) {
      for (const [id, geometry] of Object.entries(data.data)) {
        out.set(id, geometry);
      }
    }
    return out;
  },
};
