import { useMemo } from "react";
import type { Lodging } from "../../../types/lodging";
import type { Place } from "../../../types/place";
import { classifyVisit } from "../../../shared/placeCounting";
import type { ActivityDates } from "../../Globe/timeSliderUtils";

/**
 * What the "Alle" globe's activity histogram counts besides flights and
 * cruises: the dated entries of every other domain the map is showing. Each
 * list is already what the map draws (domain gate, domain chip, year), so a
 * hidden domain leaves no bars behind. Lodging counts a stay by its check-in,
 * a place by each visit it has actually made.
 */
export function useAllTabActivity(
  transport: readonly ActivityDates[],
  lodgings: readonly Lodging[],
  places: readonly Place[]
): ActivityDates[] {
  return useMemo(
    () => [
      ...transport,
      { domain: "lodging", dates: lodgings.flatMap((l) => (l.stays ?? []).map((s) => s.checkIn)) },
      {
        domain: "poi",
        dates: places.flatMap((p) =>
          (p.visits ?? []).filter((v) => classifyVisit(v) === "visited").map((v) => v.visitedAt)
        ),
      },
    ],
    [transport, lodgings, places]
  );
}
