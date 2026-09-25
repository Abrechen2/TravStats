import { prisma } from "../../db";
import { osmTagsOf } from "./openStreetMap";
import { isWikidataId, wikidataIdIn } from "./wikipedia";

/** Places whose lookup found no item, so a page view does not ask OSM again. */
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const noItem = new Map<string, number>();

/**
 * The Wikidata item of a place, resolved once and remembered on the row:
 * from its curated checklist item where that id carries one, else from the
 * `wikidata` tag of the OpenStreetMap element it was picked from. Null for a
 * place with neither — it is not looked up by name.
 */
export async function wikidataForPlace(place: {
  id: string;
  wikidataId: string | null;
  curatedItemId: string | null;
  externalRef: string | null;
}): Promise<string | null> {
  if (place.wikidataId) return place.wikidataId;
  const missedAt = noItem.get(place.id);
  if (missedAt !== undefined && Date.now() - missedAt < NEGATIVE_TTL_MS) return null;

  const fromCatalogue = wikidataIdIn(place.curatedItemId);
  const tags = fromCatalogue ? null : await osmTagsOf(place.externalRef);
  const qid = fromCatalogue ?? (isWikidataId(tags?.wikidata) ? tags!.wikidata : null);

  if (qid === null) {
    // A failed OSM request (tags null for an osm: ref) is not a miss worth remembering.
    if (tags !== null || !place.externalRef?.startsWith("osm:")) noItem.set(place.id, Date.now());
    return null;
  }
  await prisma.place.update({ where: { id: place.id }, data: { wikidataId: qid } });
  return qid;
}

/** Test seam. */
export function clearPlaceWikidataMisses(): void {
  noItem.clear();
}
