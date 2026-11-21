import type { SummaryFigure } from "../../components/table/ListSummaryStrip";
import type { TourSummary } from "../api/tourIndex";

/**
 * The figures above the tour list, counted from the rows the list shows.
 *
 * Counts only: a tour's distance is a recording's length for one and the sum
 * of straight legs for another (`distanceSource`), so adding them into one
 * headline would present a mix of measured and estimated as a single figure.
 */
export function tourSummaryFigures(
  tours: readonly TourSummary[],
  labels: {
    tours: (count: number) => string;
    trips: (count: number) => string;
    withoutTrip: (count: number) => string;
  }
): SummaryFigure[] {
  const trips = new Set(tours.flatMap((tour) => (tour.tripId === null ? [] : [tour.tripId])));
  const without = tours.filter((tour) => tour.tripId === null).length;
  return [
    {
      key: "tours",
      value: String(tours.length),
      label: labels.tours(tours.length),
      ...(without > 0 ? { note: labels.withoutTrip(without) } : {}),
    },
    // A "0 trips" next to "4 without a trip" says the same thing twice.
    ...(trips.size > 0
      ? [{ key: "trips", value: String(trips.size), label: labels.trips(trips.size) }]
      : []),
  ];
}
