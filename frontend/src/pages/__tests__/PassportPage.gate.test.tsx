import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const flag: { value: boolean | null } = { value: null };

// Mocked at the gate rather than at the settings store: the page reads plenty
// else from that store, and a narrow fake of it would fail for reasons that
// have nothing to do with what is being tested.
vi.mock("../../hooks/useBetaFeatures", () => ({
  useBetaFeatureAccess: () => (flag.value === null ? "pending" : flag.value ? "allowed" : "denied"),
  useBetaFeatures: () => ({
    betaFeaturesEnabled: flag.value,
    isFeatureVisible: () => flag.value === true,
  }),
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight"], isEnabled: () => true }),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

const getPassportMock = vi.fn();
vi.mock("../../lib/api", () => ({
  statsApi: { getPassport: () => getPassportMock() },
}));

import PassportPage from "../PassportPage";

/**
 * The gate, and the one-request window that makes a boolean version of it wrong.
 *
 * `betaFeaturesEnabled` is instance state and is never persisted, so on a cold
 * load it is null until `GET /settings` answers. A guard that treats "not known
 * yet" as "no" redirects — which is exactly how /places came to work when
 * navigated to from inside the app and bounce on a refresh, a bookmark, or a
 * link opened in a new tab. That was found by driving a browser while every
 * unit test passed, so it gets a test here.
 */
describe("PassportPage — the beta gate", () => {
  beforeEach(() => {
    getPassportMock.mockReset();
    getPassportMock.mockResolvedValue({
      summary: {
        countries: 0,
        countriesTotal: 0,
        legacyCountries: 0,
        countryThreshold: "visited",
        airports: 0,
        entries: 0,
        continentsVisited: 0,
        continentsTotal: 7,
        firstStampYear: null,
        newThisYear: 0,
        byEvidence: { flight: 0, port: 0, place: 0, lodging: 0, track: 0 },
        byTier: { slept: 0, visited: 0, transited: 0, connection: 0 },
      },
      countries: [],
      continents: [],
      groups: [],
      stamps: [],
    });
  });

  it("waits while the instance flag is still unknown", () => {
    flag.value = null;
    render(
      <MemoryRouter>
        <PassportPage />
      </MemoryRouter>
    );

    // Neither the page nor the refusal — the app simply does not know yet, and
    // the user asked for this URL.
    expect(screen.getByText("common:loading.default")).toBeInTheDocument();
    expect(getPassportMock).not.toHaveBeenCalled();
  });

  it("goes home when the gate is closed, like /places does", async () => {
    flag.value = false;
    render(
      <MemoryRouter initialEntries={["/passport"]}>
        <Routes>
          <Route path="/passport" element={<PassportPage />} />
          <Route path="/" element={<div>home-marker</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("home-marker")).toBeInTheDocument();
    });
    // Neither the title nor the "enable flights" hint — the reader has flights
    // on; the instance simply does not offer the page.
    expect(screen.queryByText("passport:title")).not.toBeInTheDocument();
    expect(screen.queryByText("passport:needsFlights")).not.toBeInTheDocument();
    expect(getPassportMock).not.toHaveBeenCalled();
  });

  it("shows it once the gate is open", async () => {
    flag.value = true;
    render(
      <MemoryRouter>
        <PassportPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getPassportMock).toHaveBeenCalled();
    });
  });
});
