import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { Passport, PassportCountry } from "../../types/passport";

vi.mock("../../hooks/useBetaFeatures", () => ({
  useBetaFeatureAccess: () => "allowed",
  useBetaFeatures: () => ({ betaFeaturesEnabled: true, isFeatureVisible: () => true }),
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight"], isEnabled: () => true }),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

const getPassportMock = vi.fn();
vi.mock("../../lib/api", () => ({
  statsApi: {
    getPassport: () => getPassportMock(),
    getCountryDetail: () => Promise.resolve(null),
  },
}));

import PassportPage from "../PassportPage";

/**
 * Tester feedback T3 (2026-09-17): the passport was the app's one light
 * "paper" surface, and a stray "Zurück zu Statistiken" link that led nowhere
 * else in the app duplicated the header's own navigation. The owner's
 * decision: the passport is dark like the rest of the app, and the link goes.
 */

const country = (over: Partial<PassportCountry>): PassportCountry => ({
  code: "DE",
  continent: "Europe",
  entries: 4,
  firstYear: 2019,
  lastYear: 2024,
  airports: ["MUC"],
  isHome: false,
  isNew: false,
  evidence: "flight",
  tier: "visited",
  kinds: ["flight"],
  hasUndatedEvidence: false,
  daysPresent: 9,
  groundTime: { state: "measured", minutes: 282 },
  counted: true,
  ...over,
});

const passport = (over: Partial<Passport["summary"]> = {}): Passport => ({
  summary: {
    countries: 40,
    countriesTotal: 43,
    legacyCountries: 43,
    countryThreshold: "visited",
    airports: 61,
    entries: 210,
    continentsVisited: 4,
    continentsTotal: 7,
    firstStampYear: 2008,
    newThisYear: 1,
    byEvidence: { flight: 31, port: 5, place: 2, lodging: 5, track: 0 },
    byTier: { slept: 12, visited: 28, transited: 0, connection: 3 },
    ...over,
  },
  countries: [country({})],
  continents: [],
  groups: [],
  stamps: [],
});

describe("PassportPage — dark like the rest of the app (T3)", () => {
  beforeEach(() => {
    getPassportMock.mockReset();
  });

  it("renders no back link to /stats", async () => {
    getPassportMock.mockResolvedValue(passport());

    render(
      <MemoryRouter>
        <PassportPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("passport:summary.countries")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Zurück/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /stats/i })).not.toBeInTheDocument();
  });

  it("carries no `ts-paper` scope — the passport inherits the app's own dark tokens", async () => {
    getPassportMock.mockResolvedValue(passport());

    const { container } = render(
      <MemoryRouter>
        <PassportPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("passport:summary.countries")).toBeInTheDocument();
    });

    expect(container.querySelector(".ts-paper")).toBeNull();
  });
});
