import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
const getCountryDetailMock = vi.fn();
vi.mock("../../lib/api", () => ({
  statsApi: {
    getPassport: () => getPassportMock(),
    getCountryDetail: (code: string) => getCountryDetailMock(code),
  },
}));

import PassportPage from "../PassportPage";

/**
 * The headline is not the whole answer, and the page has to say so.
 *
 * `countries` applies a threshold and `countriesTotal` does not. A reader who
 * sees 40 must be able to find out that 43 countries have evidence and that
 * three of them are connections — otherwise the gap looks like a defect, which
 * is how the old number came to be trusted while it was wrong in both
 * directions at once.
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

const passport = (over: Partial<Passport["summary"]>, countries: PassportCountry[]): Passport => ({
  summary: {
    countries: 40,
    countriesTotal: 43,
    countryThreshold: "visited",
    airports: 61,
    entries: 210,
    continentsVisited: 4,
    continentsTotal: 7,
    firstStampYear: 2008,
    newThisYear: 1,
    byEvidence: { flight: 31, port: 5, place: 2, lodging: 5 },
    byTier: { slept: 12, visited: 28, transit: 3 },
    ...over,
  },
  countries,
  continents: [],
  groups: [],
  stamps: [],
});

describe("PassportPage — headline, total and threshold", () => {
  beforeEach(() => {
    getPassportMock.mockReset();
    getCountryDetailMock.mockReset();
  });

  it("renders the headline and the total distinctly, and names the threshold", async () => {
    getPassportMock.mockResolvedValue(
      passport({}, [country({}), country({ code: "ET", tier: "transit", counted: false })])
    );

    render(
      <MemoryRouter>
        <PassportPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("passport:summary.countries")).toBeInTheDocument();
    });

    // Two different numbers, both on screen, labelled as what they are.
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText(/43/)).toBeInTheDocument();
    expect(screen.getByText("passport:summary.countriesTotal")).toBeInTheDocument();

    // The rule between them is named rather than implied.
    expect(screen.getByText("passport:evidence.headlineNote")).toBeInTheDocument();

    // And the strengths behind the total are broken out — three tiers, because
    // three is what the data can produce. The planned road-transit rung has no
    // record that can carry it and is deliberately absent.
    const band = screen.getByLabelText("passport:evidence.title");
    expect(within(band).getByTestId("tier-slept")).toBeInTheDocument();
    expect(within(band).getByTestId("tier-visited")).toBeInTheDocument();
    expect(within(band).getByTestId("tier-transit")).toBeInTheDocument();
    expect(within(band).queryByTestId("tier-transited")).not.toBeInTheDocument();
  });

  it("does not call a passport empty when every country was only a connection", async () => {
    getPassportMock.mockResolvedValue(
      passport(
        {
          countries: 0,
          countriesTotal: 3,
          byEvidence: { flight: 3, port: 0, place: 0, lodging: 0 },
          byTier: { slept: 0, visited: 0, transit: 3 },
        },
        [
          country({ code: "QA", tier: "transit", counted: false }),
          country({ code: "ET", tier: "transit", counted: false }),
          country({ code: "SG", tier: "transit", counted: false }),
        ]
      )
    );

    render(
      <MemoryRouter>
        <PassportPage />
      </MemoryRouter>
    );

    // A headline of zero over three real rows must not become "you have never
    // travelled" — that would delete exactly the rows a reader needs to correct.
    await waitFor(() => {
      expect(screen.getByText("QA")).toBeInTheDocument();
    });
    expect(screen.queryByText("passport:empty")).not.toBeInTheDocument();
    expect(screen.getByText("ET")).toBeInTheDocument();
    expect(screen.getByText("SG")).toBeInTheDocument();
  });
});
