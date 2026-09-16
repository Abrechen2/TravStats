import { describe, it, expect, beforeEach } from "vitest";
import type { JSX } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import StatsPeriodBar from "../StatsPeriodBar";
import { useUrlStatsPeriod } from "../useStatsPeriod";
import { parseYearParam, withYear } from "../../../lib/stats/periodUrl";
import { useStatsCompareStore } from "../../../store/statsCompareStore";

/**
 * CT106 audit, B04: year 2005 → "Details →" opened the flights tab on 2026.
 * The year lived only in state, so any navigation reset it to the newest.
 */
const YEARS = [2005, 2025, 2026];

function Page(): JSX.Element {
  const period = useUrlStatsPeriod(YEARS, false);
  const location = useLocation();
  return (
    <>
      <StatsPeriodBar years={YEARS} period={period} />
      <output data-testid="search">{location.search}</output>
    </>
  );
}

const renderAt = (url: string): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/stats" element={<Page />} />
      </Routes>
    </MemoryRouter>
  );

const pressed = (): string | undefined =>
  screen
    .getAllByRole("button")
    .find((b) => b.getAttribute("aria-pressed") === "true")
    ?.textContent?.trim();

describe("the statistics year lives in the URL", () => {
  beforeEach(() => {
    localStorage.clear();
    useStatsCompareStore.getState().reset();
  });

  it("opens on the year a link names, not on the newest", () => {
    renderAt("/stats?tab=flight&year=2005");
    expect(pressed()).toBe("2005");
  });

  it("opens on all years when the link says so", () => {
    renderAt("/stats?year=all");
    expect(pressed()).toBe("stats:overviewFilter.allYears");
  });

  it("still picks the newest year when nothing was chosen", () => {
    renderAt("/stats");
    expect(pressed()).toBe("2026");
  });

  it("writes a chosen year into the URL, keeping the tab", () => {
    renderAt("/stats?tab=lodging");
    fireEvent.click(screen.getByRole("button", { name: "2005" }));
    expect(screen.getByTestId("search").textContent).toBe("?tab=lodging&year=2005");
  });

  it("falls back to the newest year when the named one has no data", () => {
    renderAt("/stats?year=1999");
    expect(pressed()).toBe("2026");
  });
});

describe("periodUrl", () => {
  it("reads a year, all years, and nothing", () => {
    expect(parseYearParam("2005")).toBe(2005);
    expect(parseYearParam("all")).toBeNull();
    expect(parseYearParam(null)).toBeUndefined();
    expect(parseYearParam("20x5")).toBeUndefined();
  });

  it("adds the year to a route without dropping its tab", () => {
    expect(withYear("/stats?tab=flight", 2005)).toBe("/stats?tab=flight&year=2005");
    expect(withYear("/stats?tab=flight&year=2026", null)).toBe("/stats?tab=flight&year=all");
  });
});
