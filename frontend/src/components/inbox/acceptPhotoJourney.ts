import { photoJourneysApi } from "../../lib/api/photoJourneys";
import { createVisit } from "../../lib/api/places";
import { tripsApi } from "../../lib/api/trips";
import type { PhotoJourney } from "../../types/photoJourney";

/**
 * What "yes, this happened" does — and what it deliberately does not do.
 *
 * `PATCH /photo-journeys/:id` records the answer and LINKS what the client
 * created; it creates nothing itself, because a suggestion becoming travel is
 * "a separate, deliberate act through the normal trip endpoints". Clicking
 * accept in the inbox is that act, so this is where it happens — once, rather
 * than inline in a card that also draws thumbnails.
 *
 * One reading, one creation, and only where the row fully names it:
 *
 * - **`trip`** — the row carries a span and a place name, which is a whole
 *   trip. `POST /trips` with exactly those, then the row points at it.
 * - **`place`** — the row carries the own place and the day. That is a visit,
 *   and `POST /places/:id/visits` needs nothing else.
 * - **`stay`** — recorded as answered, and NOTHING is created. A `LodgingStay`
 *   hangs off a `Lodging`; a stay finding names an own *Place* ("the own place
 *   that gives the nights a name") and no lodging at all. Creating a stay would
 *   mean inventing the hotel, and recording the nights as a place visit instead
 *   would quietly create a different thing than the card offered. So the answer
 *   is kept and the card says what was kept — abstention is a result.
 *
 * Order matters: create first, PATCH second. A row marked accepted whose
 * creation then failed is a question the user can never be asked again, while a
 * trip created without the row being marked leaves the question open and the
 * trip visible — the recoverable failure of the two.
 */

/** What the accept created, for the message the user gets. */
export type PhotoJourneyCreation = "trip" | "placeVisit" | "none";

export async function acceptPhotoJourney(
  journey: PhotoJourney,
  /** The name for a trip, already localized by the caller. */
  tripName: string
): Promise<PhotoJourneyCreation> {
  if (journey.kind === "trip") {
    const trip = await tripsApi.create({
      name: tripName,
      startDate: journey.startDate,
      endDate: journey.endDate,
    });
    await photoJourneysApi.accept(journey.id, { createdTripId: trip.id });
    return "trip";
  }

  // `placeId` is non-null for a `place` finding by construction, but the column
  // is nullable and a row whose place was deleted since the scan would arrive
  // without one. Answering it is still right; inventing a place is not.
  if (journey.kind === "place" && journey.placeId) {
    const visit = await createVisit(journey.placeId, { visitedAt: journey.startDate });
    await photoJourneysApi.accept(journey.id, { createdPlaceVisitId: visit.id });
    return "placeVisit";
  }

  await photoJourneysApi.accept(journey.id);
  return "none";
}
