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

  it("leaves the scroll position alone on any other visit", () => {
    renderAt(undefined);

    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
