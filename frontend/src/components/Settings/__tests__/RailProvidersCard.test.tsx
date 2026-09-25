import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
let offered = true;
vi.mock("../../../hooks/useRailVisible", () => ({ useRailOffered: () => offered }));
const getInstanceSettings = vi.fn();
const updateInstanceSettings = vi.fn();
vi.mock("../../../lib/api", () => ({
  adminApi: {
    getInstanceSettings: (...a: unknown[]) => getInstanceSettings(...a),
    updateInstanceSettings: (...a: unknown[]) => updateInstanceSettings(...a),
  },
}));

import RailProvidersCard from "../RailProvidersCard";

const settings = (over: Record<string, boolean> = {}) => ({
  settings: { railTransitousEnabled: true, railDbRestEnabled: true, ...over },
  passkeyStatus: { usable: false, reason: null },
});

describe("RailProvidersCard", () => {
  beforeEach(() => {
    offered = true;
    getInstanceSettings.mockReset();
    updateInstanceSettings.mockReset();
  });

  it("shows the saved switches and writes one when an admin flips it", async () => {
    getInstanceSettings.mockResolvedValue(settings({ railDbRestEnabled: false }));
    updateInstanceSettings.mockResolvedValue(
      settings({ railTransitousEnabled: false, railDbRestEnabled: false })
    );
    render(<RailProvidersCard isAdmin />);

    const transitous = await screen.findByRole("switch", {
      name: "settings:railProviders.transitous",
    });
    expect(transitous).toBeChecked();
    expect(screen.getByRole("switch", { name: "settings:railProviders.dbRest" })).not.toBeChecked();

    fireEvent.click(transitous);
    await waitFor(() =>
      expect(updateInstanceSettings).toHaveBeenCalledWith({ railTransitousEnabled: false })
    );
    await waitFor(() => expect(transitous).not.toBeChecked());
  });

  it("shows no switch in a guessed position when the settings cannot be read", async () => {
    getInstanceSettings.mockRejectedValue(new Error("403"));
    render(<RailProvidersCard isAdmin />);
    expect(await screen.findByRole("alert")).toHaveTextContent("settings:railProviders.loadError");
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("is not there for a non-admin, nor where rail is not offered", () => {
    const { container, rerender } = render(<RailProvidersCard isAdmin={false} />);
    expect(container).toBeEmptyDOMElement();
    offered = false;
    rerender(<RailProvidersCard isAdmin />);
    expect(container).toBeEmptyDOMElement();
    expect(getInstanceSettings).not.toHaveBeenCalled();
  });
});
