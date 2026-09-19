import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * `/stats/wrapped` really resolves to the year in review.
 *
 * A page can be finished, exported and translated and still be unreachable,
 * and every other test in this directory renders the component directly — so
 * every one of them would stay green with the `<Route>` deleted. This one
 * renders the app's OWN router at that URL, which is the only assertion that
 * fails when the wiring goes.
 *
 * It costs the mocks below, and they are the price of measuring the real
 * thing: `App` boots a setup check, a session validation, a what's-new lookup
 * and a settings load before it renders any route at all, and a frontend test
 * may reach no network. Every stub here answers the question those four ask in
 * the shortest way that lets the router run.
 */

const getWrappedMock = vi.fn().mockResolvedValue({
  year: 2024,
  availableYears: [2024],
  rank: "top",
  comparisonYear: null,
  flights: 12,
  distanceKm: 1000,
  earthFactor: 0,
  newCountries: 1,
  cruises: 0,
  topAirline: null,
  topRoute: null,
});

vi.mock("../../lib/api", () => ({
  setupApi: {
    getStatus: vi.fn().mockResolvedValue({ requiresSetup: false }),
    getAirportSeedingStatus: vi.fn().mockResolvedValue(null),
  },
  usageStatsApi: { get: vi.fn().mockResolvedValue({ consent: "granted" }) },
  settingsApi: {
    getProfile: vi.fn().mockResolvedValue({ birthdate: null }),
    get: vi.fn().mockResolvedValue({}),
  },
  pendingUpdatesApi: { getAll: vi.fn().mockResolvedValue({ updates: [] }) },
  dataQualityFlagsApi: { getAll: vi.fn().mockResolvedValue({ flags: [] }) },
  statsApi: { getWrapped: (year?: number) => getWrappedMock(year) },
}));

// The session is confirmed and the changelog has nothing to say: both would
// otherwise hold the whole route tree behind a loading screen.
vi.mock("../../hooks/useSessionValidation", () => ({
  useSessionValidation: () => ({ sessionChecked: true }),
}));
vi.mock("../../hooks/useWhatsNew", () => ({
  useWhatsNew: () => ({ entry: null, shouldShow: false, dismiss: vi.fn() }),
}));

const authState = {
  user: { id: "u1", username: "demo", isAdmin: false },
  _hasHydrated: true,
};
vi.mock("../../store/authStore", () => ({
  useAuthStore: (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight"], isEnabled: () => true }),
}));

// The suite's global settings-store stub is a plain object of display
// preferences; `App` calls `loadRemoteSettings()` off the store, which that
// stub does not carry. The real store does, and its one request is mocked
// above.
vi.unmock("../../store/settingsStore");

import App from "../../App";

describe("the /stats/wrapped route", () => {
  it("resolves to the year in review, through the app's own router", async () => {
    // `App` mounts a BrowserRouter, which reads the real location — so the
    // URL is set here rather than handed to a MemoryRouter.
    window.history.pushState({}, "", "/stats/wrapped");

    render(<App />);

    // Lazy-loaded behind Suspense, so the title arrives a tick after mount.
    await waitFor(() => expect(screen.getByText("stats:wrapped.title")).toBeTruthy(), {
      timeout: 3000,
    });
    expect(getWrappedMock).toHaveBeenCalled();
  });
});
