import type { SummaryFigure } from "../../components/table/ListSummaryStrip";
import type { RailJourney } from "../../types/rail";

/**
 * The three numbers above the train list, read straight off the rows on
 * screen — nothing estimated.
 *
 * DISTANCE IS DELIBERATELY ABSENT, for the same reason the flight list leaves
 * it out (`flightSummaryFigures.ts`). A ride logged without a traced line
 * carries the great-circle chord, which the row itself marks as such; summing
 * traced and straight-line kilometres into one headline would present a mix
 * of measured and estimated as a single measured figure. `/stats` is where a
 * distance total belongs, with its own wording about what it contains.
 *
 * Operators count what a row RECORDS, not what could be guessed from a train
 * number — the same discipline the airline figure follows. A ride with no
 * operator is simply not counted, and the note says so rather than letting
 * "4 journeys · 2 operators" read as a contradiction.
 *
 * Lives here rather than in the page so it can be tested without rendering,
 * and because `RailPage` should not grow a second job.
 */
export function railSummaryFigures(
  journeys: readonly RailJourney[],
  labels: {
    /** Each takes its count so `t()` can pick the singular ("1 Fahrt", forgejo#160). */
    journeys: (count: number) => string;
    operators: (count: number) => string;
    stations: (count: number) => string;
    /**
     * A FUNCTION, not a formatted string: the count belongs to `t()` so
     * i18next can pick the plural form, and so the interpolation guard
     * (`i18n/__tests__/interpolationArgs.test.ts`) can see the value being
     * passed. Substituting `{{count}}` by hand here satisfied neither.
     */
    withoutOperator: (count: number) => string;
  }
): SummaryFigure[] {
  const operators = new Set<string>();
  let withoutOperator = 0;
  const stations = new Set<string>();

  for (const j of journeys) {
    const operator = j.operator?.trim();
    if (operator) operators.add(operator.toLocaleLowerCase());
    else withoutOperator += 1;
    // Station identity is the name as recorded; a ride that names neither end
    // contributes nothing rather than an empty-string "station".
    if (j.depStationName?.trim()) stations.add(j.depStationName.trim().toLocaleLowerCase());
    if (j.arrStationName?.trim()) stations.add(j.arrStationName.trim().toLocaleLowerCase());
  }

  return [
    { key: "journeys", value: String(journeys.length), label: labels.journeys(journeys.length) },
    {
      key: "operators",
      value: String(operators.size),
      label: labels.operators(operators.size),
      ...(withoutOperator > 0 ? { note: labels.withoutOperator(withoutOperator) } : {}),
    },
    { key: "stations", value: String(stations.size), label: labels.stations(stations.size) },
  ];
}
