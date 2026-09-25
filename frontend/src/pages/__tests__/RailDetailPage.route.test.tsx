import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { makeRailJourney } from "../../components/rail/__tests__/railJourneyFixture";

/**
 * `/rail/:id` sits behind the same two gates as the rail logbook (owner rule
 * 2026-09-25: the rail domain stays behind its beta switch). Rendered through
 * the app's OWN router, because a component test would stay green with the
 * guard deleted from App.tsx — the mocks below are the WrappedPage route
 * test's, which answer App's four boot questions in the shortest way.
 */
const remoteBeta = vi.hoisted(() => ({ value: true as boolean }));
const getJourney = vi.fn();
vi.mock("../../lib/api/rail", () => ({
  railApi: { get: (...a: unknown[]) => getJourney(...a), remove: vi.fn() },
}));
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));
vi.mock("../../components/rail/RailRouteMap", () => ({ RailRouteMap: () => null }));
vi.mock("../../pages/DashboardPage", () => ({
  default: () => <div data-testid="dashboard-stub" />,
}));

vi.mock("../../lib/api", () => ({
  setupApi: {
    getStatus: vi.fn().mockResolvedValue({ requiresSetup: false }),
    getAirportSeedingStatus: vi.fn().mockResolvedValue(null),
  },
  usageStatsApi: { get: vi.fn().mockResolvedValue({ consent: "granted" }) },
  settingsApi: {
    getProfile: vi.fn().mockResolvedValue({ birthdate: null }),
    get: vi.fn(() => Promise.resolve({ betaFeaturesEnabled: remoteBeta.value })),
  },
  pendingUpdatesApi: { getAll: vi.fn().mockResolvedValue({ updates: [] }) },
  dataQualityFlagsApi: { getAll: vi.fn().mockResolvedValue({ flags: [] }) },
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
  useAuthStore: Object.assign(
    (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState),
    { getState: () => authState }
  ),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight", "rail"], isEnabled: () => true }),
}));

// The suite's global settings-store stub is a plain object of display
// preferences; `App` calls `loadRemoteSettings()` off the store, which that
// stub does not carry. The real store does, and its one request is mocked
// above.
vi.unmock("../../store/settingsStore");

import App from "../../App";
import { useSettingsStore } from "../../store/settingsStore";

describe("the /rail/:id route", () => {
  beforeEach(() => {
    getJourney.mockReset();
    getJourney.mockResolvedValue({ ...makeRailJourney(), booking: null });
    // The domain half is answered; the beta half comes from GET /settings.
    useSettingsStore.setState({ betaFeaturesEnabled: null, enabledDomainsLoaded: true });
  });

  it("draws the journey where the rail beta switch is on", { timeout: 10000 }, async () => {
    remoteBeta.value = true;
    window.history.pushState({}, "", "/rail/j1");
    render(<App />);
    await waitFor(() => expect(screen.getByText("Frankfurt → Fulda")).toBeTruthy(), {
      timeout: 8000,
    });
  });

  it(
    "sends the reader away, without asking for the journey, where it is off",
    { timeout: 10000 },
    async () => {
      remoteBeta.value = false;
      window.history.pushState({}, "", "/rail/j1");
      render(<App />);
      await waitFor(() => expect(screen.getByTestId("dashboard-stub")).toBeTruthy(), {
        timeout: 8000,
      });
      expect(getJourney).not.toHaveBeenCalled();
      expect(screen.queryByText("Frankfurt → Fulda")).toBeNull();
    }
  );
});
