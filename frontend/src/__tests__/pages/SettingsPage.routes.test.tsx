import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SettingsPage, { SettingsLegacyRedirect } from "../../pages/SettingsPage";
import { useSettingsStore } from "../../store/settingsStore";
import { SETTINGS_GROUPS, groupOfSection } from "../../pages/Settings/settingsModel";
import { SECTION_LABEL_KEY } from "../../pages/Settings/sectionLabels";

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

const renderAt = (entry: string): void => {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/settings" element={<SettingsLegacyRedirect />} />
        <Route path="/settings/:group" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>
  );
};

/** Sections are landmarks named after their own title (`t` echoes the key). */
const sectionShown = (id: keyof typeof SECTION_LABEL_KEY): boolean =>
  screen.queryByRole("region", { name: SECTION_LABEL_KEY[id] }) !== null;

/**
 * Settings became one route per group in 2.7.0 (owner decision 11 of
 * 2026-09-05). Before that, `/settings` carried `?tab=` and `?section=` and
 * four effects raced to keep them agreeing; the group is a destination now.
 *
 * Every case here fails against the pre-2.7 page, which had no `/settings/:group`
 * route at all.
 */
describe("SettingsPage — one route per group", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      betaFeaturesEnabled: false,
      enabledDomains: ["flight", "cruise", "lodging"],
    });
  });

  // Round 4 (design export, 2026-09-15) made the four general groups anchors on
  // one page: the settings routes are account, flight, cruise and lodging.
  it("draws every general group on the account route, with the domain ones kept apart", async () => {
    renderAt("/settings/account");
    await screen.findByRole("region", { name: SECTION_LABEL_KEY.profile });

    // Konto, Darstellung, Daten and Dienste share one page now.
    expect(sectionShown("profile")).toBe(true);
    expect(sectionShown("units")).toBe(true);
    expect(sectionShown("backup")).toBe(true);
    expect(sectionShown("externalServices")).toBe(true);
    // A domain group is still its own route.
    expect(sectionShown("homeAirport")).toBe(false);
  });

  it("lands a pre-round-4 group route on its anchor on the account page", async () => {
    // /settings/data was a page of its own; a bookmark to it still arrives.
    renderAt("/settings/data");
    expect(await screen.findByRole("region", { name: SECTION_LABEL_KEY.backup })).toBeTruthy();
    expect(sectionShown("profile")).toBe(true);
  });

  it("keeps a domain group's own sections on its own route", async () => {
    renderAt("/settings/cruise");
    await screen.findByRole("region", { name: SECTION_LABEL_KEY.cruisePreferences });
    expect(sectionShown("profile")).toBe(false);
  });

  it("sends a bare /settings to the account group", async () => {
    renderAt("/settings");
    expect(await screen.findByRole("region", { name: SECTION_LABEL_KEY.profile })).toBeTruthy();
  });

  it("lands a pre-2.7 ?section= link on the group that holds it", async () => {
    renderAt("/settings?section=notifications");
    expect(
      await screen.findByRole("region", { name: SECTION_LABEL_KEY.notifications })
    ).toBeTruthy();
  });

  it("lands the renamed ?section=apiKeys link on the services group", async () => {
    // Renamed to `externalServices` when the Immich connection moved in (#182);
    // the old id outlives the rename in bookmarks.
    renderAt("/settings?section=apiKeys");
    expect(
      await screen.findByRole("region", { name: SECTION_LABEL_KEY.externalServices })
    ).toBeTruthy();
  });

  it("lands a pre-2.7 ?tab= link on that domain's group", async () => {
    renderAt("/settings?tab=cruise");
    expect(
      await screen.findByRole("region", { name: SECTION_LABEL_KEY.cruisePreferences })
    ).toBeTruthy();
  });

  it("sends a domain group whose domain is switched off back to the default", async () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    renderAt("/settings/cruise");
    expect(await screen.findByRole("region", { name: SECTION_LABEL_KEY.profile })).toBeTruthy();
  });

  it("sends an unknown group back to the default rather than rendering an empty frame", async () => {
    renderAt("/settings/does-not-exist");
    expect(await screen.findByRole("region", { name: SECTION_LABEL_KEY.profile })).toBeTruthy();
  });

  // The tester could never open "Über TravStats" — the last section's
  // scrollMarginTop target sits past the end of the scrollable document, so
  // it can never reach the top of the viewport and the IntersectionObserver
  // never marks it active. jsdom does not lay out or scroll, so this only
  // pins that the spacer renders; the actual reachability needs a browser
  // (see task-1-report.md).
  it("renders a scroll-tail spacer after the last section, so it can reach scrollMarginTop", async () => {
    renderAt("/settings/account");
    await screen.findByRole("region", { name: SECTION_LABEL_KEY.profile });
    expect(document.querySelector('[data-testid="settings-scroll-tail"]')).toBeInTheDocument();
  });
});

describe("the settings group table", () => {
  it("gives every section exactly one home", () => {
    const seen = new Map<string, string>();
    for (const group of SETTINGS_GROUPS) {
      for (const section of group.sections) {
        expect(seen.has(section), `${section} is in two groups`).toBe(false);
        seen.set(section, group.id);
      }
    }
    // And the lookup agrees with the table it is built from.
    for (const [section, groupId] of seen) {
      expect(groupOfSection(section)?.id).toBe(groupId);
    }
  });

  it("labels every section, so no index entry renders a raw id", () => {
    for (const group of SETTINGS_GROUPS) {
      for (const section of group.sections) {
        expect(SECTION_LABEL_KEY[section], `${section} has no label key`).toBeTruthy();
      }
    }
  });
});
