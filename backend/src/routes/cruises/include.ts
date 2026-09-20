import { Prisma } from "../../prisma";

/**
 * What a cruise carries when it is READ — list rows and the detail page alike.
 *
 * Its own file since the list handler moved out of `routes/cruises.ts`: both
 * need it, and importing it back from the router would be a cycle. One
 * definition, so a field the detail page gains cannot go missing from the row.
 */
export const CRUISE_INCLUDE = {
  ship: true,
  departurePort: true,
  arrivalPort: true,
  // Only id + name: the cruise list and detail need to SHOW which trip a
  // cruise belongs to, and pulling the whole Trip row (with its own relations)
  // into every list entry would be paid on all 500 rows for two fields.
  trip: { select: { id: true, name: true, color: true } },
  stops: { include: { port: true }, orderBy: { dayNumber: "asc" as const } },
  legs: { orderBy: { ordinal: "asc" as const } },
} satisfies Prisma.CruiseInclude;
