import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * Rental, bus and ferry left beta on 2026-10-26 (owner): their pages sit behind
 * the user's domain choice alone, so the instance's beta switch must no longer
 * send the reader away. Rendered through the app's OWN router, because a
 * component test would stay green with a `BetaFeatureRouteGuard` put back in
 * App.tsx — the boot mocks are the rail route test's.
 */
const remoteBeta = vi.hoisted(() => ({ value: false as boolean }));
const userDomains = vi.hoisted(() => ({ value: ["flight"] as string[] }));

vi.mock("../../pages/RentalsPage", () => ({ default: () => <div data-testid="rental-page" /> }));
vi.mock("../../pages/RentalDetailPage", () => ({
  default: () => <div data-testid="rental-detail-page" />,
}));
vi.mock("../../pages/BusPage", () => ({ default: () => <div data-testid="bus-page" /> }));
vi.mock("../../pages/BusDetailPage", () => ({
  default: () => <div data-testid="bus-detail-page" />,
}));
vi.mock("../../pages/FerryPage", () => ({ default: () => <div data-testid="ferry-page" /> }));
vi.mock("../../pages/FerryDetailPage", () => ({
  default: () => <div data-testid="ferry-detail-page" />,
}));
vi.mock("../../pages/DashboardPage", () => ({
  default: () => <div data-testid="dashboard-stub" />,
}));
vi.mock("../../components/Dashboard/tabs/DomainDisabledNotice", () => ({
  DomainDisabledNotice: ({ domain }: { domain: string }) => (
    <div data-testid={`disabled-${domain}`} />
  ),
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

// The user's own domain choice — the one gate these routes keep.
vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: userDomains.value,
    isEnabled: (key: string) => userDomains.value.includes(key),
  }),
}));

vi.unmock("../../store/settingsStore");

import App from "../../App";
import { useSettingsStore } from "../../store/settingsStore";

const CASES = [
  ["rental", "/rentals", "rental-page"],
  ["rental", "/rentals/r1", "rental-detail-page"],
  ["bus", "/bus", "bus-page"],
  ["bus", "/bus/b1", "bus-detail-page"],
  ["ferry", "/ferry", "ferry-page"],
  ["ferry", "/ferry/f1", "ferry-detail-page"],
] as const;

describe("the rental, bus and ferry routes out of beta", () => {
  beforeEach(() => {
    remoteBeta.value = false;
    useSettingsStore.setState({ betaFeaturesEnabled: false, enabledDomainsLoaded: true });
  });

  it.each(CASES)(
    "draws %s at %s with the beta switch off and the domain on",
    { timeout: 10000 },
    async (domain, path, testId) => {
      userDomains.value = ["flight", domain];
      window.history.pushState({}, "", path);
      render(<App />);
      await waitFor(() => expect(screen.getByTestId(testId)).toBeTruthy(), { timeout: 8000 });
      expect(screen.queryByTestId("dashboard-stub")).toBeNull();
    }
  );

  it.each(CASES)(
    "keeps %s at %s hidden while the user has the domain off",
    { timeout: 10000 },
    async (domain, path, testId) => {
      userDomains.value = ["flight"];
      window.history.pushState({}, "", path);
      render(<App />);
      await waitFor(() => expect(screen.getByTestId(`disabled-${domain}`)).toBeTruthy(), {
        timeout: 8000,
      });
      expect(screen.queryByTestId(testId)).toBeNull();
    }
  );
});
