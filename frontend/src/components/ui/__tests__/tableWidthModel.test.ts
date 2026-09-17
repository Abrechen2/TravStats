import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { pickHidden, tableMinWidth, type TableColumn } from "../Table";
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
const TOKENS = readFileSync(resolve(process.cwd(), "src/theme/tokens.css"), "utf8");
const px = (name: string): number => {
  const match = TOKENS.match(new RegExp(`--ts-${name}: (\\d+)px`));
  if (!match) throw new Error(`--ts-${name} is not in tokens.css`);
  return Number(match[1]);
};
const SCREEN_PADDING = px("space-screen-padding");
const FRAME_BORDER = 2;
/** The table's width inside a page shell of `shellWidth` pixels. */
const tableIn = (shellWidth: number): number => shellWidth - 2 * SCREEN_PADDING - FRAME_BORDER;
/** The logbook shell at a 1440px viewport — capped by neither side. */
const TABLE_AT_1440 = tableIn(Math.min(1440, px("width-table")));

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

  it("steps aside priority 3 before priority 2, rightmost first, and never priority 1", () => {
    const cols: TableColumn[] = [
      { key: "core", label: "core", min: 300 },
      { key: "extraA", label: "extraA", min: 100, priority: 2 },
      { key: "extraB", label: "extraB", min: 100, priority: 2 },
      { key: "luxury", label: "luxury", min: 200, priority: 3 },
    ];
    const all = tableMinWidth(cols, GAP, PADDING);
    expect([...pickHidden(cols, all, GAP, PADDING)]).toEqual([]);
    expect([...pickHidden(cols, all - 1, GAP, PADDING)]).toEqual(["luxury"]);
    // One more column's worth short: the RIGHTMOST priority-2 goes, not both.
    expect([...pickHidden(cols, all - 200 - GAP - 1, GAP, PADDING)]).toEqual(["luxury", "extraB"]);
    // Too narrow even for the core: everything optional is gone, the core stays.
    expect([...pickHidden(cols, 10, GAP, PADDING)].sort()).toEqual(["extraA", "extraB", "luxury"]);
  });

  describe.each(Object.entries(LOGBOOKS))("the %s logbook", (_name, columns) => {
    it("gives every column a real minimum — 0 is how the route vanished", () => {
      for (const column of columns) expect(column.min, column.key).toBeGreaterThan(0);
    });

    it("keeps every priority-1 and priority-2 column in the list shell at 1440px", () => {
      const hidden = pickHidden(columns, TABLE_AT_1440, GAP, PADDING);
      for (const column of columns) {
        if ((column.priority ?? 1) < 3) expect(hidden.has(column.key), column.key).toBe(false);
      }
    });

    it("keeps the columns a phone row needs out of the ones that step aside", () => {
      for (const column of columns) {
        if (column.onNarrow && column.onNarrow !== "hide") {
          expect(column.priority ?? 1, column.key).toBe(1);
        }
      }
    });
  });

  // CT106 design-6 R02: at the old 1200px list shell flights, stays and cruises
  // hid columns the reader had ticked on every screen size, and the hint to
  // widen the window was false. The logbook shell must hold every column.
  it.each(Object.entries(LOGBOOKS))(
    "shows every %s column once the window gives the logbook shell its full width",
    (_name, columns) => {
      expect([...pickHidden(columns, tableIn(px("width-table")), GAP, PADDING)]).toEqual([]);
    }
  );

  // A narrower window is where stepping aside belongs, and there the price
  // still gives way first — not the route, not the actions.
  it("lets only the price step aside in the flights logbook at a 1024px window", () => {
    expect([...pickHidden(LOGBOOKS.flights, tableIn(1024), GAP, PADDING)][0]).toBe("price");
  });
});
