vi.mock("../../components/Settings/location/StayScanSection", () => ({ default: () => null }));
import { describe, it, expect, beforeEach, vi } from "vitest";
// The services page asks the parser whether a model is there (forgejo#321);
// not the subject here.
vi.mock("../../hooks/useHasLlm", () => ({ useHasLlm: () => null, resetHasLlmCache: () => {} }));
// The version line under the settings menu asks the server (forgejo#321).
vi.mock("@/lib/api/version", () => ({
  versionApi: { get: vi.fn().mockResolvedValue({ version: "2.7.0", buildVersion: "2.7.0" }) },
}));

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SettingsPage from "../../pages/SettingsPage";
import { useSettingsStore } from "../../store/settingsStore";
import { findNamed } from "../helpers/namedElement";

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
// Shared trips (2026-10-09): the trip overview, the settings and the inbox
// read the sharing API on mount; answered empty so no request escapes.
vi.mock("@/lib/api/sharing", () => ({
  sharingApi: {
    tripSharing: vi.fn().mockResolvedValue({
      groupId: null,
      people: [],
      linkableUsers: [],
      bookingTotals: [],
    }),
    listConsents: vi.fn().mockResolvedValue({ incoming: [], outgoing: [] }),
    listCompanions: vi.fn().mockResolvedValue({ companions: [], linkableUsers: [] }),
    listNotices: vi.fn().mockResolvedValue([]),
    inboxCount: vi.fn().mockResolvedValue(0),
  },
}));

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
        domains: Object.fromEntries(
          ["flight", "cruise", "rail", "bus", "ferry", "lodging"].map((d) => [
            d,
            { enabled: false, leadHours: [24], channel: "app" },
          ])
        ),
        mail: { available: false, reason: "no_email" },
        push: { available: false, reason: "no_relay" },
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
// Fetches the user's settings and facts on mount (home country, passport) — not the subject here.
vi.mock("../../components/Settings/HomeSection", () => ({
  default: () => <div data-testid="home-section" />,
}));
vi.mock("../../components/ExternalServices/LegacyServiceSummary", () => ({
  default: () => <div data-testid="dawarich-connection-card" />,
}));
vi.mock("../../components/Settings/StravaConnectionCard", () => ({
  default: () => <div data-testid="strava-connection-card" />,
}));
vi.mock("../../components/Settings/ImmichConnectionCard", () => ({
  default: () => <div data-testid="immich-connection-card" />,
}));
vi.mock("../../components/Settings/PhotoJourneyNightlyScanCard", () => ({
  default: () => <div data-testid="photo-journey-nightly-scan-card" />,
}));
// Public share links (forgejo#281) load their list on mount — not the subject here.
vi.mock("../../components/Settings/ShareLinksSection", () => ({
  default: () => <div data-testid="share-links-section" />,
}));
vi.mock("../../components/Settings/RoutingProviderSection", () => ({
  default: () => <div data-testid="routing-provider-section" />,
}));
vi.mock("../../components/Settings/PersonalRoutingKeysSection", () => ({
  default: () => <div data-testid="personal-routing-keys" />,
}));
vi.mock("@/lib/api/locationProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/locationProvider")>()),
  locationProviderApi: { get: vi.fn().mockResolvedValue({ kind: "travtrack" }), set: vi.fn() },
}));
vi.mock("@/lib/api/webdavSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/webdavSync")>();
  return {
    ...actual,
    // The WebDAV card on /settings/data fetches its status on mount; it is not
    // the subject here, so it answers "not configured" without a request.
    webdavSyncApi: {
      ...actual.webdavSyncApi,
      get: vi.fn().mockResolvedValue({
        enabled: false,
        url: null,
        username: null,
        hasPassword: false,
        remotePath: "TravStats",
        schedule: "daily",
        keepVersions: 7,
        ranAt: null,
        completedAt: null,
        lastStatus: null,
        lastErrorCode: null,
        lastFileName: null,
        lastSizeBytes: null,
        running: false,
        allowPrivateTargets: false,
      }),
    },
  };
});
// The rebuilt rows read these themselves; the page tests answer them instead of the network.
vi.mock("@/lib/api/backup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/backup")>();
  return {
    ...actual,
    backupApi: {
      ...actual.backupApi,
      getInstanceStatus: vi.fn().mockResolvedValue({ completedAt: null, running: false }),
    },
  };
});
vi.mock("@/lib/api/externalServices", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/externalServices")>();
  return {
    ...actual,
    externalServicesApi: {
      ...actual.externalServicesApi,
      accountOverview: vi
        .fn()
        .mockResolvedValue({ connections: [], ownKeys: [], aiConsents: [], instanceProvided: [] }),
    },
  };
});
vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-bar-stub" />,
}));
// The two lodging sections each load their own data on mount. These cases are
// about which sections the PAGE decides to draw, not about what the cards show.
vi.mock("../../components/Settings/GeocoderSettingsCard", () => ({
  default: ({ isAdmin: cardIsAdmin }: { isAdmin: boolean }) =>
    cardIsAdmin ? <div data-testid="geocoder-card" /> : null,
}));
vi.mock("../../components/Settings/LoyaltySection", () => ({
  default: () => <div data-testid="loyalty-section-stub" />,
}));

// Flipped per test — the server's pages are what these cases are about.
let isAdmin = false;

// The services catalogue loads from the server — not the subject here.
vi.mock("../../components/ExternalServices/AccountExternalServices", () => ({
  default: () => <div data-testid="account-external-services" />,
}));

