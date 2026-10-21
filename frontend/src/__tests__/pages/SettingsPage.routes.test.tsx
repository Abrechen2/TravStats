vi.mock("../../components/Settings/DawarichStayScanCard", () => ({ default: () => null }));
import { describe, it, expect, beforeEach, vi } from "vitest";
// The version line under the settings menu asks the server (forgejo#321).
vi.mock("@/lib/api/version", () => ({
  versionApi: { get: vi.fn().mockResolvedValue({ version: "2.7.0", buildVersion: "2.7.0" }) },
}));

import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SettingsPage, { SettingsLegacyRedirect } from "../../pages/SettingsPage";
import { useSettingsStore } from "../../store/settingsStore";
import { useSettingsLevelStore } from "../../store/settingsLevelStore";
import { SETTINGS_PAGES } from "../../pages/Settings/settingsModel";
import { pageOfSection } from "../../pages/Settings/surface";
import { SECTION_LABEL_KEY } from "../../pages/Settings/sectionLabels";
import { findNamed, queryNamed } from "../helpers/namedElement";

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
  queryNamed("region", SECTION_LABEL_KEY[id]) !== null;

/**
 * Settings became one route per group in 2.7.0 (owner decision 11 of
 * 2026-09-05). Before that, `/settings` carried `?tab=` and `?section=` and
 * four effects raced to keep them agreeing; the group is a destination now.
 *
 * Every case here fails against the pre-2.7 page, which had no `/settings/:group`
 * route at all.
 */
describe("SettingsPage — one page per menu entry", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      betaFeaturesEnabled: false,
      enabledDomains: ["flight", "cruise", "lodging"],
    });
  });

  // forgejo#321: one page per menu entry. Round 4 had drawn the general
  // groups as anchors on ONE account page; a menu entry is a page again.
  it("draws only the account page's own sections on the account route", async () => {
    renderAt("/settings/account");
    await findNamed("region", SECTION_LABEL_KEY.profile);

    expect(sectionShown("profile")).toBe(true);
    expect(sectionShown("notifications")).toBe(true);
    // Darstellung, Daten and Dienste are pages of their own now.
    expect(sectionShown("units")).toBe(false);
    expect(sectionShown("backup")).toBe(false);
    expect(sectionShown("externalServices")).toBe(false);
    expect(sectionShown("homeAirport")).toBe(false);
  });

  it("draws /settings/data as a page of its own", async () => {
    renderAt("/settings/data");
    expect(await findNamed("region", SECTION_LABEL_KEY.backup)).toBeTruthy();
    expect(sectionShown("import")).toBe(true);
    expect(sectionShown("profile")).toBe(false);
  });

  it("titles the page with its menu label, word for word", async () => {
    renderAt("/settings/display");
    await findNamed("region", SECTION_LABEL_KEY.units);
    // By selector, not by role: the page holds hundreds of currency options,
    // and a role query weighs every one (see SettingsPage.adminScope.test).
    expect(document.querySelector("h1")).toHaveTextContent("settings:groups.display");
    const active = document.querySelector('[data-settings-menu] a[aria-current="page"]');
    expect(active).toHaveTextContent("settings:groups.display");
  });

  it("lands a round-4 anchor on the account page on the page that holds it now", async () => {
    renderAt("/settings/account?section=units");
    expect(await findNamed("region", SECTION_LABEL_KEY.units)).toBeTruthy();
    expect(sectionShown("profile")).toBe(false);
  });

  it("keeps a domain group's own sections on its own route", async () => {
    renderAt("/settings/cruise");
    await findNamed("region", SECTION_LABEL_KEY.cruisePreferences);
    expect(sectionShown("profile")).toBe(false);
  });

  it("sends a bare /settings to the account group", async () => {
    renderAt("/settings");
    expect(await findNamed("region", SECTION_LABEL_KEY.profile)).toBeTruthy();
  });

  it("lands a pre-2.7 ?section= link on the group that holds it", async () => {
    renderAt("/settings?section=notifications");
    expect(await findNamed("region", SECTION_LABEL_KEY.notifications)).toBeTruthy();
  });

  it("lands the renamed ?section=apiKeys link on the services group", async () => {
    // Renamed to `externalServices` when the Immich connection moved in (#182);
    // the old id outlives the rename in bookmarks.
    renderAt("/settings?section=apiKeys");
    expect(await findNamed("region", SECTION_LABEL_KEY.externalServices)).toBeTruthy();
  });

  // The three per-domain "Bonusprogramme" sections became ONE general section
  // (owner, 2026-09-26). Their ids live on in links and in the 2.6 chain page.
  it("lands an old per-domain loyalty section on Einstellungen → Bonusprogramme", async () => {
    renderAt("/settings/lodging?section=lodgingMemberships");
    expect(await findNamed("region", SECTION_LABEL_KEY.loyalty)).toBeTruthy();
    expect(screen.getByTestId("loyalty-section-stub")).toBeTruthy();
  });

  it("lands a pre-2.7 ?section=flightMemberships link there too", async () => {
    renderAt("/settings?section=flightMemberships");
    expect(await findNamed("region", SECTION_LABEL_KEY.loyalty)).toBeTruthy();
  });

  it("keeps no loyalty section on a domain route", async () => {
    renderAt("/settings/cruise");
    await findNamed("region", SECTION_LABEL_KEY.cruisePreferences);
    expect(screen.queryByTestId("loyalty-section-stub")).toBeNull();
  });

  it("lands a pre-2.7 ?tab= link on that domain's group", async () => {
    renderAt("/settings?tab=cruise");
    expect(await findNamed("region", SECTION_LABEL_KEY.cruisePreferences)).toBeTruthy();
  });

  it("sends a domain group whose domain is switched off back to the default", async () => {
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    renderAt("/settings/cruise");
    expect(await findNamed("region", SECTION_LABEL_KEY.profile)).toBeTruthy();
  });

  it("sends an unknown group back to the default rather than rendering an empty frame", async () => {
    renderAt("/settings/does-not-exist");
    expect(await findNamed("region", SECTION_LABEL_KEY.profile)).toBeTruthy();
  });

  // The page used to end in a spacer roughly one viewport tall, so the last
  // section could reach the top of the viewport and its menu entry could
  // become active at all. The tester saw it as a screenful of nothing under
  // the last card, and noted it only bit when the last section was SHORT.
  // `useSectionInView` carries the rule now — at the bottom of the document
  // the last section is the active one — so the spacer has no job left.
  it("ends with the last section, with no empty scroll tail under it", async () => {
    renderAt("/settings/account");
    await findNamed("region", SECTION_LABEL_KEY.profile);
    expect(document.querySelector('[data-testid="settings-scroll-tail"]')).toBeNull();
  });
});

