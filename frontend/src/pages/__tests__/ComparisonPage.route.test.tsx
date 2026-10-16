import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * `/compare` and `/encrypted-share` share one lazy route in App.tsx (it stands at the 800-line
 * limit), and `ComparisonPage` picks the page by path (rework 2026-10-16). Rendered through the
 * app's OWN router, with the boot mocks of `TravPlanPage.route.test.tsx`, so the test fails if
 * App stops routing either path or the page picks the wrong one.
 */
const remoteBeta = vi.hoisted(() => ({ value: true as boolean }));
vi.mock("../../components/comparison/LeaderboardPage", () => ({
  default: () => <div data-testid="leaderboard-stub" />,
}));
vi.mock("../../components/encryptedShare/SealedWorkspace", () => ({
  default: () => <div data-testid="sealed-stub" />,
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

async function landOn(path: string, testId: string): Promise<void> {
  window.history.pushState({}, "", path);
  render(<App />);
  await waitFor(() => expect(screen.getByTestId(testId)).toBeTruthy(), { timeout: 8000 });
}

describe("the comparison routes", () => {
  beforeEach(() => {
    useSettingsStore.setState({ betaFeaturesEnabled: null, enabledDomainsLoaded: true });
  });

  it("draws the leaderboard at /compare", { timeout: 10000 }, async () => {
    remoteBeta.value = true;
    await landOn("/compare", "leaderboard-stub");
    expect(screen.queryByTestId("sealed-stub")).toBeNull();
  });

  it("draws the encrypted share at /encrypted-share", { timeout: 10000 }, async () => {
    remoteBeta.value = true;
    await landOn("/encrypted-share", "sealed-stub");
    expect(screen.queryByTestId("leaderboard-stub")).toBeNull();
  });

  it(
    "sends the reader away from both while the beta switch is off",
    { timeout: 10000 },
    async () => {
      remoteBeta.value = false;
      for (const path of ["/compare", "/encrypted-share"]) {
        window.history.pushState({}, "", path);
        const view = render(<App />);
        await waitFor(() => expect(screen.getByTestId("dashboard-stub")).toBeTruthy(), {
          timeout: 8000,
        });
        expect(screen.queryByTestId("sealed-stub")).toBeNull();
        view.unmount();
      }
    }
  );
});
