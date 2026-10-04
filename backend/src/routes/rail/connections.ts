import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { railQuerySchema } from "../../schemas/rail";
import { groupRailLegs } from "../../shared/railJourneyGrouping";
import { withStationShortCodes } from "../../services/rail/railStations";
import { withRailTimes } from "../../services/rail/timesDto";
import { withRailSource } from "../../services/rail/railSource";
import { buildRailWhere, RAIL_INCLUDE } from "../rail";
import { railListSummary } from "../../shared/listSummary";

/**
 * The rail logbook read as CONNECTIONS (forgejo#187): a ride with changes of
 * trains is one entry carrying its legs, a ride without is an entry of one.
 * Which legs belong together is decided in `shared/railJourneyGrouping.ts`
 * and nowhere else. Presentation only — every figure keeps counting legs.
 *
 * Mounted at /api/v1/rail/connections, ahead of the rail router, whose `/:id`
 * would otherwise take "connections" for a journey id. Enveloped, as the rest
 * of the rail family; answers whatever the beta switch says.
 *
 * Grouping happens here, not in the browser, because the list is paged: a
 * page of legs can end between two trains of one ride, and the client cannot
 * know that the next page continues it.
 */
const router = Router();
router.use(authenticate);

const DEFAULT_LIMIT = 100;

/**
 * The leg list's filters, minus the two that make no sense here: a loyalty
 * card's view lists the rides the card COUNTED (legs — it stays on `GET
 * /rail`), and the only order a connection has is its first departure.
 * Strict, so an unsupported `sort` is refused rather than silently ignored.
 */
export const railConnectionQuerySchema = railQuerySchema
  .pick({ status: true, q: true, year: true, tripId: true, limit: true, offset: true, order: true })
  .strict();

/** The columns the grouping rule reads — nothing a list row would draw. */
const GROUPING_SELECT = {
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
  // For the summary strip, which counts every matching train, not this page.
  operator: true,
} satisfies Prisma.RailJourneySelect;

/** The full rows of `ids`, as the leg list sends them, keyed by id. */
async function loadLegs(userId: string, ids: string[]) {
  const rows = await prisma.railJourney.findMany({
    where: { userId, id: { in: ids } },
    include: RAIL_INCLUDE,
  });
  return new Map(
    rows.map((row) => [row.id, withRailSource(withStationShortCodes(withRailTimes(row)))])
  );
}

/** A connection is named by its first leg; any of its legs finds it. */
function connectionOf<T extends { id: string }>(
  group: ReadonlyArray<{ id: string }>,
  rows: Map<string, T>
): { id: string; legs: T[] } {
  return {
    id: group[0].id,
    legs: group.map((leg) => rows.get(leg.id)).filter((row): row is T => row !== undefined),
  };
}

// One page of connections. The grouping is derived, so it cannot be a SQL
// bound: the user's legs are read narrow (GROUPING_SELECT), grouped, filtered
// and ordered, and only THEN sliced — the full rows are fetched for the page
// alone. A connection matches a filter when any of its legs does, and it is
// always sent whole: a search for the station changed at finds the ride.
router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const parsed = railConnectionQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const query = parsed.data;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    const [all, matching] = await Promise.all([
      prisma.railJourney.findMany({ where: { userId }, select: GROUPING_SELECT }),
      prisma.railJourney.findMany({
        where: await buildRailWhere(query, userId),
        select: { id: true },
      }),
    ]);
    const matched = new Set(matching.map((row) => row.id));
    // groupRailLegs answers oldest first, with a total order.
    const groups = groupRailLegs(all).filter((group) => group.some((leg) => matched.has(leg.id)));
    if (query.order === "desc") groups.reverse();

    const page = groups.slice(offset, offset + limit);
    const rows = await loadLegs(
      userId,
      page.flatMap((group) => group.map((leg) => leg.id))
    );
    res.json({
      success: true,
      data: page.map((group) => connectionOf(group, rows)),
      meta: {
        total: groups.length,
        legTotal: groups.reduce((sum, group) => sum + group.length, 0),
        summary: railListSummary(groups.flat()),
        limit,
        offset,
      },
    });
  } catch (err) {
    next(err);
  }
});

// The connection a leg belongs to. Grouping never crosses a booking, so the
// leg's booking is all that has to be read.
router.get("/:legId", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const leg = await prisma.railJourney.findFirst({
      where: { id: req.params.legId, userId },
      select: { id: true, bookingId: true, booking: { select: { id: true, pnr: true } } },
    });
    if (!leg) throw new AppError("Rail journey not found", 404);

    const siblings = await prisma.railJourney.findMany({
      where: leg.bookingId ? { userId, bookingId: leg.bookingId } : { userId, id: leg.id },
      select: GROUPING_SELECT,
    });
    const group = groupRailLegs(siblings).find((g) => g.some((l) => l.id === leg.id));
    if (!group) throw new AppError("Rail journey not found", 404);
    const rows = await loadLegs(
      userId,
      group.map((l) => l.id)
    );
    res.json({ success: true, data: { ...connectionOf(group, rows), booking: leg.booking } });
  } catch (err) {
    next(err);
  }
});

export default router;
