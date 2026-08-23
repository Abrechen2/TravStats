import { api } from "./client";
import type { Place, PlaceInput, PlaceVisit, VisitInput, PlaceListQuery } from "../../types/place";

interface Envelope<T> {
  success: boolean;
  data: T;
  meta?: { total: number; limit: number; offset: number };
}

/** The server's own per-request maximum (`placeQuerySchema`). */
const PLACE_PAGE_SIZE = 500;
/** Backstop against an endless loop if `meta.total` ever disagrees with the
 *  rows actually returned. 20 000 places is far past any real account. */
const MAX_PLACE_PAGES = 40;

/**
 * Every place matching the query — ALL of them, walked page by page.
 *
 * Paging HERE rather than in the list page, for the reason lodging learned the
 * hard way (Discord, 2026-08-09): the dashboard map, the list and the trip
 * picker all call this, and a cut-off that lives in one caller silently
 * shortens the others. A place missing from the map is invisible in a way a
 * missing table row is not.
 */
export async function listPlaces(query: PlaceListQuery = {}): Promise<Place[]> {
  const out: Place[] = [];
  let offset = query.offset ?? 0;

  for (let page = 0; page < MAX_PLACE_PAGES; page += 1) {
    const res = await api.get<Envelope<Place[]>>("/places", {
      params: { ...query, limit: query.limit ?? PLACE_PAGE_SIZE, offset },
    });
    const batch = res.data.data ?? [];
    out.push(...batch);

    const total = res.data.meta?.total ?? out.length;
    offset += batch.length;
    if (batch.length === 0 || out.length >= total) break;
  }
  return out;
}

/** Total matching places without transferring them — for tab counts. */
export async function countPlaces(query: PlaceListQuery = {}): Promise<number> {
  const res = await api.get<Envelope<Place[]>>("/places", {
    params: { ...query, limit: 1, offset: 0 },
  });
  return res.data.meta?.total ?? res.data.data.length;
}

export async function getPlace(id: string): Promise<Place> {
  const res = await api.get<Envelope<Place>>(`/places/${id}`);
  return res.data.data;
}

export async function createPlace(input: PlaceInput): Promise<Place> {
  const res = await api.post<Envelope<Place>>("/places", input);
  return res.data.data;
}

export async function updatePlace(id: string, input: Partial<PlaceInput>): Promise<Place> {
  const res = await api.patch<Envelope<Place>>(`/places/${id}`, input);
  return res.data.data;
}

export async function deletePlace(id: string): Promise<void> {
  await api.delete(`/places/${id}`);
}

export async function createVisit(placeId: string, input: VisitInput): Promise<PlaceVisit> {
  const res = await api.post<Envelope<PlaceVisit>>(`/places/${placeId}/visits`, input);
  return res.data.data;
}

export async function updateVisit(visitId: string, input: VisitInput): Promise<PlaceVisit> {
  const res = await api.patch<Envelope<PlaceVisit>>(`/places/visits/${visitId}`, input);
  return res.data.data;
}

export async function deleteVisit(visitId: string): Promise<void> {
  await api.delete(`/places/visits/${visitId}`);
}

export const placesApi = {
  list: listPlaces,
  count: countPlaces,
  get: getPlace,
  create: createPlace,
  update: updatePlace,
  remove: deletePlace,
  createVisit,
  updateVisit,
  deleteVisit,
};
