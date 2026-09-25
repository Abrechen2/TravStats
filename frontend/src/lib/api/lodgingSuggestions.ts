import { api } from "./client";
import type { TagSuggestion } from "./tags";

/** What `GET /lodging/entry-suggestions` offers the lodging and stay forms. */
export interface LodgingEntrySuggestions {
  /** House amenities the user has written down before, most used first. */
  amenities: TagSuggestion[];
  /** Room amenities of the user's stays, most used first. */
  roomAmenities: TagSuggestion[];
}

export const EMPTY_LODGING_SUGGESTIONS: LodgingEntrySuggestions = {
  amenities: [],
  roomAmenities: [],
};

export async function getLodgingEntrySuggestions(): Promise<LodgingEntrySuggestions> {
  const { data } = await api.get<{ success: boolean; data: LodgingEntrySuggestions }>(
    "/lodging/entry-suggestions"
  );
  return data.data;
}
