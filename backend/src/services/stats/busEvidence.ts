/**
 * The TERMINAL ENDS of bus rides (forgejo#265, spec 2026-10-07 §6 D4: "a
 * coach across a border is the same evidence a train is") — the passport, the
 * country drill-down and the country badges read them here.
 *
 * The ends come from `./railEvidence.ts`'s `railEnds`, each carrying its ride
 * as a `bus` leg of the travel chain. Owner ruling 2026-10-16 on forgejo#299:
 * a coach counts like a flight, in ONE chain with flights and trains
 * (`./journeyEvidence.ts`) — out and back to the same destination is a
 * visit, a change terminal is ground presence, an open chain is unclear. The
 * day keys are the terminals' calendars (a zone-less terminal reads as UTC,
 * the bus abstention, which is rail's too).
 *
 * Only completed rides (`shared/busCounting.ts`). Behind the bus beta switch:
 * the loaders read these only while the user sees the bus domain.
 */

import { prisma } from "../../db";
import { countableBusWhere } from "../../shared/busCounting";
import { railEnds, type RailEnd } from "./railEvidence";

/** A terminal end; the shape rail's ends have, `rideId` naming the bus ride. */
export type BusEnd = RailEnd;

export async function loadBusEnds(userId: string): Promise<BusEnd[]> {
  const rows = await prisma.busJourney.findMany({
    where: { userId, ...countableBusWhere() },
    select: {
      id: true,
      operator: true,
      depStationName: true,
      arrStationName: true,
      depCountry: true,
      arrCountry: true,
      depTimezone: true,
      arrTimezone: true,
      departureTime: true,
      arrivalTime: true,
    },
    orderBy: [{ departureTime: "asc" }, { id: "asc" }],
  });
  return railEnds(
    rows.map((r) => {
      const route = `${r.depStationName} → ${r.arrStationName}`;
      return { ...r, label: r.operator?.trim() ? `${r.operator.trim()} · ${route}` : route };
    }),
    "bus"
  );
}
