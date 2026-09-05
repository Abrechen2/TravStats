import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SettingsPage, { SettingsLegacyRedirect } from "../../pages/SettingsPage";
import { useSettingsStore } from "../../store/settingsStore";
import { SETTINGS_GROUPS, groupOfSection } from "../../pages/Settings/settingsModel";
import { SECTION_LABEL_KEY } from "../../pages/Settings/sectionLabels";

vi.unmock("../../store/settingsStore");

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
    savingProfile: false,
    uploadingProfilePicture: false,
    saveProfileSettings: vi.fn(),
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

  it("renders the whole group at its own route, not one section at a time", async () => {
    renderAt("/settings/data");
    await screen.findByRole("region", { name: SECTION_LABEL_KEY.backup });

    // All four of the group's sections are on the page together.
    expect(sectionShown("backup")).toBe(true);
    expect(sectionShown("import")).toBe(true);
    expect(sectionShown("notifications")).toBe(true);
    expect(sectionShown("about")).toBe(true);
    // And nothing from a neighbouring group leaks in.
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
