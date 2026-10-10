import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AirportStats } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { total?: number; year?: number }) =>
      opts?.total !== undefined
        ? `${k}:${opts.total}`
        : opts?.year !== undefined
          ? `${k}:${opts.year}`
          : k,
    i18n: { language: "de" },
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
  rarestAirportsTotal: 0,
  newThisYear: [],
  newThisYearYear: 2026,
  farthestFromHome: null,
  topCountries: [],
  continentDistribution: { Europe: 30, "North America": 8, Antarctica: 1 },
};

// forgejo#87 — the tile printed "6/ 6" from a hard-coded six while its own
// caption said "of the 7" and the passport said 6/7.
describe("StatsAirportsSection — continents tile", () => {
  it("renders the denominator from the response, tight against the slash", () => {
    // A tile is a real `<button>` since Task 9, which needs `useSearchParams`.
    const { container } = render(
      <MemoryRouter>
        <StatsAirportsSection airportStats={stats} />
      </MemoryRouter>
    );

    const text = container.textContent ?? "";
    expect(text).toContain("6/7");
    expect(text).not.toContain("/ 6");
    expect(screen.getByText("stats:airportStats.continentCountDesc:7")).toBeInTheDocument();
  });

  it("labels the distribution through the shared continent keys, Antarctica included", () => {
    render(
      <MemoryRouter>
        <StatsAirportsSection airportStats={stats} />
      </MemoryRouter>
    );

    expect(screen.getByText("common:continents.europe")).toBeInTheDocument();
    expect(screen.getByText("common:continents.northAmerica")).toBeInTheDocument();
    expect(screen.getByText("common:continents.antarctica")).toBeInTheDocument();
  });
});

// The server sends ISO 3166-1 alpha-2 codes, never names — TOP-LÄNDER printed
// "DE 141 Flüge" raw (silent-fix sweep 2026-09-27, same defect class as
// EvidenceEntryRow / the passport page). The fixtures use real codes so the
// test exercises the same resolution the browser does.
describe("StatsAirportsSection — country names", () => {
  const withCountries: AirportStats = {
    ...stats,
    topCountries: [
      { country: "DE", count: 12 },
      { country: "GB", count: 4 },
    ],
    newThisYear: [{ code: "MUC", name: null, country: "DE", firstVisitDate: "2026-01-02" }],
    rarestAirports: [{ code: "LHR", name: null, country: "GB" }],
  };

  it("names the top countries in the reader's language, not their ISO codes", () => {
    render(
      <MemoryRouter>
        <StatsAirportsSection airportStats={withCountries} />
      </MemoryRouter>
    );

    expect(screen.getAllByText("Deutschland").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Vereinigtes Königreich").length).toBeGreaterThan(0);
    expect(screen.queryByText("DE")).not.toBeInTheDocument();
    expect(screen.queryByText("GB")).not.toBeInTheDocument();
  });

  it("falls back to the country name, not the ISO code, when an airport has no name", () => {
    render(
      <MemoryRouter>
        <StatsAirportsSection airportStats={withCountries} />
      </MemoryRouter>
    );

    // "Deutschland" already asserted above (topCountries) — this proves the
    // SAME text also covers the newThisYear/rarestAirports name fallback,
    // which used to print the bare code as the airport's own label.
    expect(screen.getAllByText("Deutschland").length).toBeGreaterThan(1);
    expect(screen.getAllByText("Vereinigtes Königreich").length).toBeGreaterThan(1);
  });
});

// forgejo#256 — five airports of many that tie at one visit: the cut is said.
describe("StatsAirportsSection — rarest airports", () => {
  it("says how many tie when the list shows only some of them", () => {
    render(
      <MemoryRouter>
        <StatsAirportsSection
          airportStats={{
            ...stats,
            rarestAirports: [{ code: "LHR", name: null, country: "GB" }],
            rarestAirportsTotal: 12,
          }}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("stats:airportStats.rarestAirportsOf:12")).toBeInTheDocument();
  });
});

describe("StatsAirportsSection — new this year", () => {
  it("names the year the server filed the list under, not the browser's", () => {
    render(
      <MemoryRouter>
        <StatsAirportsSection airportStats={{ ...stats, newThisYearYear: 2031 }} />
      </MemoryRouter>
    );
    // The heading and the counting help both name it.
    expect(screen.getAllByText("stats:airportStats.newThisYear:2031").length).toBeGreaterThan(0);
  });
});
