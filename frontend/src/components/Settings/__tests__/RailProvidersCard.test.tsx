import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    // Interpolated values are appended, so a test can see what was filled in.
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${Object.values(o).join(" ")}` : k),
    i18n: { language: "de" },
    ready: true,
  }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
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
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";
import { HiddenRowsContext } from "../frame/useExpertRows";

const settings = (over: Record<string, boolean | string | null> = {}) => ({
  settings: { railTransitousEnabled: true, railDbRestEnabled: true, ...over },
  passkeyStatus: { usable: false, reason: null },
});

describe("RailProvidersCard", () => {
  beforeEach(() => {
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

  it("is not there for a non-admin", () => {
    const { container } = render(<RailProvidersCard isAdmin={false} />);
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

    it("says the map date is unknown when the instance names none", async () => {
      getInstanceSettings.mockResolvedValue(settings({ railRoutingUrl: "http://orr.lan" }));
      testRailRouting.mockResolvedValue({ ok: true, profile: "all_tracks", dataDate: null });
      render(<RailProvidersCard isAdmin />);
      await field();
      fireEvent.click(screen.getByRole("button", { name: "settings:railRouting.testButton" }));
      expect(await screen.findByRole("status")).toHaveTextContent(
        "settings:railRouting.test.dateUnknown"
      );
    });

    it("says which tram / U-Bahn profile is missing and what that means", async () => {
      getInstanceSettings.mockResolvedValue(settings({ railRoutingUrl: "http://orr.lan" }));
      testRailRouting.mockResolvedValue({
        ok: true,
        profile: "all_tracks",
        dataDate: "2026-10-09",
        modeProfiles: { tram: false, subway: true },
      });
      render(<RailProvidersCard isAdmin />);
      await field();
      fireEvent.click(screen.getByRole("button", { name: "settings:railRouting.testButton" }));
      expect(await screen.findByTestId("rail-routing-mode-profiles")).toHaveTextContent(
        "settings:railRouting.test.modeProfiles.missing"
      );
    });

    it("offers the tram / U-Bahn repair only once an address is saved", async () => {
      getInstanceSettings.mockResolvedValue(settings({ railRoutingUrl: "http://orr.lan" }));
      render(<RailProvidersCard isAdmin />);
      await field();
      expect(
        screen.getByRole("button", { name: "settings:railRouting.reroute.action" })
      ).toBeTruthy();
      cleanup();
      getInstanceSettings.mockResolvedValue(settings());
      render(<RailProvidersCard isAdmin />);
      await field();
      expect(
        screen.queryByRole("button", { name: "settings:railRouting.reroute.action" })
      ).toBeNull();
    });
  });

  // forgejo#321: the provider switches are the standard decision; the routing
  // engine's address is plumbing and waits for the expert view.
  describe("at the standard level", () => {
    afterEach(() => {
      cleanup();
      act(() => useSettingsLevelStore.setState({ level: null }));
    });

    it("keeps the provider switches, hides the routing address and counts it", async () => {
      useSettingsLevelStore.setState({ level: "standard" });
      getInstanceSettings.mockResolvedValue(settings({ railRoutingUrl: "http://orr.lan" }));
      const spy = vi.fn();
      render(
        <HiddenRowsContext.Provider value={spy}>
          <RailProvidersCard isAdmin />
        </HiddenRowsContext.Provider>
      );

      expect(
        await screen.findByRole("switch", { name: "settings:railProviders.transitous" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("switch", { name: "settings:railProviders.dbRest" })
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("settings:railRouting.label")).toBeNull();
      expect(spy).toHaveBeenCalledWith(expect.any(String), 1);
    });
  });
});
