import { api } from "./client";
import type { TagSuggestion } from "./tags";
import type { BoardType } from "../../types/lodging";

/** What `GET /lodging/entry-suggestions` offers the lodging and stay forms. */
export interface LodgingEntrySuggestions {
  /** House amenities the user has written down before, most used first. */
  amenities: TagSuggestion[];
  /** Room amenities of the user's stays, most used first. */
  roomAmenities: TagSuggestion[];
  /** Rooms the user had in the asked house; empty without one. */
  roomNumbers: string[];
  /** Room categories: the house's first, then its chain's, then any. */
  roomCategories: string[];
  /** Board types in the same order; never "none". */
  boards: BoardType[];
}

export const EMPTY_LODGING_SUGGESTIONS: LodgingEntrySuggestions = {
  amenities: [],
  roomAmenities: [],
  roomNumbers: [],
  roomCategories: [],
  boards: [],
};

/** `lodgingId` asks for the stay fields of that house as well. */
export async function getLodgingEntrySuggestions(
  lodgingId?: string
): Promise<LodgingEntrySuggestions> {
  const { data } = await api.get<{ success: boolean; data: LodgingEntrySuggestions }>(
    "/lodging/entry-suggestions",
    { params: lodgingId ? { lodgingId } : undefined }
  );
  return data.data;
}
