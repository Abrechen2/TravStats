import { api } from "./client";
import type {
  CuratedListSummary,
  CuratedProgress,
  CuratedSuggestions,
  PlaceList,
  PlaceListInput,
} from "../../types/placeList";
import type { Place } from "../../types/place";

interface Envelope<T> {
  success: boolean;
  data: T;
}

// ---------------------------------------------------------------- own lists

/**
 * The user's own lists.
 *
 * `withEntries` defaults to false on the server, which is what the overview
 * wants: it renders counts, not membership. Ask for entries only where they are
 * actually drawn, or a user with forty lists pays for every place in all of
 * them to render a page of headline numbers.
 */
export async function listPlaceLists(withEntries = false): Promise<PlaceList[]> {
  const res = await api.get<Envelope<PlaceList[]>>("/place-lists", {
    params: withEntries ? { withEntries: "true" } : undefined,
  });
  return res.data.data;
}

export async function getPlaceList(id: string): Promise<PlaceList> {
  const res = await api.get<Envelope<PlaceList>>(`/place-lists/${id}`);
  return res.data.data;
}

export async function createPlaceList(input: PlaceListInput): Promise<PlaceList> {
  const res = await api.post<Envelope<PlaceList>>("/place-lists", input);
  return res.data.data;
}

export async function updatePlaceList(
  id: string,
  input: Partial<PlaceListInput>
): Promise<PlaceList> {
  const res = await api.patch<Envelope<PlaceList>>(`/place-lists/${id}`, input);
  return res.data.data;
}

export async function deletePlaceList(id: string): Promise<void> {
  await api.delete(`/place-lists/${id}`);
}

/** Every mutation below answers with the FRESH list, so callers never re-fetch. */
export async function addPlaceToList(listId: string, placeId: string): Promise<PlaceList> {
  const res = await api.post<Envelope<PlaceList>>(`/place-lists/${listId}/entries`, { placeId });
  return res.data.data;
}

export async function removePlaceFromList(listId: string, placeId: string): Promise<PlaceList> {
  const res = await api.delete<Envelope<PlaceList>>(`/place-lists/${listId}/entries/${placeId}`);
  return res.data.data;
}

export async function reorderPlaceList(listId: string, placeIds: string[]): Promise<PlaceList> {
  const res = await api.put<Envelope<PlaceList>>(`/place-lists/${listId}/entries/order`, {
    placeIds,
  });
  return res.data.data;
}

// ---------------------------------------------------------------- checklists

export async function listCuratedChecklists(): Promise<CuratedListSummary[]> {
  const res = await api.get<Envelope<CuratedListSummary[]>>("/place-lists/curated");
  return res.data.data;
}

export async function getCuratedProgress(key: string): Promise<CuratedProgress> {
  const res = await api.get<Envelope<CuratedProgress>>(`/place-lists/curated/${key}/progress`);
  return res.data.data;
}

export async function subscribeChecklist(key: string): Promise<PlaceList> {
  const res = await api.post<Envelope<PlaceList>>(`/place-lists/curated/${key}/subscribe`, {});
  return res.data.data;
}

export async function unsubscribeChecklist(key: string): Promise<void> {
  await api.delete(`/place-lists/curated/${key}/subscribe`);
}

/**
 * Suggestions for the targets still open on a checklist, derived from the
 * user's own recorded travel. Read-only — accepting one is an ordinary tick.
 */
export async function getCuratedSuggestions(key: string): Promise<CuratedSuggestions> {
  const res = await api.get<Envelope<CuratedSuggestions>>(
    `/place-lists/curated/${key}/suggestions`
  );
  return res.data.data;
}

/**
 * Tick a target — the moment a catalog row becomes a real place in the logbook.
 * Answers with that place, so the caller can navigate straight to it.
 *
 * `visitedAt` is what accepting a suggestion passes: the visit then lands with
 * the date the evidence gave it instead of as another undated one.
 */
export async function tickCuratedItem(itemId: string, visitedAt?: string | null): Promise<Place> {
  const res = await api.post<Envelope<Place>>(`/place-lists/curated/items/${itemId}/tick`, {
    ...(visitedAt ? { visitedAt } : {}),
  });
  return res.data.data;
}

/**
 * Untick. Deletes NOTHING — the place keeps its visits, photos and notes and
 * simply stops counting as visited, so a mis-click can never destroy a photo.
 */
export async function untickCuratedItem(itemId: string): Promise<void> {
  await api.delete(`/place-lists/curated/items/${itemId}/tick`);
}

export const placeListsApi = {
  list: listPlaceLists,
  get: getPlaceList,
  create: createPlaceList,
  update: updatePlaceList,
  remove: deletePlaceList,
  addPlace: addPlaceToList,
  removePlace: removePlaceFromList,
  reorder: reorderPlaceList,
  curated: {
    list: listCuratedChecklists,
    progress: getCuratedProgress,
    suggestions: getCuratedSuggestions,
    subscribe: subscribeChecklist,
    unsubscribe: unsubscribeChecklist,
    tick: tickCuratedItem,
    untick: untickCuratedItem,
  },
};
