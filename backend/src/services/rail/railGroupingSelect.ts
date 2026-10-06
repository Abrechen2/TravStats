import type { Prisma } from "../../prisma";
import type { GroupableRailLeg } from "../../shared/railJourneyGrouping";

/**
 * The columns `groupRailLegs` reads — every reader that groups legs into rides
 * (the connection list, the departure reminders, "Als nächstes") selects at
 * least these, so none of them can feed the rule a leg it would misread.
 * Typed against `GroupableRailLeg`, so a field the rule starts to read and a
 * reader forgets fails the build rather than grouping on `undefined`.
 */
export const RAIL_GROUPING_SELECT = {
  id: true,
  bookingId: true,
  depStationId: true,
  arrStationId: true,
  depStationName: true,
  arrStationName: true,
  depLat: true,
  depLon: true,
  arrLat: true,
  arrLon: true,
  departureTime: true,
  arrivalTime: true,
  depPrecision: true,
  arrPrecision: true,
} as const satisfies Prisma.RailJourneySelect & Record<keyof GroupableRailLeg, true>;
