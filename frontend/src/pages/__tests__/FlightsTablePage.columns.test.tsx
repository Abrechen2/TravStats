import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * Testing the full page needs heavy mocking (stores, router, API). Keep it
 * surgical — assert the module structure statically instead: the real cell
 * behaviour is covered by the component tests, and the visual result is
 * verified in the browser. This is the honest cheap gate for "did the list
 * actually wire in the new cells and drop the old markup."
 *
 * The cells moved out of the page on 2026-09-15, when all four logbooks went
 * onto the `Table` primitive so a row survives 390px. This file follows them:
 * a source-scanning guard that keeps reading the file the code LEFT is a
 * guard that passes because there is nothing there.
 */
const page = readFileSync(resolve(__dirname, "../FlightsTablePage.tsx"), "utf-8");
const row = readFileSync(
  resolve(__dirname, "../../components/flightsTable/FlightRow.tsx"),
  "utf-8"
);
const columns = readFileSync(
  resolve(__dirname, "../../components/flightsTable/flightColumns.ts"),
  "utf-8"
);

describe("FlightsTablePage column composition", () => {
  it("uses the new cell components", () => {
    expect(row).toContain("<AirlineWordmarkCell");
    expect(row).toContain("<RouteCell");
    expect(row).toContain("<TimeCell");
    expect(row).toContain("<SourceInfoDot");
  });

  it("drops DataSourceBadges from the status cell", () => {
    expect(page).not.toContain("DataSourceBadges");
    expect(row).not.toContain("DataSourceBadges");
  });

  it("merges the two date columns into a single Zeit/Time column", () => {
    expect(page).not.toContain("table.arrival");
    // The column id, not the i18n key: since the header became one loop over
    // FLIGHT_COLUMN_IDS, the key is composed (`flights:table.${id}`) and no
    // longer appears verbatim. Asserting the literal string was really
    // asserting how the label is spelled in source, which is not what this
    // test is about.
    expect(columns).toContain('"time"');
    expect(page).toContain("FLIGHT_SORT_KEY_BY_COLUMN");
  });

  it("keeps the actions cell + SourceInfoDot in one right-aligned flex container", () => {
    const dotWrapper = '<span className="inline-flex w-[18px] justify-center">';
    expect(row).toContain(dotWrapper);
    const actionsIndex = row.indexOf("{actions}");
    const dotWrapperIndex = row.indexOf(dotWrapper);
    const sourceInfoDotIndex = row.indexOf("<SourceInfoDot");
    expect(actionsIndex).toBeGreaterThan(-1);
    expect(dotWrapperIndex).toBeGreaterThan(actionsIndex);
    expect(sourceInfoDotIndex).toBeGreaterThan(dotWrapperIndex);
  });

  // The page must not quietly grow a second table beside the primitive.
  it("draws no table of its own any more", () => {
    expect(page).not.toContain("<table");
    expect(page).not.toContain("overflow-x-auto");
  });
});
