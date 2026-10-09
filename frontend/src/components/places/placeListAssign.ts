import { addPlaceToList } from "../../lib/api/placeLists";
import { logger } from "../../lib/logger";
import type { PlaceList } from "../../types/placeList";

export interface ListAssignResult {
  /** The lists that refused the place, in the order they were asked. */
  rejected: string[];
  /** The fresh lists the server answered with, by id — each call returns one. */
  updated: Map<string, PlaceList>;
}

/**
 * File a stored place into lists, one request per list, and report which
 * refused.
 *
 * The place exists before this runs, and a refusal must never undo it: losing
 * a place because one list said no is a far worse trade than an unfiled place.
 * The caller names what failed and offers to ask again for exactly those
 * (forgejo#230, forgejo#247) — it never retries the place itself. Sequential on
 * purpose: the server appends at the list's end, and two parallel calls would
 * race for the same position.
 */
export async function assignPlaceToLists(
  placeId: string,
  listIds: readonly string[]
): Promise<ListAssignResult> {
  const rejected: string[] = [];
  const updated = new Map<string, PlaceList>();
  for (const listId of listIds) {
    try {
      updated.set(listId, await addPlaceToList(listId, placeId));
    } catch (err: unknown) {
      logger.error({ err, listId, placeId }, "assignPlaceToLists: the list refused the place");
      rejected.push(listId);
    }
  }
  return { rejected, updated };
}
