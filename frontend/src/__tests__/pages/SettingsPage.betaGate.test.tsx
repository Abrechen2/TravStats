import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SettingsPage from "../../pages/SettingsPage";
import { useSettingsStore } from "../../store/settingsStore";

// Real store — the beta gate lives in it.
vi.unmock("../../store/settingsStore");

// Heavy siblings with their own data fetching; irrelevant to the gate.
vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-bar-stub" />,
}));
vi.mock("../../components/Settings/DevicesSection", () => ({
  default: () => <div data-testid="devices-section" />,
}));
// MEDIUM-1 (final whole-phase review, 2026-08-29): stubbed the same way
// DevicesSection is above — its own fetches on mount are irrelevant to
// whether the beta gate mounts it at all.
vi.mock("../../components/Settings/DawarichConnectionCard", () => ({
  default: () => <div data-testid="dawarich-connection-card" />,
}));
vi.mock("../../components/Settings/ImmichConnectionCard", () => ({
  default: () => <div data-testid="immich-connection-card" />,
}));
vi.mock("../../components/Settings/RoutingProviderSection", () => ({
  default: () => <div data-testid="routing-provider-section" />,
}));

// The page's data hook fires API requests on mount. Everything it returns is
// only consumed by sections we never render in these cases.
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

// `t` echoes the key, so the Devices nav entry reads "settings:devices.title".
const DEVICES_LABEL = "settings:devices.title";

const renderSettings = (initialEntry: string): void => {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>
  );
};

/** The nav = the sidebar buttons + the mobile <select> options. */
const navListsDevices = (): boolean =>
  screen.queryByRole("button", { name: DEVICES_LABEL }) !== null ||
  screen.queryByRole("option", { name: DEVICES_LABEL }) !== null;

/**
 * `devicePairing` was un-gated on 2026-09-01 — the phone app it was waiting on
 * (TravStatsCompanion) shipped, and the gate was hiding the only place a claim
 * code is minted. What these cases now pin is that the entry is UNCONDITIONAL:
 * the beta flag has no say over it in any of its three states, including the
 * `null` one a cold load spends in flight. A gate re-introduced by accident
 * would fail the `null` and `false` cases here.
 */
describe("SettingsPage — Devices is no longer gated", () => {
  beforeEach(() => {
    useSettingsStore.setState({ betaFeaturesEnabled: null, enabledDomains: ["flight"] });
  });

  it.each([
    ["unknown", null],
    ["off", false],
    ["on", true],
  ])("lists Devices in the nav while the beta flag is %s", (_label, flag) => {
    useSettingsStore.setState({ betaFeaturesEnabled: flag });
    renderSettings("/settings");
    expect(navListsDevices()).toBe(true);
  });

  /**
   * Still load-bearing, for a different reason than before. The section model
   * and the nav list remain separate concepts, and `devices` must stay in the
   * MODEL: the deep link is what the pairing QR flow is reached by from the
   * Companion app's own instructions. A naive "remove devices from the
   * sections array" would bounce the user to "profile".
   */
  it("renders DevicesSection for ?section=devices, and lists it too", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    renderSettings("/settings?section=devices");

    expect(screen.getByTestId("devices-section")).toBeTruthy();
    expect(navListsDevices()).toBe(true);
  });

  it("does not render DevicesSection when another section is active", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    renderSettings("/settings");
    expect(screen.queryByTestId("devices-section")).toBeNull();
  });
});

/**
 * `DawarichConnectionCard` used to render unconditionally, then behind
 * `isFeatureVisible("tourRoutes")`, then behind its OWN `dawarich` key — the
 * card offers a connection, and a connection with no consumer is noise. Tour
 * routes shipped on 2026-09-01, which is the event that key's `returnsWhen`
 * named, so the gate came off with it.
 * `ImmichConnectionCard` is the control: it never had a gate, and pinning both
 * together is what shows the card is now as unconditional as its neighbour.
 */
describe("SettingsPage — the Dawarich connection card is no longer gated", () => {
  beforeEach(() => {
    useSettingsStore.setState({ betaFeaturesEnabled: null, enabledDomains: ["flight"] });
  });

  it.each([
    ["unknown", null],
    ["off", false],
    ["on", true],
  ])("renders the Dawarich card on externalServices while the flag is %s", (_label, flag) => {
    useSettingsStore.setState({ betaFeaturesEnabled: flag });
    renderSettings("/settings?section=externalServices");

    expect(screen.getByTestId("dawarich-connection-card")).toBeTruthy();
    expect(screen.getByTestId("immich-connection-card")).toBeTruthy();
  });
});

/**
 * `RoutingProviderSection` is the Dawarich card's sibling and was gated on
 * `tourRoutes` for the same reason: it configures a road router for TOUR legs
 * and has no other consumer. Tours shipped, so the card is unconditional now —
 * except for the `isAdmin` prop it has always had, which is a permission, not
 * a gate, and is covered where that component is tested.
 */
describe("SettingsPage — the routing provider card is no longer gated", () => {
  beforeEach(() => {
    useSettingsStore.setState({ betaFeaturesEnabled: null, enabledDomains: ["flight"] });
  });

  it.each([
    ["unknown", null],
    ["off", false],
    ["on", true],
  ])("renders the routing provider card while the flag is %s", (_label, flag) => {
    useSettingsStore.setState({ betaFeaturesEnabled: flag });
    renderSettings("/settings?section=externalServices");

    expect(screen.getByTestId("routing-provider-section")).toBeTruthy();
    expect(screen.getByTestId("immich-connection-card")).toBeTruthy();
  });
});
