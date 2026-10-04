import type { SummaryFigure } from "../../components/table/ListSummaryStrip";
import type { RailListSummary } from "../api/rail";

/**
 * The three numbers above the train list, over the whole FILTERED list —
 * nothing estimated. The list is server-paged (forgejo#197), so the server
 * counts (`backend/src/shared/listSummary.ts`) and this only formats; counted
 * from the rows on screen it described one page and called it the logbook.
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
 * Lives here rather than in the page so it can be tested without rendering.
 */
export function railSummaryFigures(
  summary: RailListSummary,
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
  return [
    {
      key: "journeys",
      value: String(summary.journeys),
      label: labels.journeys(summary.journeys),
    },
    {
      key: "operators",
      value: String(summary.operators),
      label: labels.operators(summary.operators),
      ...(summary.withoutOperator > 0
        ? { note: labels.withoutOperator(summary.withoutOperator) }
        : {}),
    },
    {
      key: "stations",
      value: String(summary.stations),
      label: labels.stations(summary.stations),
    },
  ];
}
