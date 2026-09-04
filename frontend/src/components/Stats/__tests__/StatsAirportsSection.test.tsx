import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AirportStats } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { total?: number }) => (opts?.total !== undefined ? `${k}:${opts.total}` : k),
  }),
}));

import StatsAirportsSection from "../StatsAirportsSection";

const stats: AirportStats = {
  airportCount: 40,
  countryCount: 21,
  continentCount: 6,
  continentTotal: 7,
  topAirports: [],
  rarestAirports: [],
  newThisYear: [],
  farthestFromHome: null,
  topCountries: [],
  continentDistribution: { Europe: 30, "North America": 8, Antarctica: 1 },
};

// forgejo#87 — the tile printed "6/ 6" from a hard-coded six while its own
// caption said "of the 7" and the passport said 6/7.
describe("StatsAirportsSection — continents tile", () => {
  it("renders the denominator from the response, tight against the slash", () => {
    const { container } = render(<StatsAirportsSection airportStats={stats} />);

    const text = container.textContent ?? "";
    expect(text).toContain("6/7");
    expect(text).not.toContain("/ 6");
    expect(screen.getByText("stats:airportStats.continentCountDesc:7")).toBeInTheDocument();
  });

  it("labels the distribution through the shared continent keys, Antarctica included", () => {
    render(<StatsAirportsSection airportStats={stats} />);

    expect(screen.getByText("common:continents.europe")).toBeInTheDocument();
    expect(screen.getByText("common:continents.northAmerica")).toBeInTheDocument();
    expect(screen.getByText("common:continents.antarctica")).toBeInTheDocument();
  });
});
