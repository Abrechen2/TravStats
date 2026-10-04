import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * `/loyalty` was the loyalty page of the 2.7 betas. Since 2026-09-26 the
 * programmes are managed in Einstellungen → Bonusprogramme, and the old URL
 * — in bookmarks, the beta announcement, Discord — lands there. Rendered
 * through the app's OWN router, because a component test would stay green
 * with the route deleted from App.tsx.
 */
const remoteBeta = vi.hoisted(() => ({ value: false as boolean }));
// The settings page is stubbed: this is about where the route leads.
vi.mock("../../pages/SettingsPage", async () => {
  const { useLocation } = await import("react-router-dom");
  const Stub = () => {
    const location = useLocation();
    return <div data-testid="settings-stub">{location.pathname + location.search}</div>;
  };
  return { default: Stub, SettingsLegacyRedirect: Stub };
});
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

  it(
    "lands on Einstellungen → Bonusprogramme, whatever the beta switch says",
    { timeout: 10000 },
    async () => {
      for (const beta of [false, true]) {
        remoteBeta.value = beta;
        window.history.pushState({}, "", "/loyalty");
        const { unmount } = render(<App />);
        await waitFor(
          () =>
            expect(screen.getByTestId("settings-stub").textContent).toBe(
              "/settings/account?section=loyalty"
            ),
          { timeout: 8000 }
        );
        expect(screen.queryByTestId("dashboard-stub")).toBeNull();
        unmount();
      }
    }
  );
});
