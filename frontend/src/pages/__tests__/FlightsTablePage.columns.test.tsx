import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * Testing the full page needs heavy mocking (stores, router, API). Keep it
 * surgical — assert the page module's structure statically instead: the real
 * cell behaviour is covered by the Task 3-5 component tests, and the visual
 * result is verified in the browser (Task 7). This is the honest cheap gate
 * for "did the page actually wire in the new cells and drop the old markup."
 */
const src = readFileSync(resolve(__dirname, "../FlightsTablePage.tsx"), "utf-8");

describe("FlightsTablePage column composition", () => {
  it("uses the new cell components", () => {
    expect(src).toContain("<AirlineWordmarkCell");
    expect(src).toContain("<RouteCell");
    expect(src).toContain("<TimeCell");
    expect(src).toContain("<SourceInfoDot");
  });

  it("drops DataSourceBadges from the status cell", () => {
    expect(src).not.toContain("DataSourceBadges");
  });

  it("merges the two date columns into a single Zeit/Time column", () => {
    expect(src).not.toContain("table.arrival");
    expect(src).toContain("flights:table.time");
  });

  it("keeps the actions cell + SourceInfoDot in one right-aligned flex container", () => {
    expect(src).toContain('<span className="inline-flex w-[18px] justify-center">');
    const actionsIndex = src.indexOf("<FlightRowActions");
    const dotWrapperIndex = src.indexOf('<span className="inline-flex w-[18px] justify-center">');
    const sourceInfoDotIndex = src.indexOf("<SourceInfoDot");
    expect(actionsIndex).toBeGreaterThan(-1);
    expect(dotWrapperIndex).toBeGreaterThan(actionsIndex);
    expect(sourceInfoDotIndex).toBeGreaterThan(dotWrapperIndex);
  });
});
