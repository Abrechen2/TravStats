import { z } from "zod";
import type { Prisma } from "../../prisma";
import { prisma } from "../../db";
import { TRIPS_LIST_CAP } from "./tripsListInclude";

const TRIP_STATUSES = ["planned", "in_progress", "completed"] as const;
const TRIP_CATEGORIES = ["vacation", "business", "weekend", "family", "other"] as const;

/** A non-negative integer arriving as a query string; anything else is a 400, not a silent default. */
const intParam = (min: number, max: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));

/**
 * `GET /trips` query. Every param is optional and additive: a caller that
 * sends none (the Companion, the many pickers) gets the list it always got.
 * NOT `z.coerce.boolean()` for the flag: `Boolean("false")` is true.
 */
export const tripsListQuerySchema = z.object({
  includeInsights: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  /** Case-insensitive match on name, labels, description, notes, tags, companions, countries. */
  q: z.string().trim().max(200).optional(),
  status: z.enum(TRIP_STATUSES).optional(),
  category: z.enum(TRIP_CATEGORIES).optional(),
  /** Page size, 1..500. Absent = the 500 cap. */
  limit: intParam(1, TRIPS_LIST_CAP).optional(),
  /** Rows to skip in the (createdAt desc, id desc) order. */
  offset: intParam(0, 1_000_000).optional(),
});

export type TripsListQuery = z.infer<typeof tripsListQuerySchema>;

/** True when the caller used any of the paging/search/filter params. */
export function isPagedQuery(query: TripsListQuery): boolean {
  return (
    query.q !== undefined ||
    query.status !== undefined ||
    query.category !== undefined ||
    query.limit !== undefined ||
    query.offset !== undefined
  );
}

/** The text clause alone; the status and category pills' counts are taken under it. */
export function searchWhere(userId: string, q: string | undefined): Prisma.TripWhereInput {
  const needle = q?.trim();
  if (!needle) return { userId };
  const contains = { contains: needle, mode: "insensitive" as const };
  return {
    userId,
    OR: [
      { name: contains },
      { destinationLabel: contains },
      { originLabel: contains },
      { description: contains },
      { notes: contains },
      // Array columns can only be matched whole; the case is the user's own.
      { tags: { has: needle } },
      { companions: { has: needle } },
      { countries: { has: needle.toUpperCase() } },
    ],
  };
}

export function tripsListWhere(userId: string, query: TripsListQuery): Prisma.TripWhereInput {
  return {
    ...searchWhere(userId, query.q),
    ...(query.status && { status: query.status }),
    ...(query.category && { category: query.category }),
  };
}

/** Counts per status and per category under the text search, for the filter pills. */
export async function tripsListFacets(
  userId: string,
  q: string | undefined
): Promise<{ status: Record<string, number>; category: Record<string, number> }> {
  const where = searchWhere(userId, q);
  const [byStatus, byCategory] = await Promise.all([
    prisma.trip.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.trip.groupBy({ by: ["category"], where, _count: { _all: true } }),
  ]);
  return {
    status: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    category: Object.fromEntries(
      byCategory.filter((r) => r.category !== null).map((r) => [r.category, r._count._all])
    ),
  };
}
