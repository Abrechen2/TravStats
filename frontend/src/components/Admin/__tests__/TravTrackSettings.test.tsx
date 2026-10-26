import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const beta = vi.hoisted(() => ({ open: true }));
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({
    betaFeaturesEnabled: beta.open,
    isFeatureVisible: (key: string) => beta.open && key === "travTrack",
  }),
}));

const { config, setConfig } = vi.hoisted(() => ({ config: vi.fn(), setConfig: vi.fn() }));
vi.mock("../../../lib/api/travtrack", async (original) => ({
  ...(await original<typeof import("../../../lib/api/travtrack")>()),
  travTrackApi: { config, setConfig, capabilities: vi.fn() },
}));

import TravTrackSettings from "../TravTrackSettings";

/**
 * Admin → Instanz → TravTrack (TravTrack plan, T1): the instance switch,
 * reachable once the beta key is open; a refusal shows its own copy.
 */

beforeEach(() => {
  vi.clearAllMocks();
  beta.open = true;
  config.mockResolvedValue({ enabled: false });
});

describe("TravTrackSettings", () => {
  it("asks for the beta switch first and draws no switch while it is closed", () => {
    beta.open = false;
    render(<TravTrackSettings />);
    expect(screen.getByText("admin:travTrack.needsBeta")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(config).not.toHaveBeenCalled();
  });

  it("switches TravTrack on", async () => {
    setConfig.mockResolvedValue({ enabled: true });
    render(<TravTrackSettings />);
    const toggle = await screen.findByRole("switch");
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(setConfig).toHaveBeenCalledWith({ enabled: true });
    expect(await screen.findByRole("switch")).toBeChecked();
  });

  it("shows TRAVTRACK_DISABLED as its own copy", async () => {
    setConfig.mockRejectedValue({
      isAxiosError: true,
      response: { status: 403, data: { code: "TRAVTRACK_DISABLED", error: "off" } },
    });
    render(<TravTrackSettings />);
    await userEvent.click(await screen.findByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent("admin:travTrack.errors.disabled");
  });
});