// The server's sections load accounts, parser settings and more on mount; the
// boundary under test is which page is drawn, not what is in it.
vi.mock("../../pages/Admin/AdminHost", () => ({
  AdminHost: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AdminSectionBody: ({ section }: { section: string }) => (
    <div data-testid={`admin-body-${section}`} />
  ),
}));

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
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:page" element={<SettingsPage />} />
        <Route path="/admin" element={<SettingsPage />} />
        <Route path="/admin/:page" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>
  );
};

/*
 * The page is told apart by its title (`t` echoes the key), not by role: this
 * page holds ~460 <option>s (currency, country, home country), and a role
 * query weighs the accessible name and visibility of every candidate through
 * jsdom's getComputedStyle: measured 2026-10-09 at 5-7 s for one
 * `queryByRole("link", { name })` on a developer machine.
 */
const pageTitle = async (key: string): Promise<void> => {
  await waitFor(() =>
    expect(document.querySelector("h1")).toHaveTextContent(`settings:area.pages.${key}`)
  );
};

const ADMIN_ONLY_NOTICE = "settings:area.adminOnlyNotice";

describe("SettingsPage — the account/server boundary", () => {
  beforeEach(() => {
    isAdmin = false;
    useSettingsStore.setState({ betaFeaturesEnabled: false, enabledDomains: ["flight"] });
  });

  it("is one area: there is no second Administration tab, for an admin or anyone", async () => {
    isAdmin = true;
    renderAt("/settings/account");
    await findNamed("region", "settings:profile.title");
    expect(screen.queryByRole("navigation", { name: "settings:frame.surfaces" })).toBeNull();
  });

  it("lists the server's group in the menu for an admin only", async () => {
    isAdmin = true;
    renderAt("/settings/account");
    await findNamed("region", "settings:profile.title");
    const menu = document.querySelector("[data-settings-menu]") as HTMLElement;
    expect(menu.querySelector('a[href="/settings/server"]')).not.toBeNull();
    expect(menu).toHaveTextContent("settings:area.menu.server");
  });

  it("keeps the server's group out of the menu of an account without the permission", async () => {
    renderAt("/settings/account");
    await findNamed("region", "settings:profile.title");
    const menu = document.querySelector("[data-settings-menu]") as HTMLElement;
    expect(menu.querySelector('a[href="/settings/server"]')).toBeNull();
    expect(menu).not.toHaveTextContent("settings:area.menu.server");
  });

  /**
   * The removed section was a dead end whose whole content was a link to
   * /admin. The bookmarks outlive it, so they must land where that button
   * pointed rather than silently falling back to "profile".
   */
  it("sends an admin's bookmarked ?section=admin on to the Server page", async () => {
    isAdmin = true;
    renderAt("/settings?section=admin");
    await pageTitle("server");
    expect(screen.getByTestId("admin-body-instance")).toBeTruthy();
  });

  it("sends a non-admin's ?section=admin to their own account page", async () => {
    renderAt("/settings?section=admin");
    await findNamed("region", "settings:profile.title");
    await pageTitle("account");
    expect(screen.queryByTestId("admin-body-instance")).toBeNull();
  });

  it("states the scope of the page, so a same-named server entry is distinguishable", async () => {
    renderAt("/settings/account");
    expect(await screen.findByText("settings:area.scope.account")).toBeTruthy();
  });

  /**
   * forgejo#88 finding 11, rebuilt: an admin address opened by an account
   * without the permission used to leave the address and the screen
   * disagreeing. It now lands on the account's own page with the line that
   * says why (design §6) — no panel is drawn, and nothing is asked of the server.
   */
  it.each(["/admin/users", "/admin/logging", "/settings/server", "/settings/masterdata"])(
    "sends a non-admin from %s to their own page, and says why",
    async (address) => {
      renderAt(address);
      expect(await screen.findByText(ADMIN_ONLY_NOTICE)).toBeTruthy();
      await pageTitle("account");
      expect(document.querySelector('[data-testid^="admin-body-"]')).toBeNull();
    }
  );

  it("sends a non-admin's old backups address to the data page, where the backup status is", async () => {
    renderAt("/admin/backups");
    expect(await screen.findByText(ADMIN_ONLY_NOTICE)).toBeTruthy();
    await pageTitle("data");
  });

  it("draws the server's page for an admin on the same address, with no notice", async () => {
    isAdmin = true;
    renderAt("/admin/users");
    await pageTitle("users");
    expect(screen.getByTestId("admin-body-users")).toBeTruthy();
    expect(screen.queryByText(ADMIN_ONLY_NOTICE)).toBeNull();
  });

  it("keeps the notice off an address everyone may open (About moved to everyone)", async () => {
    renderAt("/admin/instance#about");
    await pageTitle("about");
    expect(screen.queryByText(ADMIN_ONLY_NOTICE)).toBeNull();
  });

  // The geocoder configures the instance: for a normal account the old
  // lodging address is just their display page, with nothing said (§6.2).
  it("sends a non-admin's old lodging address to the display page", async () => {
    renderAt("/settings?tab=lodging&section=lodgingPreferences");
    await pageTitle("display");
    expect(screen.queryByText(ADMIN_ONLY_NOTICE)).toBeNull();
  });

  it("sends an old /settings/lodging address to the display page too", async () => {
    renderAt("/settings/lodging");
    await pageTitle("display");
  });

  it("sends an admin on to the geocoder, a service card of Dienste", async () => {
    isAdmin = true;
    renderAt("/settings?tab=lodging&section=lodgingPreferences");
    await pageTitle("services");
    expect(screen.queryByText(ADMIN_ONLY_NOTICE)).toBeNull();
  });

  it("stays quiet on a deep link to a section everyone may see", async () => {
    renderAt("/settings?section=profile");
    await findNamed("region", "settings:profile.title");
    expect(screen.queryByText(ADMIN_ONLY_NOTICE)).toBeNull();
  });
});
