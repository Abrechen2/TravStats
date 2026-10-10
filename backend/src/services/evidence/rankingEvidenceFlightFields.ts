import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { rankingKey, type EvidenceScope } from "../../shared/evidence";
import { countableFlightWhere } from "../../shared/flightCounting";
import type { EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { FLIGHT_DAY_SELECT, flightDateOf, hydrateFlightSumEntries } from "./entryMappers";
import { withDepartureClock } from "../stats/departureClock";

/**
 * The flights behind one row of the flight tab's breakdown (forgejo#256): a
 * stored status or a boarding group, matched exactly as the page groups them
 * (`flight.status`, `flight.boardingGroup`), over the countable flights.
 */
type Dimension = "flightStatus" | "boardingGroup";

export async function resolveFlightFieldRankingEvidence(
  userId: string,
  dimension: Dimension,
  value: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse | null> {
  if (scope.period.kind !== "allTime") {
    throw new AppError(
      `${dimension} ranking evidence only supports period=allTime; got period=${scope.period.kind}.`,
      400
    );
  }
  const match = dimension === "flightStatus" ? { status: value } : { boardingGroup: value };
  const rows = await withDepartureClock(
    await prisma.flight.findMany({
      // AND, never a spread: a `status` in `match` must narrow the countable
      // statuses, not replace them (a planned flight is in no row).
      where: { AND: [{ userId, ...countableFlightWhere() }, match] },
      select: { id: true, ...FLIGHT_DAY_SELECT },
    })
  );
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    userId,
    rows.map((row) => ({ id: row.id, date: flightDateOf(row), contribution: 1 })),
    page
  );
  return {
    measure: {
      kind: "ranking",
      key: rankingKey(dimension, value),
      aggregation: "sum",
      // A status is a word for the reader's language, one key each; a boarding
      // group is the airline's own mark and is shown as it is.
      label:
        dimension === "flightStatus"
          ? { key: `evidence.ranking.flightStatus.${value}` }
          : { key: "evidence.ranking.boardingGroup", values: { value } },
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
