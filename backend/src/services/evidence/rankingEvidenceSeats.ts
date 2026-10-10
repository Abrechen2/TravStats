import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { rankingKey, type EvidenceScope } from "../../shared/evidence";
import { countableFlightWhere } from "../../shared/flightCounting";
import type { EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { FLIGHT_DAY_SELECT, flightDateOf, hydrateFlightSumEntries } from "./entryMappers";
import { withDepartureClock } from "../stats/departureClock";
import { seatFactsOf, type SeatRow } from "../stats/seatStats";

/**
 * The flights behind one figure of the flight tab's seat section
 * (forgejo#256) — `seat:<facet>:<value>`, see `shared/evidence.ts`. Every
 * facet is read through `seatFactsOf`, the reading `computeSeatStats` counts
 * with, over the same countable flights `/stats/page` loads.
 */
const FACETS: Record<string, (row: SeatRow, value: string) => boolean> = {
  position: (row, value) => seatFactsOf(row).position === value,
  zone: (row, value) => seatFactsOf(row).zone === value,
  class: (row, value) => row.seatClass === value,
  number: (row, value) => seatFactsOf(row).seat === value.toUpperCase(),
  row: (row, value) => value === "numbered" && seatFactsOf(row).row !== null,
};

/** Named facets carry a key per value (a position's NAME is the reader's language). */
const NAMED: Record<string, readonly string[]> = {
  position: ["window", "middle", "aisle", "unknown"],
  zone: ["front", "middle", "back"],
  class: ["economy", "premium_economy", "business", "first"],
  row: ["numbered"],
};

function seatLabel(facet: string, value: string): EvidenceResponse["measure"]["label"] {
  return NAMED[facet]?.includes(value)
    ? { key: `evidence.ranking.seat.${facet}.${value}` }
    : { key: `evidence.ranking.seat.${facet}`, values: { value } };
}

export async function resolveSeatRankingEvidence(
  userId: string,
  value: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse | null> {
  const at = value.indexOf(":");
  const facet = at > 0 ? FACETS[value.slice(0, at)] : undefined;
  const wanted = value.slice(at + 1);
  if (!facet || !wanted) return null;
  if (scope.period.kind !== "allTime") {
    throw new AppError(
      `seat ranking evidence only supports period=allTime; got period=${scope.period.kind}.`,
      400
    );
  }
  const rows = (
    await withDepartureClock(
      await prisma.flight.findMany({
        where: { userId, ...countableFlightWhere() },
        select: { id: true, seatNumber: true, seatClass: true, ...FLIGHT_DAY_SELECT },
      })
    )
  ).filter((row) => facet(row, wanted));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    userId,
    rows.map((row) => ({ id: row.id, date: flightDateOf(row), contribution: 1 })),
    page
  );
  return {
    measure: {
      kind: "ranking",
      key: rankingKey("seat", value),
      aggregation: "sum",
      label: seatLabel(value.slice(0, at), wanted),
      unit: "flights",
      value: rows.length,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedCount, contribution: omittedContribution },
    unattributed: [],
    page,
  };
}
