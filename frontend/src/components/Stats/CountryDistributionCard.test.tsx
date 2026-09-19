import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CountryDistributionCard from "./CountryDistributionCard";
import type { CountryStatsResponse } from "../../types";

// A prop since forgejo#49: this card and `useDomainStats` each fetched
// `/stats/countries`, so the flight tab asked the same question twice per load.
// Same rows, same numbers on screen.
const COUNTRIES: CountryStatsResponse = {
  total: 10,
  countries: [
    { country: "Germany", count: 7 },
    { country: "United Kingdom", count: 3 },
  ],
};

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("CountryDistributionCard", () => {
  it("renders country names and counts", () => {
    // A row is a real `<button>` since Task 9, which needs `useSearchParams`.
    render(
      <MemoryRouter>
        <CountryDistributionCard countries={COUNTRIES} />
      </MemoryRouter>
    );
    expect(screen.getByText("Germany")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("United Kingdom")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
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
