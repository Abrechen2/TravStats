import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SettingsPage, { SettingsLegacyRedirect } from "../../pages/SettingsPage";
import { useSettingsStore } from "../../store/settingsStore";

vi.unmock("../../store/settingsStore");

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
