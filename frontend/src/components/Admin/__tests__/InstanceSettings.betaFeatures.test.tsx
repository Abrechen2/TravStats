import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { getInstanceSettings, updateInstanceSettings } = vi.hoisted(() => ({
  getInstanceSettings: vi.fn(),
  updateInstanceSettings: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  adminApi: { getInstanceSettings, updateInstanceSettings },
}));

// The wrapper returns the key itself, so assertions read as i18n keys.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: typeof addToast }) => unknown) =>
    selector({ addToast }),
}));

vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import InstanceSettings from "../InstanceSettings";

/**
 * `betaFeaturesEnabled` was accepted by PATCH /admin/instance-settings and read
 * app-wide through useBetaFeatures, but nothing rendered a control for it — the
 * only way to flip it was an API call by hand, which is why the RC UAT recipe
 * had to re-set it after every prod clone. CLAUDE.md describes it as a flag "an
 * admin flips"; until now that was not true.
 */
const settings = {
  instanceName: "TravStats",
  maxUsers: 10,
  allowRegistration: false,
  frontendUrl: null,
  publicUrl: null,
  lanUrl: null,
  webauthnRpId: null,
  webauthnOrigins: [],
  betaFeaturesEnabled: false,
};

describe("InstanceSettings — beta features toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getInstanceSettings.mockResolvedValue({ settings, passkeyStatus: null });
    updateInstanceSettings.mockImplementation(
      async (patch: Record<string, unknown>) => ({
        settings: { ...settings, ...patch },
        passkeyStatus: null,
      }),
    );
  });

  it("renders a control for the flag", async () => {
    render(<InstanceSettings />);

    const toggle = await screen.findByLabelText(/betaFeatures/i);
    expect(toggle).toBeInTheDocument();
  });

  it("reflects the stored value rather than defaulting to off", async () => {
    getInstanceSettings.mockResolvedValue({
      settings: { ...settings, betaFeaturesEnabled: true },
      passkeyStatus: null,
    });

    render(<InstanceSettings />);

    await waitFor(() =>
      expect(screen.getByLabelText(/betaFeatures/i)).toBeChecked(),
    );
  });

  it("sends the flag when saved", async () => {
    const user = userEvent.setup();
    render(<InstanceSettings />);

    await user.click(await screen.findByLabelText(/betaFeatures/i));
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(updateInstanceSettings).toHaveBeenCalled());
    expect(updateInstanceSettings.mock.calls[0][0]).toMatchObject({
      betaFeaturesEnabled: true,
    });
  });
});
