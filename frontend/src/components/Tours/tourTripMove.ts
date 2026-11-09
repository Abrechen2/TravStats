import { isAxiosError } from "axios";

import { apiErrorMachineCode } from "../../lib/apiError";
import { toursApi } from "../../lib/api/tours";

/** i18n keys (namespace `trips`) of what can go wrong moving a tour. */
export type TourMoveErrorKey =
  "tours.move.timelineError" | "tours.move.photosError" | "tours.move.error";

export type TourMoveResult =
  | { ok: true }
  | {
      ok: false;
      errorKey: TourMoveErrorKey;
      /** The move is possible if the reader agrees to take trip photos off the stations. */
      canDetachPhotos: boolean;
    };

/**
 * Attach a tour to a trip, or detach it (`tripId: null`), through the same PATCH
 * a roadtrip uses. A failure carries the key of the copy to show: the server
 * answers 409 for two different reasons, a tour drawn over a trip's timeline
 * stops (not movable at all) and `ROADTRIP_HAS_TRIP_PHOTOS` (movable once the
 * reader agrees to unlink the photos), and the reader needs to know which.
 */
export async function moveTourToTrip(
  tourId: string,
  tripId: string | null,
  opts: { detachPhotos?: boolean } = {}
): Promise<TourMoveResult> {
  try {
    await toursApi.update(undefined, tourId, {
      tripId,
      ...(opts.detachPhotos ? { detachStationPhotos: true } : {}),
    });
    return { ok: true };
  } catch (err) {
    const conflict = isAxiosError(err) && err.response?.status === 409;
    if (conflict && apiErrorMachineCode(err) === "ROADTRIP_HAS_TRIP_PHOTOS") {
      return { ok: false, errorKey: "tours.move.photosError", canDetachPhotos: true };
    }
    return {
      ok: false,
      errorKey: conflict ? "tours.move.timelineError" : "tours.move.error",
      canDetachPhotos: false,
    };
  }
}
