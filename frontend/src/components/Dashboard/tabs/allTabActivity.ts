import { useMemo } from "react";
import type { Lodging } from "../../../types/lodging";
import type { TourSummary } from "../../../lib/api/tourIndex";
import type { Place } from "../../../types/place";
import {
  intervalOverlapsRange,
  useDashboardFilterStore,
} from "../../../store/dashboardFilterStore";
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
  places: readonly Place[],
  tours: readonly Pick<TourSummary, "kind" | "startDate">[]
): ActivityDates[] {
  const { from, to } = useDashboardFilterStore((st) => st.time);
  return useMemo(() => {
    // The map keeps a whole lodging or place while ANY stay or visit is in the
    // range; the strip counts only the stays and visits that are.
    const inRange = (d: string | null): boolean =>
      d !== null && (!from && !to ? true : intervalOverlapsRange(d, d, from, to));
    const toursOf = (kind: TourSummary["kind"]): string[] =>
      tours.filter((t) => t.kind === kind).map((t) => t.startDate ?? "");
    return [
      ...transport,
      { domain: "tour", dates: toursOf("tour") },
      { domain: "roadtrip", dates: toursOf("roadtrip") },
      {
        domain: "lodging",
        dates: lodgings.flatMap((l) => (l.stays ?? []).map((s) => s.checkIn).filter(inRange)),
      },
      {
        domain: "poi",
        dates: places.flatMap((p) =>
          (p.visits ?? [])
            .filter((v) => classifyVisit(v) === "visited")
            .map((v) => v.visitedAt)
            .filter(inRange)
        ),
      },
    ];
  }, [transport, lodgings, places, tours, from, to]);
}
