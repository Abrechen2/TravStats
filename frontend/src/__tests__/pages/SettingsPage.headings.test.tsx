vi.mock("../../components/Settings/DawarichStayScanCard", () => ({ default: () => null }));
import { describe, it, expect, beforeEach, vi } from "vitest";
// The services page asks the parser whether a model is there (forgejo#321);
// not the subject here.
vi.mock("../../hooks/useHasLlm", () => ({ useHasLlm: () => null, resetHasLlmCache: () => {} }));
// The version line under the settings menu asks the server (forgejo#321).
vi.mock("@/lib/api/version", () => ({
  versionApi: { get: vi.fn().mockResolvedValue({ version: "2.7.0", buildVersion: "2.7.0" }) },
}));

import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SettingsPage from "../../pages/SettingsPage";
import { useSettingsStore } from "../../store/settingsStore";
import { useSettingsLevelStore } from "../../store/settingsLevelStore";
import { SETTINGS_PAGES } from "../../pages/Settings/settingsModel";
import { repeatedHeadings } from "../helpers/repeatedHeadings";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

// Settings → Mitreisende reads its list on mount.
vi.mock("@/lib/api/companions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/companions")>()),
  companionsApi: {
    list: vi.fn().mockResolvedValue([]),
    manage: vi.fn().mockResolvedValue({ companions: [], kinds: ["flight", "trip"] }),
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

vi.unmock("../../store/settingsStore");

// Released from the beta registry on 2026-09-18, so these three now mount
// unconditionally and fetch on mount. They were never the subject of these
// cases — the gate used to keep them out of the tree, and the network guard in
// `src/__tests__/setup.ts` failed the suite the moment it stopped.
// Fetches the user's settings on mount (P5 home country) — not the subject here.
vi.mock("../../components/Settings/HomeCountryCard", () => ({
  default: () => <div data-testid="home-country-card" />,
}));
vi.mock("../../components/Settings/DawarichConnectionCard", () => ({
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
// Einstellungen → Bonusprogramme loads every loyalty card on mount; these
// cases are about the page's navigation, not about the cards.
vi.mock("../../components/Settings/LoyaltySection", () => ({
  default: () => <div data-testid="loyalty-section-stub" />,
}));
// Reads the home periods on mount; these cases are about the page's frame.
vi.mock("../../components/Settings/HomeAirportSection", () => ({
  default: () => <div data-testid="home-airport-stub" />,
}));
vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-bar-stub" />,
}));

vi.mock("../../components/Settings/useSettingsPage", () => ({
  useSettingsPage: () => ({
    user: { username: "owner", isAdmin: false },
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
    autoUpdateSettings: {
      enabled: false,
      requireApproval: true,
      checkInterval: 15,
      onlyDuringFlight: true,
      expiryHours: 24,
    },
    setAutoUpdateSettings: vi.fn(),
    loadingAutoUpdateSettings: false,
    saveAutoUpdateSettings: vi.fn(),
    historicalEnrichmentSettings: { enabled: false, minConfidence: 60, maxPerDay: 50 },
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

/**
 * Real German copy, not echoed keys: two different keys can say the same words
 * ("Bonusprogramme" is both the menu label and the loyalty heading), and only
 * the words show whether a heading repeats the one above it.
 */
vi.mock("../../hooks/useTranslation", () => {
  const cache = new Map<string, Record<string, unknown>>();
  const load = (ns: string): Record<string, unknown> => {
    if (!cache.has(ns)) {
      const file = join(__dirname, "../../i18n/resources/de", `${ns}.json`);
      cache.set(ns, JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>);
    }
    return cache.get(ns)!;
  };
  return {
    useTranslation: (namespaces?: string | string[]) => {
      const first = (Array.isArray(namespaces) ? namespaces[0] : namespaces) ?? "common";
      const t = (key: string, opts?: Record<string, unknown>): string => {
        const [ns, path] = key.includes(":") ? key.split(":", 2) : [first, key];
        let node: unknown;
        try {
          node = path
            .split(".")
            .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], load(ns));
        } catch {
          node = undefined;
        }
        if (typeof node !== "string") return (opts?.defaultValue as string | undefined) ?? key;
        return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ""));
      };
      return { t, i18n: { language: "de" } };
    },
  };
});

describe("SettingsPage — no heading repeats the one above it (forgejo#321)", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      betaFeaturesEnabled: false,
      enabledDomains: ["flight", "cruise", "lodging"],
    });
    useSettingsLevelStore.setState({ level: "expert" });
  });

  it.each(SETTINGS_PAGES.map((p) => [p.id]))("holds on /settings/%s", async (page) => {
    const { unmount } = render(
      <MemoryRouter initialEntries={[`/settings/${page}`]}>
        <Routes>
          <Route path="/settings/:group" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>
    );
    // Real copy: wait for the page's first section by its landmark id.
    await waitFor(() =>
      expect(
        document.getElementById(
          `settings-${SETTINGS_PAGES.find((p) => p.id === page)!.sections[0].id}`
        )
      ).not.toBeNull()
    );
    expect(repeatedHeadings(document.body)).toEqual([]);
    unmount();
  });
});
