import { photoJourneysApi, type PhotoJourneyPhotoOutcome } from "../../lib/api/photoJourneys";
import { createVisit } from "../../lib/api/places";
import { tripsApi } from "../../lib/api/trips";
import type { PhotoJourney } from "../../types/photoJourney";

import { photoJourneyPlan } from "./photoJourneyPlan";

/**
 * Accepting a finding, in TWO steps that the caller must be able to tell apart.
 *
 * `PATCH /photo-journeys/:id` records the answer and LINKS what the client
 * created; it creates nothing itself, because a suggestion becoming travel is
 * "a separate, deliberate act through the normal trip endpoints". Clicking
 * accept in the inbox is that act. What the act is per reading lives in
 * `photoJourneyPlan.ts`, so the card's promise and this cannot disagree.
 *
 * The steps are separate functions rather than one `accept()` because the
 * INTERESTING failure is between them: the create succeeds and the PATCH then
 * fails. One function could only report "accept failed", and the row would stay
 * pending with a trip already in the journal — so a second click created a
 * SECOND trip, and the toast said nothing had been created at all. The caller
 * therefore keeps what step one returned, retries only step two, and says which
 * of the two failed.
 *
 * Step one first, always: a row marked accepted whose creation then failed is a
 * question that can never be asked again, while a trip created without the row
 * being marked leaves both visible.
 */

/** What step one created, and the id step two links. */
export type PhotoJourneyCreated =
  | { kind: "trip"; id: string }
  | { kind: "placeVisit"; id: string }
  /** The plan created nothing; step two only records the answer. */
  | { kind: "none" };

export async function createFromPhotoJourney(
  journey: PhotoJourney,
  /** The name for a trip, already localized by the caller. */
  tripName: string
): Promise<PhotoJourneyCreated> {
  const plan = photoJourneyPlan(journey);

  if (plan === "trip") {
    const trip = await tripsApi.create({
      name: tripName,
      startDate: journey.startDate,
      endDate: journey.endDate,
    });
    return { kind: "trip", id: trip.id };
  }

  // The second half of the condition is what `photoJourneyPlan` already
  // decided; it is repeated to narrow the nullable column rather than assert it
  // away, and a plan that disagreed would create nothing instead of throwing.
  if (plan === "placeVisit" && journey.placeId) {
    const visit = await createVisit(journey.placeId, { visitedAt: journey.startDate });
    return { kind: "placeVisit", id: visit.id };
  }

  return { kind: "none" };
}

/**
 * Step two: record the answer, pointing at whatever step one made. A visit
 * comes back with what became of the finding's photographs.
 */
export async function linkPhotoJourney(
  journeyId: string,
  created: PhotoJourneyCreated
): Promise<PhotoJourneyPhotoOutcome | null> {
  if (created.kind === "trip") {
    return photoJourneysApi.accept(journeyId, { createdTripId: created.id });
  }
  if (created.kind === "placeVisit") {
    return photoJourneysApi.accept(journeyId, { createdPlaceVisitId: created.id });
  }
  return photoJourneysApi.accept(journeyId);
}
