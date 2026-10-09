/**
 * What a BUS RIDE proves about a country (forgejo#265, spec 2026-10-07 §6
 * D4: "a coach across a border is the same evidence a train is") — the
 * passport, the country drill-down and the country badges ask it here.
 *
 * The ends are graded by `./railEvidence.ts`'s `railEnds`, the structural
 * rule for any ride on the ground: an end is a terminal the traveller stood
 * at; an arrival followed by the next ride leaving the same country is a
 * spell — `slept` across a day change, `visited` on a same-day return,
 * `transited` on a same-day onward change — and an end without a partner is
 * `visited`. The day keys are the terminals' calendars (a zone-less terminal
 * reads as UTC, the bus abstention, which is rail's too). Rides are walked
 * among themselves; a coach followed by a train is two separate walks, so a
 * change from coach to train grades each end `visited`, never wrongly
 * `slept`.
 *
 * Only completed rides (`shared/busCounting.ts`). Behind the bus beta switch:
 * the loaders read these only while the user sees the bus domain.
 */

import { prisma } from "../../db";
import type { EvidenceInput } from "../../shared/countryEvidence";
import { countableBusWhere } from "../../shared/busCounting";
import { railEnds, type RailEnd } from "./railEvidence";

/** A graded terminal end; the shape rail's ends have, `rideId` naming the bus ride. */
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
    })
  );
}

/** The fold's inputs for every end, as `bus` evidence. */
export function busEvidence(ends: readonly BusEnd[]): EvidenceInput[] {
  return ends.map((e) => ({
    country: e.country,
    kind: "bus",
    tier: e.tier,
    at: e.at,
    days: e.days,
  }));
}
