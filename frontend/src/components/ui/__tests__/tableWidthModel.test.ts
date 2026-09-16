import { describe, it, expect } from "vitest";
import { pickTier, tableMinWidth, type TableColumn } from "../Table";
import { FLIGHT_COLUMN_LAYOUT } from "../../flightsTable/FlightRow";
import { LODGING_COLUMN_LAYOUT } from "../../lodging/LodgingRow";
import { PLACE_COLUMN_LAYOUT } from "../../places/PlaceRow";
import { CRUISE_COLUMN_LAYOUT } from "../../Cruise/CruiseRow";

/**
 * The width model the four logbooks share.
 *
 * CT106 audit, B01: the flights table summed fixed tracks past its own width,
 * the one shrinkable column — the route — was laid out at 0px, and the actions
 * column sat outside a frame that clipped it. A layout test cannot see that in
 * jsdom, so what is pinned here is the arithmetic the browser relies on, and
 * the numbers every logbook declares. The rendering was checked in a browser
 * at 640, 768, 1024 and 1440px.
 */
const GAP = 14; // --ts-space-lg
const PADDING = 40; // 2 × --ts-space-xl
/** The list shell's table width at a 1440px viewport, as measured on CT106. */
const TABLE_AT_1440 = 1150;

const columnsOf = (
  layout: Record<string, Pick<TableColumn, "min" | "grow" | "priority">>
): TableColumn[] => Object.entries(layout).map(([key, l]) => ({ key, label: key, ...l }));

const LOGBOOKS = {
  flights: columnsOf(FLIGHT_COLUMN_LAYOUT),
  lodging: columnsOf(LODGING_COLUMN_LAYOUT),
  places: columnsOf(PLACE_COLUMN_LAYOUT),
  cruises: columnsOf(CRUISE_COLUMN_LAYOUT),
};

describe("table width model", () => {
  it("counts every column, and the gaps and padding between them", () => {
    const cols: TableColumn[] = [
      { key: "a", label: "a", min: 100 },
      { key: "b", label: "b", min: 50, grow: 1 },
    ];
    expect(tableMinWidth(cols, GAP, PADDING)).toBe(100 + 50 + GAP + PADDING);
  });

  it("drops priority 3 before priority 2, and never priority 1", () => {
    const cols: TableColumn[] = [
      { key: "core", label: "core", min: 300 },
      { key: "extra", label: "extra", min: 200, priority: 2 },
      { key: "luxury", label: "luxury", min: 200, priority: 3 },
    ];
    const all = tableMinWidth(cols, GAP, PADDING);
    expect(pickTier(cols, all, GAP, PADDING)).toBe(3);
    expect(pickTier(cols, all - 1, GAP, PADDING)).toBe(2);
    expect(pickTier(cols, 300 + PADDING, GAP, PADDING)).toBe(1);
    // Too narrow even for the core: tier 1 still, and the table scrolls.
    expect(pickTier(cols, 10, GAP, PADDING)).toBe(1);
  });

  describe.each(Object.entries(LOGBOOKS))("the %s logbook", (_name, columns) => {
    it("gives every column a real minimum — 0 is how the route vanished", () => {
      for (const column of columns) expect(column.min, column.key).toBeGreaterThan(0);
    });

    it("fits every column into the list shell at 1440px", () => {
      expect(tableMinWidth(columns, GAP, PADDING)).toBeLessThanOrEqual(TABLE_AT_1440);
    });

    it("keeps the columns a phone row needs out of the ones that step aside", () => {
      for (const column of columns) {
        if (column.onNarrow && column.onNarrow !== "hide") {
          expect(column.priority ?? 1, column.key).toBe(1);
        }
      }
    });
  });
});
