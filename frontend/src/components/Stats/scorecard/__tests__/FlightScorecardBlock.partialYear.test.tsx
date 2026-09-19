// The "Jahr" range sets this year against the WHOLE previous calendar year —
// `resolveWindow` in the backend's `utils/stats/timeseries.ts` returns twelve
// months either side. In September that made the pill read "-78 %" with
// nothing beside it naming what it was measured against, which is the same
// defect Task 12 removed from the Gesamt tab, on a fifth surface.
//
// The figures are the server's, so this block cannot narrow them; a true
// same-period comparison needs the timeseries endpoint to accept an end date.
// What it can do is stop presenting the comparison as like-for-like.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FlightScorecardBlock from "../FlightScorecardBlock";
import type { TimeseriesResponse } from "../../../../lib/api/types";

vi.mock("../../../../lib/api/evidence", () => ({ evidenceApi: { get: vi.fn() } }));

afterEach(cleanup);
beforeAll(() => {
  vi.useFakeTimers();
  // Pinned: the block asks the real clock, so without this the assertion
  // would flip on 1 January.
  vi.setSystemTime(new Date(2026, 8, 18));
});
afterAll(() => vi.useRealTimers());

const timeseries: TimeseriesResponse = {
  domain: "flight",
  granularity: "month",
  window: { from: "2026-01-01", to: "2026-09-18" },
  series: [{ period: "2026-01", count: 8, distanceKm: 1000, durationMin: 600 }],
  current: { count: 8, distanceKm: 1000, durationMin: 600 },
  previous: { count: 30, distanceKm: 4000, durationMin: 2400 },
};

function renderBlock(rangeWindow: "year" | "rolling12m"): void {
  render(
    <MemoryRouter initialEntries={["/stats"]}>
      <FlightScorecardBlock
        timeseries={timeseries}
        rangeWindow={rangeWindow}
        onRangeChange={vi.fn()}
        selectedYear={2026}
      />
    </MemoryRouter>
  );
}

describe("FlightScorecardBlock — the year range never shows a bare pill", () => {
  it("names the whole compare year on every tile, and says why, in September", () => {
    renderBlock("year");
    // One per tile: flights, distance, flight time.
    expect(screen.getAllByText("stats:yearFilter.vsFullYear").length).toBe(3);
    expect(screen.getByText("stats:yearFilter.partialYearNote")).toBeInTheDocument();
  });

  it("says nothing of the sort for the rolling range, whose windows are equal", () => {
    renderBlock("rolling12m");
    expect(screen.queryByText("stats:yearFilter.vsFullYear")).not.toBeInTheDocument();
    expect(screen.queryByText("stats:yearFilter.partialYearNote")).not.toBeInTheDocument();
  });
});
