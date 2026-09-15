import { describe, expect, it } from "vitest";
import { isEssential, NARROW_ESSENTIAL, type NarrowPlace } from "../components/table/narrowColumns";
import { CRUISE_COLUMN_LAYOUT } from "../components/Cruise/CruiseRow";
import { LODGING_COLUMN_LAYOUT } from "../components/lodging/LodgingRow";
import { PLACE_COLUMN_LAYOUT } from "../components/places/PlaceRow";
import { FLIGHT_COLUMN_LAYOUT } from "../components/flightsTable/FlightRow";
import { FLIGHT_ALWAYS_VISIBLE } from "../components/flightsTable/flightColumns";

/**
 * The owner's acceptance question for this round, as a test.
 *
 * "Route or destination, date and status have to stay visible on a phone, in
 * all four logbooks." Before this round every one of the four drew its own
 * `<table class="min-w-[960px]">` inside an `overflow-x-auto`: at 390px the
 * visible slice showed the leftmost columns and the answer to all three
 * questions sat off to the right, behind a horizontal scrollbar.
 *
 * The four now render through the `Table` primitive, which collapses into a
 * row below 640px and gives each column a place by name. What a test can hold
 * — and a screenshot cannot — is that the three places are actually taken,
 * in every domain, and that nothing can hide the columns that take them.
 *
 * It does NOT re-derive the rule from the layouts it checks. The rule is the
 * three names in `NARROW_ESSENTIAL`; each domain names them independently.
 */

type Layout = Record<string, { onNarrow?: NarrowPlace }>;

const LOGBOOKS: ReadonlyArray<{
  domain: string;
  layout: Layout;
  /** Columns the picker may never turn off. */
  alwaysVisible: readonly string[];
  /**
   * A domain may compose its subtitle in the row instead of borrowing a
   * column — flights do, because the date, the number and the duration are
   * three separate columns on a desktop and one line on a phone.
   */
  subtitleFromRow?: true;
}> = [
  {
    domain: "flights",
    layout: FLIGHT_COLUMN_LAYOUT,
    alwaysVisible: FLIGHT_ALWAYS_VISIBLE,
    subtitleFromRow: true,
  },
  {
    domain: "cruises",
    layout: CRUISE_COLUMN_LAYOUT,
    alwaysVisible: ["ship", "dates", "status", "actions"],
  },
  {
    domain: "lodging",
    layout: LODGING_COLUMN_LAYOUT,
    alwaysVisible: ["name", "lastStay", "status", "actions"],
  },
  {
    domain: "places",
    layout: PLACE_COLUMN_LAYOUT,
    alwaysVisible: ["name", "lastVisit", "status", "actions"],
  },
];

describe("a logbook row survives 390px", () => {
  it.each(LOGBOOKS)(
    "$domain fills every essential place exactly once",
    ({ layout, subtitleFromRow }) => {
      const taken = Object.values(layout)
        .map((column) => column.onNarrow)
        .filter(isEssential);

      const expected = subtitleFromRow
        ? NARROW_ESSENTIAL.filter((place) => place !== "subtitle")
        : NARROW_ESSENTIAL;

      // Sorted, because the order of the columns is not the point — that each
      // place is claimed, and claimed by one column, is.
      expect([...taken].sort()).toEqual([...expected].sort());
    }
  );

  it.each(LOGBOOKS)(
    "$domain cannot hide a column that an essential place depends on",
    ({ layout, alwaysVisible }) => {
      const hideable = Object.entries(layout)
        .filter(([id]) => !alwaysVisible.includes(id))
        .filter(([, column]) => isEssential(column.onNarrow))
        .map(([id]) => id);

      expect(
        hideable,
        "the column picker could turn this off, and the phone would lose the fact with it"
      ).toEqual([]);
    }
  );
});
