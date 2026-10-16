/**
 * The PORT ENDS of ferry crossings — the passport, the country drill-down
 * and the country badges read them here, as they read bus terminals.
 *
 * Owner ruling 2026-10-16 #3 on forgejo#299: a ferry crossing counts like a
 * flight, train or coach, in ONE chain with them (`./journeyEvidence.ts`) —
 * out and back to the same destination is a visit, the port of an
 * intermediate leg is ground presence, an open chain is unclear. Rental cars
 * do not join the chain. The ends come from `./railEvidence.ts`'s `railEnds`,
 * each carrying its crossing as a `ferry` leg; the day keys are the
 * terminals' calendars.
 *
 * Only completed crossings (`shared/ferryCounting.ts`). Behind the ferry
 * beta switch: the loaders read these only while the user sees the domain.
 */

import { prisma } from "../../db";
import { countableFerryWhere } from "../../shared/ferryCounting";
import { railEnds, type RailEnd } from "./railEvidence";

/** A port end; the shape rail's ends have, `rideId` naming the crossing. */
export type FerryEnd = RailEnd;

export async function loadFerryEnds(userId: string): Promise<FerryEnd[]> {
  const rows = await prisma.ferryJourney.findMany({
    where: { userId, ...countableFerryWhere() },
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
    "ferry"
  );
}
