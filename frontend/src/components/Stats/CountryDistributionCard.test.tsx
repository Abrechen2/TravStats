import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CountryDistributionCard from "./CountryDistributionCard";
import type { CountryStatsResponse } from "../../types";

// A prop since forgejo#49: this card and `useDomainStats` each fetched
// `/stats/countries`, so the flight tab asked the same question twice per load.
// Same rows, same numbers on screen. The server sends ISO 3166-1 alpha-2
// codes, never names (silent-fix sweep 2026-09-27, "TOP-LÄNDER" printed "DE"
// raw) — the fixture uses real codes so the test exercises the same
// resolution the browser does.
const COUNTRIES: CountryStatsResponse = {
  total: 10,
  countries: [
    { country: "DE", count: 7 },
    { country: "GB", count: 3 },
  ],
};

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

describe("CountryDistributionCard", () => {
  it("names the country in the reader's language instead of printing the ISO code", () => {
    // A row is a real `<button>` since Task 9, which needs `useSearchParams`.
    render(
      <MemoryRouter>
        <CountryDistributionCard countries={COUNTRIES} />
      </MemoryRouter>
    );
    expect(screen.getByText("Deutschland")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Vereinigtes Königreich")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("DE")).not.toBeInTheDocument();
    expect(screen.queryByText("GB")).not.toBeInTheDocument();
  });

  it("says it is loading while the page's one request is in flight", () => {
    render(
      <MemoryRouter>
        <CountryDistributionCard countries={undefined} />
      </MemoryRouter>
    );
    expect(screen.getByText("stats:countryDist.loading")).toBeInTheDocument();
  });
});
