import { prisma } from "../../../db";
import { LEG_MODES, type LegMode } from "../tourDistance";
import { isRoutableMode } from "./types";

/**
 * What a bulk re-route (forgejo#436) may touch, and in which order.
 *
 * Two kinds carry a line a road router serves: a roadtrip or tour leg
 * (`trip_route_legs`) and a coach ride (`bus_journeys`). Rental bookings have no
 * geometry, ferries use the sea router and rail has its own re-route, so none
 * of them is an item here.
 *
 * The source decides what is replaceable, and the rule is the same for both:
 * a line the user drew (`drawn`, bus `manual`) or recorded (`track`) is never
 * replaced, and neither is a bus timetable line (`transitous`). `straight` is
 * "never routed"; `all` adds the provider's own earlier line (`routed`, bus `road`).
 */

export type RerouteMode = "straight" | "all";
export type RerouteItemKind = "leg" | "bus";

/** Walked in this order; the cursor is `<kind>:<id>` of the last item handled. */
export const ITEM_KINDS: readonly RerouteItemKind[] = ["leg", "bus"];

export const LEG_SOURCES: Record<RerouteMode, readonly ("straight" | "routed")[]> = {
  straight: ["straight"],
  all: ["straight", "routed"],
};
export const BUS_SOURCES: Record<RerouteMode, readonly string[]> = {
  straight: ["straight"],
  all: ["straight", "road"],
};

const ROUTABLE_LEG_MODES = LEG_MODES.filter((m): m is LegMode => isRoutableMode(m));

export interface RunScope {
  scope: "instance" | "roadtrip";
  routeId: string | null;
  mode: RerouteMode;
}

export interface LegItem {
  kind: "leg";
  id: string;
  userId: string;
  mode: string;
  source: "straight" | "routed";
  updatedAt: Date;
  vehicle: string | null;
  from: { lat: number | null; lon: number | null };
  to: { lat: number | null; lon: number | null };
}
export interface BusItem {
  kind: "bus";
  id: string;
  userId: string;
}
export type RerouteItem = LegItem | BusItem;

export function parseCursor(cursor: string | null): { kind: RerouteItemKind; id: string } | null {
  if (!cursor) return null;
  const at = cursor.indexOf(":");
  const kind = ITEM_KINDS.find((k) => k === cursor.slice(0, at));
  return kind ? { kind, id: cursor.slice(at + 1) } : null;
}

const kindsOf = (run: RunScope): readonly RerouteItemKind[] =>
  run.scope === "roadtrip" ? ["leg"] : ITEM_KINDS;

const legWhere = (run: RunScope) => ({
  source: { in: [...LEG_SOURCES[run.mode]] },
  mode: { in: ROUTABLE_LEG_MODES },
  ...(run.routeId ? { routeId: run.routeId } : {}),
});

/** The next item after `cursor`, or null when the walk is over. */
export async function nextItem(run: RunScope, cursor: string | null): Promise<RerouteItem | null> {
  const at = parseCursor(cursor);
  for (const kind of kindsOf(run)) {
    if (at && ITEM_KINDS.indexOf(kind) < ITEM_KINDS.indexOf(at.kind)) continue;
    const after = at && at.kind === kind ? { id: { gt: at.id } } : {};
    if (kind === "leg") {
      const leg = await prisma.tripRouteLeg.findFirst({
        where: { ...legWhere(run), ...after },
        orderBy: { id: "asc" },
        select: {
          id: true,
          mode: true,
          source: true,
          updatedAt: true,
          route: { select: { userId: true, vehicle: true } },
          fromStop: { select: { lat: true, lon: true } },
          toStop: { select: { lat: true, lon: true } },
        },
      });
      if (leg) {
        return {
          kind: "leg",
          id: leg.id,
          userId: leg.route.userId,
          mode: leg.mode,
          source: leg.source === "routed" ? "routed" : "straight",
          updatedAt: leg.updatedAt,
          vehicle: leg.route.vehicle,
          from: leg.fromStop,
          to: leg.toStop,
        };
      }
    } else {
      const ride = await prisma.busJourney.findFirst({
        where: { geometrySource: { in: [...BUS_SOURCES[run.mode]] }, ...after },
        orderBy: { id: "asc" },
        select: { id: true, userId: true },
      });
      if (ride) return { kind: "bus", id: ride.id, userId: ride.userId };
    }
  }
  return null;
}

/** How many items are still ahead of `cursor`; the denominator of the progress. */
export async function countRemaining(run: RunScope, cursor: string | null): Promise<number> {
  const at = parseCursor(cursor);
  let total = 0;
  for (const kind of kindsOf(run)) {
    if (at && ITEM_KINDS.indexOf(kind) < ITEM_KINDS.indexOf(at.kind)) continue;
    const after = at && at.kind === kind ? { id: { gt: at.id } } : {};
    total +=
      kind === "leg"
        ? await prisma.tripRouteLeg.count({ where: { ...legWhere(run), ...after } })
        : await prisma.busJourney.count({
            where: { geometrySource: { in: [...BUS_SOURCES[run.mode]] }, ...after },
          });
  }
  return total;
}
