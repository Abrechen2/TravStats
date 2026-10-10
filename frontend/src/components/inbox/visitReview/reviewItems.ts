import type { PhotoJourneyBatchItem } from "../../../lib/api/photoJourneys";
import type { PhotoJourney } from "../../../types/photoJourney";

/**
 * What the reader changed on one suggestion before accepting it (forgejo#211,
 * O5). Every field is optional: an untouched suggestion is accepted as the scan
 * proposed it, and a field equal to the proposal is not sent.
 */
export interface VisitCorrection {
  name?: string;
  localName?: string;
  /** The place's wall clock, `YYYY-MM-DDTHH:mm`. */
  local?: string;
  /** An own place chosen instead of the proposed one. */
  place?: { id: string; name: string };
}

/** The first photo's wall clock, as the time field shows it. */
export const defaultLocal = (journey: PhotoJourney): string =>
  journey.startLocal ? journey.startLocal.slice(0, 16) : "";

/**
 * One batch item per id, in the order given. A rejection carries nothing but
 * the answer; an acceptance carries only what the reader actually changed —
 * sending the proposal back would read, on the server, as a correction.
 */
export function buildReviewItems(
  ids: readonly string[],
  action: PhotoJourneyBatchItem["action"],
  journeys: readonly PhotoJourney[],
  corrections: Readonly<Record<string, VisitCorrection>>
): PhotoJourneyBatchItem[] {
  return ids.map((id) => {
    if (action === "dismiss") return { id, action };
    const journey = journeys.find((row) => row.id === id);
    const correction = corrections[id] ?? {};
    const item: PhotoJourneyBatchItem = { id, action };
    if (correction.place) {
      // A chosen own place has its own name; the name fields do not apply.
      item.placeId = correction.place.id;
    } else {
      const name = correction.name?.trim();
      if (name && name !== (journey?.suggestedName ?? "")) item.name = name;
      const localName = correction.localName?.trim();
      if (localName && localName !== (journey?.suggestedLocalName ?? "")) {
        item.localName = localName;
      }
    }
    if (correction.local && journey && correction.local !== defaultLocal(journey)) {
      item.visitedAt = { local: correction.local };
    }
    return item;
  });
}

/** Whether accepting this suggestion as it stands would be refused for want of a name. */
export function needsName(journey: PhotoJourney, correction: VisitCorrection | undefined): boolean {
  if (journey.suggestedName || journey.placeId || correction?.place) return false;
  return !correction?.name?.trim();
}
