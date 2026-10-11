/**
 * `_count` on a trip from `GET /trips`: the size of each linked collection.
 * Its own file because `types/index.ts` sits at the 800-line limit.
 */
export interface TripCounts {
  flights: number;
  cruises?: number;
  lodgingStays?: number;
  routes?: number;
  photos?: number;
  /** forgejo#169 — the other areas the trip page lists, so the card counts them. */
  railJourneys?: number;
  /** forgejo#289 — bus rides, counted on the card like rail. */
  busJourneys?: number;
  rentalBookings?: number;
  roadtrips?: number;
}
