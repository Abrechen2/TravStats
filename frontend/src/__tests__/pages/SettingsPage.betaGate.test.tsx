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

describe("SettingsPage — beta gate: devicePairing", () => {
  beforeEach(() => {
    useSettingsStore.setState({ betaFeaturesEnabled: null, enabledDomains: ["flight"] });
  });

  it("does not list Devices in the nav when the flag is OFF", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    renderSettings("/settings");
    expect(navListsDevices()).toBe(false);
  });

  it("lists Devices in the nav when the flag is ON", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });
    renderSettings("/settings");
    expect(navListsDevices()).toBe(true);
  });

  /**
   * THE load-bearing case. With the nav entry hidden, /settings?section=devices
   * is the ONLY way to reach the QR pairing flow — the owner still uses it. The
   * section model and the nav list are separate concepts precisely so this
   * deep link keeps working; a naive "remove devices from the sections array"
   * would bounce the user to "profile" instead.
   */
  it("still renders DevicesSection for ?section=devices with the flag OFF, without listing it in the nav", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    renderSettings("/settings?section=devices");

    expect(screen.getByTestId("devices-section")).toBeTruthy();
    expect(navListsDevices()).toBe(false);
  });

  it("renders DevicesSection for ?section=devices with the flag ON too", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });
    renderSettings("/settings?section=devices");

    expect(screen.getByTestId("devices-section")).toBeTruthy();
    expect(navListsDevices()).toBe(true);
  });

  it("falls back to the first visible section when no ?section is given", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    renderSettings("/settings");
    expect(screen.queryByTestId("devices-section")).toBeNull();
  });
});

/**
 * MEDIUM-1 (final whole-phase review, 2026-08-29): `DawarichConnectionCard`
 * used to render unconditionally on `externalServices` — with the beta flag
 * OFF (production's setting), every user saw a connection card for a feature
 * invisible everywhere else (the Touren tab, the route editor). It was first
 * gated via `isFeatureVisible("tourRoutes")`; since `6247e262` it has its OWN
 * `dawarich` key, because cruise legs will pull from the same connection and a
 * gate named after tours would then hide a card the cruise feature needs.
 * These cases flip the MASTER switch, so they hold either way — which is
 * exactly why the docstring had to be corrected by hand rather than by a
 * failing test.
 * `ImmichConnectionCard` is the control: it has NO such gate and must keep
 * rendering regardless of the flag.
 */
describe("SettingsPage — beta gate: the Dawarich connection card", () => {
  beforeEach(() => {
    useSettingsStore.setState({ betaFeaturesEnabled: null, enabledDomains: ["flight"] });
  });

  it("does not render the Dawarich card on externalServices when the flag is OFF", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    renderSettings("/settings?section=externalServices");

    expect(screen.queryByTestId("dawarich-connection-card")).toBeNull();
    // The control: Immich has no such gate and must still render.
    expect(screen.getByTestId("immich-connection-card")).toBeTruthy();
  });

  it("renders the Dawarich card on externalServices when the flag is ON", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });
    renderSettings("/settings?section=externalServices");

    expect(screen.getByTestId("dawarich-connection-card")).toBeTruthy();
    expect(screen.getByTestId("immich-connection-card")).toBeTruthy();
  });
});

/**
 * Found during the merge review, 2026-08-30: `RoutingProviderSection` is the
 * Dawarich card's sibling and kept the very defect the block above records.
 * It configures a road router for TOUR legs and has no other consumer, so on a
 * production instance (beta OFF) an admin saw a routing card for a feature
 * hidden everywhere else. Gating it needed no test to change, which is how it
 * survived a whole phase — hence this one.
 * `ImmichConnectionCard` is again the control: no gate, always rendered.
 */
describe("SettingsPage — beta gate: the routing provider card", () => {
  beforeEach(() => {
    useSettingsStore.setState({ betaFeaturesEnabled: null, enabledDomains: ["flight"] });
  });

  it("does not render the routing provider card when the flag is OFF", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    renderSettings("/settings?section=externalServices");

    expect(screen.queryByTestId("routing-provider-section")).toBeNull();
    expect(screen.getByTestId("immich-connection-card")).toBeTruthy();
  });

  it("renders the routing provider card when the flag is ON", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });
    renderSettings("/settings?section=externalServices");

    expect(screen.getByTestId("routing-provider-section")).toBeTruthy();
    expect(screen.getByTestId("immich-connection-card")).toBeTruthy();
  });
});
