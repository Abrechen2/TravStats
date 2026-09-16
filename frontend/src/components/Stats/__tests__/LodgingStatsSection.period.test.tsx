import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LodgingStats } from "../../../types/lodging";

const getLodgingStats = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/lodging", () => ({ getLodgingStats }));

import LodgingStatsSection from "../LodgingStatsSection";

/**
 * Owner review 2026-09-15: the overview said "no stays in 2026" while this tab
 * showed four. The server learned `?year=` (23b2736e); this pins that the tab
 * asks for it, compares with a second request, and says which year was empty.
 *
 * Every case keeps the stays at zero, so the section stops before the eight
 * blocks that each want a fully populated rollup. What is pinned is the
 * question asked, not the arithmetic, which has its own tests.
 */
const empty = (over: Partial<LodgingStats> = {}): LodgingStats =>
  ({ lodgingsCount: 0, staysCount: 0, totalNights: 0, countriesCount: 0, ...over }) as LodgingStats;

describe("LodgingStatsSection under the page's period", () => {
  beforeEach(() => {
    getLodgingStats.mockReset();
  });

  it("asks the server for the chosen year", async () => {
    getLodgingStats.mockResolvedValue(empty());
    render(<LodgingStatsSection scope={{ year: 2026, compareYear: null }} />);
    await screen.findByText("stats:period.emptyYear");
    expect(getLodgingStats).toHaveBeenCalledTimes(1);
    expect(getLodgingStats).toHaveBeenCalledWith({ year: 2026 });
  });

  it("asks for the lifetime view when no year is chosen", async () => {
    getLodgingStats.mockResolvedValue(empty());
    render(<LodgingStatsSection scope={{ year: null, compareYear: null }} />);
    await screen.findByText("lodging:list.empty");
    expect(getLodgingStats).toHaveBeenCalledWith(undefined);
  });

  it("names the year when it had no stay, even though houses exist", async () => {
    // Four houses in the lifetime view, none slept in this year: "no stays yet"
    // would be false, and going by the house count would draw an empty tab.
    getLodgingStats.mockResolvedValue(empty({ lodgingsCount: 4 }));
    render(<LodgingStatsSection scope={{ year: 2026, compareYear: null }} />);
    expect(await screen.findByText("stats:period.emptyYear")).toBeInTheDocument();
    expect(screen.queryByText("lodging:list.empty")).not.toBeInTheDocument();
  });

  it("compares with a second request, and still compares for an empty year", async () => {
    getLodgingStats.mockImplementation(async (params?: { year?: number }) =>
      params?.year === 2025 ? empty({ staysCount: 3, totalNights: 9 }) : empty()
    );
    render(<LodgingStatsSection scope={{ year: 2026, compareYear: 2025 }} />);
    expect(await screen.findByText("stats:yearFilter.vs")).toBeInTheDocument();
    expect(getLodgingStats).toHaveBeenCalledWith({ year: 2025 });
    expect(screen.getByText("stats:period.emptyYear")).toBeInTheDocument();
  });
});
