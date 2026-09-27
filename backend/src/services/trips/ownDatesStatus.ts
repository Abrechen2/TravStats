import { profileZoneOf } from "../../shared/time/profileZone";
import { deriveTripStatus, tripStatusBounds } from "../../shared/statusDerivation";

/**
 * The status of a trip that holds nothing yet — only the days its owner
 * typed. Answered on the owner's calendar (ADR 0002 D4): the days begin in
 * the profile zone, by the same `tripStatusBounds` rule every later
 * recompute and the hourly sweep use, so a new trip is not born with a status
 * the next sweep would flip.
 */
export async function statusFromOwnDates(
  userId: string,
  startDate: Date | null | undefined,
  endDate: Date | null | undefined
): Promise<ReturnType<typeof deriveTripStatus>> {
  const { zone } = await profileZoneOf(userId);
  return deriveTripStatus(
    tripStatusBounds({
      flights: [],
      cruises: [],
      ownStartDate: startDate ?? null,
      ownEndDate: endDate ?? null,
      zone,
    })
  );
}
