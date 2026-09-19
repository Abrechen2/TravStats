import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import StatsTabStrip from "../StatsTabStrip";
import { STATS_TAB_ARRIVAL } from "../../../lib/stats/statsTabArrival";

// CT106 design-6 R05: "Details" on the overview switched the tab but kept
// scrollY=1012, so the flight statistics opened mid-page with the year control
// 874px above the fold.
describe("StatsTabStrip — arriving from a Details link", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
  });

  const renderAt = (state: unknown): void => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/stats", search: "?tab=flight", state }]}>
        <StatsTabStrip tabs={["flight", "cruise"]} active="flight" onSelect={vi.fn()} />
      </MemoryRouter>
    );
  };

  it("goes to the top and focuses the tab it opened", () => {
    renderAt(STATS_TAB_ARRIVAL);

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 });
    const active = screen.getAllByRole("button").find((b) => b.getAttribute("aria-current"));
    expect(active).toHaveFocus();
  });

  // Measured in a browser: the strip first renders with the tab it had, and
  // the page hands it the new one a render later — focus went to "Gesamt".
  it("focuses the tab it opened even when that tab becomes active a render later", () => {
    const { rerender } = render(
      <MemoryRouter
        initialEntries={[{ pathname: "/stats", search: "?tab=flight", state: STATS_TAB_ARRIVAL }]}
      >
        <StatsTabStrip tabs={["flight", "cruise"]} active="all" onSelect={vi.fn()} />
      </MemoryRouter>
    );
    rerender(
      <MemoryRouter
        initialEntries={[{ pathname: "/stats", search: "?tab=flight", state: STATS_TAB_ARRIVAL }]}
      >
        <StatsTabStrip tabs={["flight", "cruise"]} active="flight" onSelect={vi.fn()} />
      </MemoryRouter>
    );

    const active = screen.getAllByRole("button").find((b) => b.getAttribute("aria-current"));
    expect(active).toHaveTextContent("common:");
    expect(active).toHaveFocus();
  });

  it("leaves the scroll position alone on any other visit", () => {
    renderAt(undefined);

    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
