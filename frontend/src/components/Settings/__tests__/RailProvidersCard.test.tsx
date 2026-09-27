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
const testRailRouting = vi.fn();
vi.mock("../../../lib/api", () => ({
  adminApi: {
    getInstanceSettings: (...a: unknown[]) => getInstanceSettings(...a),
    updateInstanceSettings: (...a: unknown[]) => updateInstanceSettings(...a),
    testRailRouting: (...a: unknown[]) => testRailRouting(...a),
  },
}));

import RailProvidersCard from "../RailProvidersCard";

const settings = (over: Record<string, boolean | string | null> = {}) => ({
  settings: { railTransitousEnabled: true, railDbRestEnabled: true, ...over },
  passkeyStatus: { usable: false, reason: null },
});

describe("RailProvidersCard", () => {
  beforeEach(() => {
    offered = true;
    getInstanceSettings.mockReset();
    updateInstanceSettings.mockReset();
    testRailRouting.mockReset();
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
  describe("the OpenRailRouting address", () => {
    const field = () => screen.findByLabelText("settings:railRouting.label");

    it("shows the saved address and saves an edit", async () => {
      getInstanceSettings.mockResolvedValue(settings({ railRoutingUrl: "http://orr.lan:8989" }));
      updateInstanceSettings.mockResolvedValue(settings({ railRoutingUrl: "http://orr2.lan" }));
      render(<RailProvidersCard isAdmin />);
      const input = await field();
      expect(input).toHaveValue("http://orr.lan:8989");
      fireEvent.change(input, { target: { value: " http://orr2.lan/ " } });
      fireEvent.click(screen.getByRole("button", { name: "settings:railRouting.save" }));
      await waitFor(() =>
        expect(updateInstanceSettings).toHaveBeenCalledWith({ railRoutingUrl: "http://orr2.lan/" })
      );
      expect(await screen.findByRole("status")).toHaveTextContent("settings:railRouting.saved");
      expect(input).toHaveValue("http://orr2.lan");
    });

    it("says the address is invalid when the server refuses it, not a raw error", async () => {
      getInstanceSettings.mockResolvedValue(settings());
      updateInstanceSettings.mockRejectedValue(
        Object.assign(new Error("Request failed with status code 400"), {
          isAxiosError: true,
          response: { status: 400, data: { error: "Validation failed" } },
        })
      );
      render(<RailProvidersCard isAdmin />);
      fireEvent.change(await field(), { target: { value: "http://u:p@orr.lan" } });
      fireEvent.click(screen.getByRole("button", { name: "settings:railRouting.save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("settings:railRouting.invalidUrl");
      expect(screen.queryByText(/status code/)).toBeNull();
    });

    it("tests the typed address and names each failure in words", async () => {
      getInstanceSettings.mockResolvedValue(settings());
      testRailRouting.mockResolvedValue({ ok: false, code: "profileMissing" });
      render(<RailProvidersCard isAdmin />);
      fireEvent.change(await field(), { target: { value: "http://typed.lan" } });
      fireEvent.click(screen.getByRole("button", { name: "settings:railRouting.testButton" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "settings:railRouting.test.profileMissing"
      );
      expect(testRailRouting).toHaveBeenCalledWith("http://typed.lan");
    });

    it("says the test itself failed when the request does", async () => {
      getInstanceSettings.mockResolvedValue(settings({ railRoutingUrl: "http://orr.lan" }));
      testRailRouting.mockRejectedValue(new Error("Network Error"));
      render(<RailProvidersCard isAdmin />);
      await field();
      fireEvent.click(screen.getByRole("button", { name: "settings:railRouting.testButton" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "settings:railRouting.test.requestFailed"
      );
    });

    it("reports a working instance with its profile", async () => {
      getInstanceSettings.mockResolvedValue(settings({ railRoutingUrl: "http://orr.lan" }));
      testRailRouting.mockResolvedValue({
        ok: true,
        profile: "all_tracks",
        dataDate: "2026-09-10",
      });
      render(<RailProvidersCard isAdmin />);
      await field();
      fireEvent.click(screen.getByRole("button", { name: "settings:railRouting.testButton" }));
      expect(await screen.findByRole("status")).toHaveTextContent("settings:railRouting.test.ok");
      expect(testRailRouting).toHaveBeenCalledWith("http://orr.lan");
    });
  });
});
