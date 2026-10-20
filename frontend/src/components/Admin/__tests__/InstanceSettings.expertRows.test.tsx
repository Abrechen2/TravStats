import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { getInstanceSettings, updateInstanceSettings } = vi.hoisted(() => ({
  getInstanceSettings: vi.fn(),
  updateInstanceSettings: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  adminApi: { getInstanceSettings, updateInstanceSettings },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

vi.mock("../../../lib/api/loginBackgrounds", () => ({
  getLoginBackgrounds: () => Promise.resolve([]),
  loginBackgroundUrl: (name: string) => `/api/v1/login-backgrounds/${name}`,
  uploadLoginBackgrounds: vi.fn(),
  deleteLoginBackground: vi.fn(),
}));

vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import InstanceSettings from "../InstanceSettings";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";
import { HiddenRowsContext } from "../../Settings/frame/useExpertRows";

const settings = {
  instanceName: "TravStats",
  maxUsers: 10,
  allowRegistration: false,
  frontendUrl: "https://front.example",
  publicUrl: "https://public.example",
  lanUrl: "http://192.168.1.10:3010",
  webauthnRpId: "travstats.example",
  webauthnOrigins: ["https://travstats.example"],
  betaFeaturesEnabled: true,
  countryThreshold: "visited",
};

function renderWithSpy() {
  const spy = vi.fn();
  render(
    <HiddenRowsContext.Provider value={spy}>
      <InstanceSettings />
    </HiddenRowsContext.Provider>
  );
  return spy;
}

/**
 * forgejo#321: the standard level keeps what a first setup needs (name, the
 * two public addresses, user limit, registration) and leaves the LAN address,
 * the passkey binding and the beta switch to the expert view.
 */
describe("InstanceSettings — standard and expert rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getInstanceSettings.mockResolvedValue({ settings, passkeyStatus: null });
    updateInstanceSettings.mockImplementation(async (patch: Record<string, unknown>) => ({
      settings: { ...settings, ...patch },
      passkeyStatus: null,
    }));
  });

  afterEach(() => {
    // Unmount first: resetting the level under a mounted page re-renders it
    // outside act().
    cleanup();
    act(() => useSettingsLevelStore.setState({ level: null }));
  });

  it("hides the LAN address, the passkey fields and the beta switch at the standard level", async () => {
    useSettingsLevelStore.setState({ level: "standard" });
    const spy = renderWithSpy();

    await screen.findByText("admin:instance.fields.publicUrl.label");
    expect(screen.queryByText("admin:instance.fields.lanUrl.label")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("admin:instance.passkeys.rpId.label")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("admin:instance.passkeys.origins.label")
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/betaFeatures/)).not.toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(expect.any(String), 4);
  });

  it("draws every row and hides nothing at the expert level", async () => {
    useSettingsLevelStore.setState({ level: "expert" });
    const spy = renderWithSpy();

    await screen.findByText("admin:instance.fields.lanUrl.label");
    expect(screen.getByLabelText("admin:instance.passkeys.rpId.label")).toBeInTheDocument();
    expect(screen.getByLabelText("admin:instance.passkeys.origins.label")).toBeInTheDocument();
    expect(screen.getByLabelText(/betaFeatures/)).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(expect.any(String), 0);
    expect(spy).not.toHaveBeenCalledWith(expect.any(String), 4);
  });

  it("sends the hidden settings back unchanged when saved at the standard level", async () => {
    useSettingsLevelStore.setState({ level: "standard" });
    const user = userEvent.setup();
    renderWithSpy();

    await user.click(await screen.findByRole("button", { name: /save/i }));

    await waitFor(() => expect(updateInstanceSettings).toHaveBeenCalled());
    expect(updateInstanceSettings.mock.calls[0][0]).toMatchObject({
      lanUrl: settings.lanUrl,
      webauthnRpId: settings.webauthnRpId,
      webauthnOrigins: settings.webauthnOrigins,
      betaFeaturesEnabled: true,
    });
  });
});
