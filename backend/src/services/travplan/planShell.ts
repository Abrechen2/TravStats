import type { Prisma } from "../../prisma";

/**
 * The trip relations that are actual travel. A trip with none of them holds no evidence that
 * anything happened - only what a plan mirrored onto it.
 */
export const ACTUAL_TRIP_RELATIONS = [
  "flights",
  "lodgingStays",
  "railJourneys",
  "busJourneys",
  "ferryJourneys",
  "cruises",
  "rentalBookings",
  "journalEntries",
  "placeVisits",
  "stops",
] as const;

/**
 * Every trip EXCEPT a plan's empty shell. Creating a travel plan creates a real Trip (status
 * "planned"); until something is booked or lived on it, that row counted as a trip in the travel
 * account and was listed to comparison friends. The marker is the plan itself plus the absence
 * of every actual relation, so the trip counts again the moment one entry lands on it.
 */
export const NOT_PLAN_SHELL: Prisma.TripWhereInput = {
  OR: [
    { travelPlan: { is: null } },
    ...ACTUAL_TRIP_RELATIONS.map((relation) => ({ [relation]: { some: {} } })),
  ],
};
