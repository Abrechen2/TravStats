import type { Trip, TripStop } from "../../types";

/**
 * What the map draws, and nothing else. Narrower than `Trip` on purpose: a
 * roadtrip page and a standalone tour page (2.7) have no trip, but they have
 * stops and stays to draw — they hand in exactly these fields rather than a
 * trip-shaped object with invented ids around them.
 */
export type TripMapContent = Pick<Trip, "flights" | "cruises" | "lodgingStays"> & {
  stops?: ReadonlyArray<Pick<TripStop, "title" | "lat" | "lon" | "domain">>;
};
