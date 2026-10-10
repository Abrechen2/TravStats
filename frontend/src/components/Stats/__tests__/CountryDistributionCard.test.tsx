import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import CountryDistributionCard from "../CountryDistributionCard";

/** forgejo#256 — the server's Unknown bucket is named in the reader's language. */
describe("CountryDistributionCard", () => {
  it("names the Unknown bucket through its key, not the server's English word", () => {
    render(
      <MemoryRouter>
        <CountryDistributionCard
          countries={{
            countries: [
              { country: "DE", count: 3 },
              { country: "Unknown", count: 1 },
            ],
            total: 4,
            countriesIso: ["DE"],
            byYear: {},
          }}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("stats:countryDist.unknown")).toBeTruthy();
    expect(screen.queryByText("Unknown")).toBeNull();
  });
});
