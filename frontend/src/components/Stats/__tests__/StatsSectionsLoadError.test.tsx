import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import StatsSectionsLoadError from "../StatsSectionsLoadError";
import AirlineRankingCard from "../AirlineRankingCard";
import AircraftRankingCard from "../AircraftRankingCard";
import CountryDistributionCard from "../CountryDistributionCard";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

/**
 * The failure of ONE shared request has to be visible (forgejo#49).
 *
 * Nine sections come from a single `/stats/page` load, so one 500 takes all
 * nine. The first cut of this dropped the hook's `error` on the floor: the page
 * rendered nothing about it and nine cards read "loading" forever, which is the
 * worst of the three possible answers — a page that is wrong and silent.
 */
describe("StatsSectionsLoadError", () => {
  it("says the sections could not be loaded", () => {
    render(<StatsSectionsLoadError onRetry={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("stats:page.loadError");
  });

  it("offers a retry, because the alternative is reloading the whole page", () => {
    const onRetry = vi.fn();
    render(<StatsSectionsLoadError onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "stats:page.retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("the cards a failed shared load hands `null`", () => {
  // `null` is "the load finished and brought nothing" — see the three-state
  // note in `lib/stats/useStatsPageSections.ts`. None of these may say
  // "loading": the load is over, and the page has already said why.
  it("shows their empty state, never 'loading'", () => {
    render(
      <MemoryRouter>
        <div>
          <AirlineRankingCard airlines={null} />
          <AircraftRankingCard aircraft={null} />
          <CountryDistributionCard countries={null} />
        </div>
      </MemoryRouter>
    );

    expect(screen.getByText("stats:airlineRanking.noData")).toBeInTheDocument();
    expect(screen.getByText("stats:aircraftRanking.noData")).toBeInTheDocument();
    expect(screen.getByText("stats:countryDist.noData")).toBeInTheDocument();

    expect(screen.queryByText("stats:airlineRanking.loading")).toBeNull();
    expect(screen.queryByText("stats:aircraftRanking.loading")).toBeNull();
    expect(screen.queryByText("stats:countryDist.loading")).toBeNull();
  });

  it("still says 'loading' while the request really is in flight", () => {
    render(
      <MemoryRouter>
        <div>
          <AirlineRankingCard airlines={undefined} />
          <AircraftRankingCard aircraft={undefined} />
          <CountryDistributionCard countries={undefined} />
        </div>
      </MemoryRouter>
    );

    expect(screen.getByText("stats:airlineRanking.loading")).toBeInTheDocument();
    expect(screen.getByText("stats:aircraftRanking.loading")).toBeInTheDocument();
    expect(screen.getByText("stats:countryDist.loading")).toBeInTheDocument();
  });
});
