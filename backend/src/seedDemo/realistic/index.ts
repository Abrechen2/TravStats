import { BUSINESS_TRIPS } from "./data/business";
import { WISHLIST, HOME_PLACES } from "./data/extras";
import { EARLY_TRIPS } from "./data/tripsEarly";
import { MIDDLE_TRIPS } from "./data/tripsMiddle";
import { RECENT_TRIPS } from "./data/tripsRecent";
import type { TripSpec } from "./data/types";
import { buildContext } from "./context";
import { settleInbox, writeHomePlaces, writeLists, writeMemberships } from "./writeExtras";
import { writeTrip, type TripCounts } from "./writeTrip";

/**
 * The demo account's content: one traveller from the Rhineland, ten years of
 * trips from Köln/Bonn and Düsseldorf, relative to the run's own "now".
 */

export const ALL_TRIPS: readonly TripSpec[] = [
  ...EARLY_TRIPS,
  ...MIDDLE_TRIPS,
  ...RECENT_TRIPS,
  ...BUSINESS_TRIPS,
];

export type RealisticCounts = TripCounts & {
  trips: number;
  memberships: number;
  lists: number;
  openSuggestions: number;
};

export async function seedRealisticDemo(userId: string, now: Date): Promise<RealisticCounts> {
  const extraCurated = [...HOME_PLACES.map((h) => h.place), ...WISHLIST].flatMap((p) =>
    p.curated ? [p.curated] : []
  );
  const ctx = await buildContext(userId, now, ALL_TRIPS, extraCurated);
  const memberships = await writeMemberships(ctx);

  const totals: TripCounts = {
    flights: 0,
    rail: 0,
    stays: 0,
    visits: 0,
    cruises: 0,
    roadtrips: 0,
    tours: 0,
    tracks: 0,
    journal: 0,
  };
  // A house or a sight that comes back on a later trip is written once, by
  // whichever trip reaches it first, and visited again by the others.
  for (const spec of ALL_TRIPS) {
    const counts = await writeTrip(ctx, spec);
    for (const key of Object.keys(totals) as Array<keyof TripCounts>) totals[key] += counts[key];
  }
  await writeHomePlaces(ctx);
  const lists = await writeLists(ctx);
  const inbox = await settleInbox(ctx);
  const trips = ALL_TRIPS.filter((t) => !t.ungrouped).length;
  return { ...totals, trips, memberships, lists, openSuggestions: inbox.open };
}
