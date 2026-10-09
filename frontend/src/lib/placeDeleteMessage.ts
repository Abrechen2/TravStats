import type { PlaceRelations } from "./api/places";
import { countedDeleteMessage, survivorsNote, withDocumentNote } from "./deleteConfirm";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The question before a place is deleted, for the list AND the detail page —
 * one function, so the two can no longer say different things (forgejo#250).
 *
 * What goes: the visits (planned ones too), their proof photos and kept
 * documents, and the place's memberships in lists. What stays: the trips its
 * visits were filed under, the lists themselves, and roadtrip stations that
 * named it. Counts come from `GET /places/:id/related`; while they are unknown
 * (still loading, or the request failed) the sentence uses the visit count the
 * caller has and names the trips in general terms — never "none".
 */
export function placeDeleteMessage(
  t: Translate,
  name: string,
  knownVisitCount: number,
  relations: PlaceRelations | null
): string {
  const visits = relations?.visitCount ?? knownVisitCount;
  const lines = [
    countedDeleteMessage(
      t,
      { counted: "places:list.deleteMessage", empty: "places:list.deleteMessageNoVisits" },
      name,
      visits
    ),
  ];
  if (relations === null) {
    lines.push(t("places:delete.tripsStayUnnamed"));
    return lines.join("\n");
  }
  if (relations.photoCount > 0) {
    lines.push(t("places:delete.photos", { count: relations.photoCount }));
  }
  if (relations.lists.length > 0) {
    lines.push(
      t("places:delete.lists", {
        count: relations.lists.length,
        names: relations.lists.map((l) => l.name).join(", "),
      })
    );
  }
  const withDocuments = withDocumentNote(lines.join("\n"), t, relations.documentCount);
  const tail = [
    survivorsNote(
      t,
      relations.trips.map((trip) => trip.name)
    ),
    relations.roadtripStationCount > 0
      ? t("places:delete.stations", { count: relations.roadtripStationCount })
      : null,
  ].filter((line): line is string => line !== null);
  return [withDocuments, ...tail].join("\n");
}
