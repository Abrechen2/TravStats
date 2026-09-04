import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Passport, PassportCountry } from "../../types/passport";

vi.mock("../../hooks/useBetaFeatures", () => ({
  useBetaFeatureAccess: () => "allowed",
  useBetaFeatures: () => ({ betaFeaturesEnabled: true, isFeatureVisible: () => true }),
}));
vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight"], isEnabled: () => true }),
}));
vi.mock("../../components/NavigationBar", () => ({ default: () => null }));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts && ("before" in opts || "after" in opts) ? `${k}:${opts.before}>${opts.after}` : k,
    i18n: { language: "de" },
  }),
}));
vi.mock("../../store/authStore", () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "u-1" } }),
}));

const getPassportMock = vi.fn();
vi.mock("../../lib/api", () => ({
  statsApi: {
    getPassport: () => getPassportMock(),
    getCountryDetail: () => Promise.resolve(null),
  },
}));

import PassportPage from "../PassportPage";

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

const passport = (over: Partial<Passport["summary"]>): Passport => ({
  summary: {
    countries: 35,
    countriesTotal: 36,
    legacyCountries: 32,
    countryThreshold: "visited",
    airports: 61,
    entries: 210,
    continentsVisited: 4,
    continentsTotal: 7,
    firstStampYear: 2008,
    newThisYear: 1,
    byEvidence: { flight: 31, port: 2, place: 1, lodging: 1, track: 0 },
    byTier: { slept: 12, visited: 23, transited: 0, connection: 1 },
    ...over,
  },
  countries: [country({})],
  continents: [],
  groups: [],
  stamps: [],
});

/**
 * Country-counting design §5: every user's number moved with this feature,
 * and a number that changes without explanation reads as data loss. The page
 * says it once — with the real figures — and stays quiet after the user has
 * read it.
 */
describe("PassportPage — the counting-changed notice (§5)", () => {
  beforeEach(() => {
    getPassportMock.mockReset();
    window.localStorage.clear();
  });

  it("says what the number was and what it is now, when they differ", async () => {
    getPassportMock.mockResolvedValue(passport({ countries: 35, legacyCountries: 32 }));
    render(
      <MemoryRouter>
        <PassportPage />
      </MemoryRouter>
    );
    expect(await screen.findByText("passport:countingChanged.text:32>35")).toBeInTheDocument();
    expect(screen.getByText("passport:countingChanged.what")).toBeInTheDocument();
  });

  it("stays quiet when the old rule and the new one agree", async () => {
    getPassportMock.mockResolvedValue(passport({ countries: 32, legacyCountries: 32 }));
    render(
      <MemoryRouter>
        <PassportPage />
      </MemoryRouter>
    );
    await screen.findByText("passport:summary.countries");
    expect(screen.queryByText(/countingChanged\.text/)).toBeNull();
  });

  it("is read once — dismissing it keeps it away on the next visit", async () => {
    getPassportMock.mockResolvedValue(passport({ countries: 35, legacyCountries: 32 }));
    const first = render(
      <MemoryRouter>
        <PassportPage />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByText("passport:countingChanged.dismiss"));
    await waitFor(() => expect(screen.queryByText(/countingChanged\.text/)).toBeNull());
    first.unmount();

    render(
      <MemoryRouter>
        <PassportPage />
      </MemoryRouter>
    );
    await screen.findByText("passport:summary.countries");
    expect(screen.queryByText(/countingChanged\.text/)).toBeNull();
  });
});
