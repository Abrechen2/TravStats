import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * `/plan*` was open to every logged-in user with no beta key: App.tsx rendered
 * TravPlanPage for any session. It now sits behind the `travPlan` switch.
 * Rendered through the app's OWN router, because a component test would stay
 * green with the guard deleted from App.tsx — the mocks below are the rail
 * route test's, which answer App's boot questions in the shortest way.
 */
const remoteBeta = vi.hoisted(() => ({ value: true as boolean }));
const listPlans = vi.fn();
vi.mock("../../lib/api/travplan", () => ({
  travplanApi: {
    list: (...a: unknown[]) => listPlans(...a),
    capabilities: vi.fn().mockResolvedValue({ enabled: true }),
  },
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
// The display-preference sync (forgejo#200) talks to the server; not this test's subject.
vi.mock("../../hooks/useWebPrefsSync", () => ({ useWebPrefsSync: () => undefined }));
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
  useEnabledDomains: () => ({ enabled: ["flight"], isEnabled: () => true }),
}));

// The suite's global settings-store stub is a plain object of display
// preferences; `App` calls `loadRemoteSettings()` off the store, which that
// stub does not carry. The real store does, and its one request is mocked
// above.
vi.unmock("../../store/settingsStore");

import App from "../../App";
import { useSettingsStore } from "../../store/settingsStore";

describe("the /plan route", () => {
  beforeEach(() => {
    listPlans.mockReset();
    listPlans.mockResolvedValue([]);
    useSettingsStore.setState({ betaFeaturesEnabled: null, enabledDomainsLoaded: true });
  });

  it(
    "draws the planning overview where the TravPlan beta switch is on",
    { timeout: 10000 },
    async () => {
      remoteBeta.value = true;
      window.history.pushState({}, "", "/plan");
      render(<App />);
      await waitFor(() => expect(listPlans).toHaveBeenCalled(), { timeout: 8000 });
      expect(screen.queryByTestId("dashboard-stub")).toBeNull();
    }
  );

  it(
    "sends the reader away, without asking for plans, where it is off",
    { timeout: 10000 },
    async () => {
      remoteBeta.value = false;
      window.history.pushState({}, "", "/plan");
      render(<App />);
      await waitFor(() => expect(screen.getByTestId("dashboard-stub")).toBeTruthy(), {
        timeout: 8000,
      });
      expect(listPlans).not.toHaveBeenCalled();
    }
  );

  it("guards a trip's plan and the admin page the same way", { timeout: 10000 }, async () => {
    remoteBeta.value = false;
    for (const path of ["/plan/admin", "/plan/0f3c2a1e-0000-4000-8000-000000000001/budget"]) {
      window.history.pushState({}, "", path);
      const view = render(<App />);
      await waitFor(() => expect(screen.getByTestId("dashboard-stub")).toBeTruthy(), {
        timeout: 8000,
      });
      view.unmount();
    }
  });
});
