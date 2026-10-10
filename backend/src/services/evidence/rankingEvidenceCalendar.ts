import { AppError } from "../../middleware/errorHandler";
import { rankingKey, type EvidenceScope } from "../../shared/evidence";
import type { EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { flightDateOf, hydrateFlightSumEntries } from "./entryMappers";
import { loadCountableCodeRows } from "./flightPopulations";
import { departureClockOf } from "../../utils/stats/departureClock";

/**
 * The bars of the flight tab's seasonal and weekday charts (forgejo#256): the
 * countable flights departing in one calendar month, or on one weekday, read
 * on the departure airport's clock (`departureClockOf`) — the day the chart
 * files each flight under. A flight with no departure time is in no bar.
 *
 * A year-only entry's placeholder is 1 January (`placeholderDayOf`), so it
 * sits in January and on that date's weekday, exactly as the chart counts it.
 */
type Dimension = "departureMonth" | "departureWeekday";

const RANGE: Record<Dimension, { min: number; max: number }> = {
  departureMonth: { min: 1, max: 12 },
  departureWeekday: { min: 0, max: 6 },
};

export async function resolveCalendarRankingEvidence(
  userId: string,
  dimension: Dimension,
  value: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse | null> {
  const { min, max } = RANGE[dimension];
  if (!/^\d{1,2}$/.test(value) || Number(value) < min || Number(value) > max) return null;
  if (scope.period.kind !== "allTime") {
    throw new AppError(
      `${dimension} ranking evidence only supports period=allTime; got period=${scope.period.kind}.`,
      400
    );
  }
  const wanted = Number(value);
  const rows = (await loadCountableCodeRows(userId)).filter((row) => {
    const clock = departureClockOf(row);
    if (!clock) return false;
    return dimension === "departureMonth" ? clock.month + 1 === wanted : clock.weekday === wanted;
  });
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    userId,
    rows.map((row) => ({ id: row.id, date: flightDateOf(row), contribution: 1 })),
    page
  );
  return {
    measure: {
      kind: "ranking",
      key: rankingKey(dimension, String(wanted)),
      aggregation: "sum",
      // One key per bar: the month or weekday NAME belongs to the reader's language.
      label: { key: `evidence.ranking.${dimension}.${wanted}` },
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
