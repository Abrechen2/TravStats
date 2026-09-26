import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * `/loyalty` sits behind the `loyaltyCenter` beta switch (owner decision
 * 2026-09-26). Rendered through the app's OWN router, as the rail route test
 * does, because a component test would stay green with the guard deleted
 * from App.tsx.
 */
const remoteBeta = vi.hoisted(() => ({ value: true as boolean }));
// The page itself is stubbed: this is about the route, not the page.
vi.mock("../../pages/LoyaltyPage", () => ({
  default: () => <div data-testid="loyalty-page-stub" />,
}));
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
  useEnabledDomains: () => ({ enabled: ["flight", "lodging"], isEnabled: () => true }),
}));

// The suite's global settings-store stub is a plain object of display
// preferences; `App` calls `loadRemoteSettings()` off the store, which that
// stub does not carry. The real store does, and its one request is mocked
// above.
vi.unmock("../../store/settingsStore");

import App from "../../App";
import { useSettingsStore } from "../../store/settingsStore";

describe("the /loyalty route", () => {
  beforeEach(() => {
    useSettingsStore.setState({ betaFeaturesEnabled: null, enabledDomainsLoaded: true });
  });

  it("opens the loyalty page where the beta switch is on", { timeout: 10000 }, async () => {
    remoteBeta.value = true;
    window.history.pushState({}, "", "/loyalty");
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("loyalty-page-stub")).toBeTruthy(), {
      timeout: 8000,
    });
  });

  it("sends the reader to the dashboard where it is off", { timeout: 10000 }, async () => {
    remoteBeta.value = false;
    window.history.pushState({}, "", "/loyalty");
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("dashboard-stub")).toBeTruthy(), {
      timeout: 8000,
    });
    expect(screen.queryByTestId("loyalty-page-stub")).toBeNull();
  });
});
