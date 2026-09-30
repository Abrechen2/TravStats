/**
 * The rail station ends the passport and the country drill-down read, loaded
 * once and already graded by `./railEvidence.ts` — the same rows for both, so
 * a passport row and the page behind it agree about which ride proved a
 * country (the contract `./roadtripEvidenceLoader.ts` keeps for stations).
 */

import { prisma } from "../../db";
import { countableRailWhere } from "../../shared/railCounting";
import { railEnds, type RailEnd } from "./railEvidence";

export async function loadRailEnds(userId: string): Promise<RailEnd[]> {
  const rows = await prisma.railJourney.findMany({
    where: { userId, ...countableRailWhere() },
    select: {
      id: true,
      trainCategory: true,
      trainNumber: true,
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
      const train = [r.trainCategory, r.trainNumber].filter(Boolean).join(" ");
      const route = `${r.depStationName} → ${r.arrStationName}`;
      return { ...r, label: train ? `${train} · ${route}` : route };
    })
  );
}