describe("SettingsPage — the standard level (forgejo#321)", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      betaFeaturesEnabled: false,
      enabledDomains: ["flight", "cruise", "lodging"],
    });
    useSettingsLevelStore.setState({ level: "standard" });
  });

  it("leaves the expert section off the page and says one more setting exists", async () => {
    renderAt("/settings/account");
    await findNamed("region", SECTION_LABEL_KEY.profile);
    expect(sectionShown("apitokens")).toBe(false);
    expect(document.querySelector('[data-expert-note="settings"]')).toHaveTextContent(
      "settings:level.moreSettings"
    );
  });

  it("shows an expert section a link names, with the note above it", async () => {
    renderAt("/settings?section=apitokens");
    expect(await findNamed("region", SECTION_LABEL_KEY.apitokens)).toBeTruthy();
    expect(screen.getByText("settings:level.deepLinkedExpert")).toBeTruthy();
  });

  it("shows an expert row a link names, and only then", async () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/settings/data?section=backup&expert=1"]}>
        <Routes>
          <Route path="/settings/:group" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>
    );
    await findNamed("region", SECTION_LABEL_KEY.backup);
    expect(screen.getByText("settings:backup.lastInstanceBackup")).toBeTruthy();
    expect(screen.getByText("settings:level.revealedRows")).toBeTruthy();
    unmount();

    renderAt("/settings/data?section=backup");
    await findNamed("region", SECTION_LABEL_KEY.backup);
    expect(screen.queryByText("settings:backup.lastInstanceBackup")).toBeNull();
  });

  it("puts the level switch at the top of the page", async () => {
    renderAt("/settings/account");
    await findNamed("region", SECTION_LABEL_KEY.profile);
    expect(screen.getByRole("radiogroup", { name: "settings:level.label" })).toBeTruthy();
  });

  it("keeps the version in view for every account, under the menu", async () => {
    renderAt("/settings/account");
    await findNamed("region", SECTION_LABEL_KEY.profile);
    expect((await screen.findAllByTestId("settings-version"))[0]).toHaveTextContent(
      "settings:menu.version"
    );
  });
});

describe("the settings page table", () => {
  it("gives every section exactly one home", () => {
    const seen = new Map<string, string>();
    for (const page of SETTINGS_PAGES) {
      for (const section of page.sections) {
        expect(seen.has(section.id), `${section.id} is on two pages`).toBe(false);
        seen.set(section.id, page.id);
      }
    }
    // And the lookup agrees with the table it is built from.
    for (const [section, pageId] of seen) {
      expect(pageOfSection(SETTINGS_PAGES, section)?.id).toBe(pageId);
    }
  });

  it("labels every section, so no chip or heading renders a raw id", () => {
    for (const page of SETTINGS_PAGES) {
      for (const section of page.sections) {
        expect(SECTION_LABEL_KEY[section.id], `${section.id} has no label key`).toBeTruthy();
        expect(section.labelKey).toBe(SECTION_LABEL_KEY[section.id]);
      }
    }
  });
});
