import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SettingsPage, { SettingsLegacyRedirect } from "../../pages/SettingsPage";
import { useSettingsStore } from "../../store/settingsStore";

// Measured 2026-09-19: these renders take ~1 s each on a developer machine
// and 6–8 s on the CI runner under coverage instrumentation, past Vitest's
// 5 s default — the first CI run on the merged main (f1e1085c) failed on
// exactly that. A hang would still be caught at 20 s; a slow render is not a
// wrong render.
vi.setConfig({ testTimeout: 20_000 });

// A settings route renders its whole group at once on this branch (one route
// per group), so every section in the group loads its data on mount. Each of
// these escaped to the network once main's guard started counting (forgejo#110).
// The modules below are the ones the sections import directly.
vi.mock("@/lib/api/twoFactor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/twoFactor")>();
  return {
    ...actual,
    twoFactorApi: {
      ...actual.twoFactorApi,
      getTwoFactorStatus: vi.fn().mockResolvedValue({ enabled: false, recoveryCodesLeft: 0 }),
    },
  };
});
vi.mock("@/lib/api/passkeys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/passkeys")>();
  return {
    ...actual,
    passkeyApi: {
      ...actual.passkeyApi,
      availability: vi.fn().mockResolvedValue({ available: false, reason: null }),
      list: vi.fn().mockResolvedValue([]),
    },
  };
});
vi.mock("@/lib/api/tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/tokens")>();
  return {
    ...actual,
    apiTokensApi: { ...actual.apiTokensApi, list: vi.fn().mockResolvedValue([]) },
  };
});
vi.mock("@/lib/api/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/notifications")>();
  return {
    ...actual,
    notificationsApi: {
      ...actual.notificationsApi,
      getPreferences: vi.fn().mockResolvedValue({
        notificationEmail: null,
        notifyBefore24h: false,
        notifyBefore2h: false,
      }),
    },
  };
});
vi.mock("@/lib/api/immich", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/immich")>();
  return {
    ...actual,
    immichApi: { ...actual.immichApi, getSettings: vi.fn().mockResolvedValue(null) },
  };
});
// "About" asks the raw API client for the version, not `versionApi`; these
// tests read the navigation, not the section.
vi.mock("../../components/Settings/AboutSection", () => ({
  default: () => <section>about</section>,
}));

vi.mock("@/lib/api/flights", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/flights")>();
  return {
    ...actual,
    flightsApi: {
      ...actual.flightsApi,
      bulkRefreshPreview: vi
        .fn()
        .mockResolvedValue({ hasHistoricalProvider: false, aerodataboxQuota: null, count: 0 }),
    },
  };
});
vi.mock("@/lib/api/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/settings")>();
  return {
    ...actual,
    settingsApi: { ...actual.settingsApi, getApiKeyQuotas: vi.fn().mockResolvedValue({}) },
  };
});

vi.unmock("../../store/settingsStore");

// Released from the beta registry on 2026-09-18, so these three now mount
// unconditionally and fetch on mount. They were never the subject of these
// cases — the gate used to keep them out of the tree, and the network guard in
// `src/__tests__/setup.ts` failed the suite the moment it stopped.
vi.mock("../../components/Settings/DawarichConnectionCard", () => ({
  default: () => <div data-testid="dawarich-connection-card" />,
}));
vi.mock("../../components/Settings/ImmichConnectionCard", () => ({
  default: () => <div data-testid="immich-connection-card" />,
}));
vi.mock("../../components/Settings/RoutingProviderSection", () => ({
  default: () => <div data-testid="routing-provider-section" />,
}));
vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-bar-stub" />,
}));

// Flipped per test — the admin surface is what these cases are about.
let isAdmin = false;

vi.mock("../../components/Settings/useSettingsPage", () => ({
  useSettingsPage: () => ({
    user: { username: "owner", isAdmin },
    profile: { username: "owner", email: "", profilePicture: undefined },
    display: {},
    units: {},
    defaults: {},
    cruise: {},
    setProfile: vi.fn(),
    setDisplay: vi.fn(),
    setUnits: vi.fn(),
    setDefaults: vi.fn(),
    setCruise: vi.fn(),
    uploadingProfilePicture: false,
    handleAvatarUpload: vi.fn(),
    showPasswordModal: false,
    changingPassword: false,
    passwordForm: {},
    setPasswordForm: vi.fn(),
    passwordError: "",
    handlePasswordChange: vi.fn(),
    closePasswordModal: vi.fn(),
    lastBackup: null,
    backupStatus: null,
    autoUpdateSettings: null,
    setAutoUpdateSettings: vi.fn(),
    loadingAutoUpdateSettings: false,
    saveAutoUpdateSettings: vi.fn(),
    historicalEnrichmentSettings: null,
    setHistoricalEnrichmentSettings: vi.fn(),
    loadingHistoricalEnrichmentSettings: false,
    saveHistoricalEnrichmentSettings: vi.fn(),
    apiKeysStatus: null,
    apiKeys: {},
    setApiKeys: vi.fn(),
    loadingApiKeys: false,
    saveApiKeys: vi.fn(),
    setShowPasswordModal: vi.fn(),
  }),
}));

const renderAt = (initialEntry: string): void => {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/settings" element={<SettingsLegacyRedirect />} />
        <Route path="/settings/:group" element={<SettingsPage />} />
        <Route path="/admin" element={<div data-testid="admin-page" />} />
      </Routes>
    </MemoryRouter>
  );
};

/** `t` echoes the key, so a nav entry or a section for the old one reads this. */
const ADMIN_LABEL = "settings:admin.title";

const navListsAdmin = (): boolean =>
  screen.queryByRole("button", { name: ADMIN_LABEL }) !== null ||
  screen.queryByRole("option", { name: ADMIN_LABEL }) !== null ||
  screen.queryByRole("region", { name: ADMIN_LABEL }) !== null;

describe("SettingsPage — the settings/admin boundary", () => {
  beforeEach(() => {
    isAdmin = false;
    useSettingsStore.setState({ betaFeaturesEnabled: false, enabledDomains: ["flight"] });
  });

  it("offers no Admin section to an admin — the panel is a peer, not a subsection", async () => {
    isAdmin = true;
    renderAt("/settings");
    await screen.findByRole("region", { name: "settings:profile.title" });
    expect(navListsAdmin()).toBe(false);
  });

  it("offers no Admin section to a normal user either", async () => {
    renderAt("/settings");
    await screen.findByRole("region", { name: "settings:profile.title" });
    expect(navListsAdmin()).toBe(false);
  });

  /**
   * The removed section was a dead end whose whole content was a link to
   * /admin. The bookmarks outlive it, so they must land where that button
   * pointed rather than silently falling back to "profile".
   */
  it("sends an admin's bookmarked ?section=admin on to /admin", async () => {
    isAdmin = true;
    renderAt("/settings?section=admin");
    // The redirect runs in an effect, so it lands a tick after the first paint.
    expect(await screen.findByTestId("admin-page")).toBeTruthy();
  });

  it("does NOT redirect a non-admin — they have no admin panel to be sent to", async () => {
    renderAt("/settings?section=admin");
    await screen.findByRole("region", { name: "settings:profile.title" });
    expect(screen.queryByTestId("admin-page")).toBeNull();
  });

  it("states the scope of the surface, so a same-named admin entry is distinguishable", async () => {
    renderAt("/settings");
    expect(await screen.findByText("settings:scopeHint")).toBeTruthy();
  });
});
