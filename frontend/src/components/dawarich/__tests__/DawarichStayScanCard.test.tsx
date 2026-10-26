import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import DawarichStayScanCard from "../../Settings/DawarichStayScanCard";
import { dawarichStaysApi } from "../../../lib/api/dawarichStays";
import { HiddenRowsContext } from "../../Settings/frame/useExpertRows";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";

vi.mock("../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: {
    state: vi.fn(),
    enable: vi.fn(),
    enableMarkets: vi.fn(),
    enableVenues: vi.fn(),
    scan: vi.fn(),
  },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../lib/profileInstant", () => ({ profileDateTime: (v: string) => v }));
const state = { enabled: true, connected: true, result: "running", error: null };
const mount = () =>
  render(
    <MemoryRouter>
      <DawarichStayScanCard />
    </MemoryRouter>
  );
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  // Still mounted here: the level change re-renders the card.
  act(() => useSettingsLevelStore.setState({ level: null }));
});

describe("Dawarich settings failure recovery", () => {
  it("clears a polling error after the next successful status read", async () => {
    vi.useFakeTimers();
    vi.mocked(dawarichStaysApi.state)
      .mockResolvedValueOnce(state as never)
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue({ ...state, result: "succeeded" } as never);
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(vi.mocked(dawarichStaysApi.state)).toHaveBeenCalledTimes(3);
  });
  it("keeps a failed save visible even when reloading settings succeeds", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({ ...state, result: "succeeded" } as never);
    vi.mocked(dawarichStaysApi.enable).mockRejectedValue(new Error("save failed"));
    mount();
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "trips:dawarichStays.enable" })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "trips:dawarichStays.enable" }));
    await waitFor(() => expect(vi.mocked(dawarichStaysApi.state)).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "trips:dawarichStays.enable" })).toBeChecked();
  });
});

describe("Dawarich optional modules and data freshness", () => {
  it("pauses scanning when Places is hidden but allows consent to be switched off", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({
      ...state,
      result: "succeeded",
      placesEnabled: false,
      pausedReason: "placesDisabled",
    } as never);
    mount();
    expect(await screen.findByText("trips:dawarichStays.placesPaused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "trips:dawarichStays.scan" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "trips:dawarichStays.enable" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "trips:dawarichStays.inbox" })).toHaveAttribute(
      "href",
      "/pending-updates?tab=dawarich"
    );
    expect(dawarichStaysApi.scan).not.toHaveBeenCalled();
  });
  it("does not allow initial opt-in when Places is hidden", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({
      ...state,
      result: null,
      enabled: false,
      placesEnabled: false,
    } as never);
    mount();
    await screen.findByText("trips:dawarichStays.placesPaused");
    expect(screen.getByRole("checkbox", { name: "trips:dawarichStays.enable" })).toBeDisabled();
  });
  it("retains history access without a connection and explains the missing connection", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({
      ...state,
      result: null,
      connected: false,
      pausedReason: "connectionMissing",
    } as never);
    mount();
    expect(await screen.findByText("trips:dawarichStays.ownConnection")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "trips:dawarichStays.scan" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "trips:dawarichStays.enable" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "trips:dawarichStays.inbox" })).toBeInTheDocument();
  });
  it("distinguishes a successful request from fresh location data", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({
      ...state,
      result: "succeeded",
      finishedAt: "2026-10-15T00:00:00Z",
      dataThrough: "2020-01-01T00:00:00Z",
      nextScanAt: "2026-10-15T06:15:00Z",
    } as never);
    mount();
    expect(await screen.findByText("trips:dawarichStays.staleData")).toBeInTheDocument();
    expect(screen.getByText(/trips:dawarichStays.nextScan/)).toHaveTextContent(
      "2026-10-15T06:15:00Z"
    );
  });
  it("explains an empty successful scan", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({
      ...state,
      result: "succeeded",
      finishedAt: "2026-10-15T00:00:00Z",
      dataThrough: null,
    } as never);
    mount();
    expect(await screen.findByText("trips:dawarichStays.noPoints")).toBeInTheDocument();
  });
  it("shows the failure without claiming no points were returned", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({
      ...state,
      result: "failed",
      error: "unreachable",
      finishedAt: "2026-10-15T00:00:00Z",
      dataThrough: null,
    } as never);
    mount();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("trips:dawarichStays.noPoints")).not.toBeInTheDocument();
  });
});

describe("Market discovery consent", () => {
  it("requires separate consent and passes the selected history window", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({
      ...state,
      result: "succeeded",
      marketEnabled: false,
    } as never);
    vi.mocked(dawarichStaysApi.enableMarkets).mockResolvedValue(undefined);
    vi.mocked(dawarichStaysApi.scan).mockResolvedValue(undefined);
    mount();
    const consent = await screen.findByRole("checkbox", {
      name: "trips:dawarichStays.markets.enable",
    });
    expect(consent).not.toBeChecked();
    expect(screen.getByText("trips:dawarichStays.areas.description")).toBeInTheDocument();
    fireEvent.click(consent);
    await waitFor(() => expect(dawarichStaysApi.enableMarkets).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "trips:dawarichStays.scan" }));
    await waitFor(() => expect(dawarichStaysApi.scan).toHaveBeenCalledWith(14));
  });
  it("cannot enable markets without the general scan opt-in", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({
      ...state,
      enabled: false,
      result: null,
    } as never);
    mount();
    expect(
      await screen.findByRole("checkbox", { name: "trips:dawarichStays.markets.enable" })
    ).toBeDisabled();
    expect(dawarichStaysApi.enableMarkets).not.toHaveBeenCalled();
  });
  it("shows incomplete map coverage and missing boundaries", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({
      ...state,
      result: "partial",
      marketResult: {
        status: "partial",
        tiles: 1,
        totalTiles: 2,
        missingAreaCount: 1,
        staleMapData: true,
        createdCount: 0,
        alreadyRecordedCount: 1,
      },
    } as never);
    mount();
    expect(
      await screen.findByText("trips:dawarichStays.markets.status.partial")
    ).toBeInTheDocument();
    expect(screen.getByText("trips:dawarichStays.markets.missing")).toBeInTheDocument();
    expect(screen.getByText("trips:dawarichStays.markets.stale")).toBeInTheDocument();
  });
});

describe("additional whole venues", () => {
  it("requires a separate opt-in even when markets are already enabled", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({
      ...state,
      result: "succeeded",
      marketEnabled: true,
      venueEnabled: false,
    } as never);
    mount();
    const checkbox = await screen.findByRole("checkbox", {
      name: "trips:dawarichStays.venues.enable",
    });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    await waitFor(() => expect(dawarichStaysApi.enableVenues).toHaveBeenCalledWith(true));
    expect(dawarichStaysApi.enableMarkets).not.toHaveBeenCalled();
  });
  it("permits revoking venue consent when Places is hidden", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({
      ...state,
      result: "succeeded",
      placesEnabled: false,
      venueEnabled: true,
    } as never);
    mount();
    const checkbox = await screen.findByRole("checkbox", {
      name: "trips:dawarichStays.venues.enable",
    });
    expect(checkbox).toBeEnabled();
    fireEvent.click(checkbox);
    await waitFor(() => expect(dawarichStaysApi.enableVenues).toHaveBeenCalledWith(false));
  });
  it("keeps a failed consent change visible", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({
      ...state,
      result: "succeeded",
      venueEnabled: false,
    } as never);
    vi.mocked(dawarichStaysApi.enableVenues).mockRejectedValue(new Error("offline"));
    mount();
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "trips:dawarichStays.venues.enable" })
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "trips:dawarichStays.venues.enable" })
    ).not.toBeChecked();
  });
  it("keeps the last broad result labeled correctly after broader consent is disabled", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({
      ...state,
      result: "succeeded",
      venueEnabled: false,
      marketEnabled: true,
      marketResult: {
        scope: "venues",
        status: "partial",
        tiles: 1,
        totalTiles: 2,
        staleMapData: false,
        failedTiles: 1,
        missingAreaCount: 1,
        invalidAreaCount: 0,
        alreadyRecordedCount: 0,
        createdCount: 1,
        limited: false,
      },
    } as never);
    mount();
    expect(
      await screen.findByText("trips:dawarichStays.venues.status.partial")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("trips:dawarichStays.markets.status.partial")
    ).not.toBeInTheDocument();
  });
});

// forgejo#318: places are detected as whole areas by default. At the standard
// level the card says so and offers no knob; the two area switches are expert.
describe("detecting places automatically at each settings level", () => {
  const mountReporting = () => {
    const report = vi.fn();
    render(
      <MemoryRouter>
        <HiddenRowsContext.Provider value={report}>
          <DawarichStayScanCard />
        </HiddenRowsContext.Provider>
      </MemoryRouter>
    );
    return report;
  };
  const areaState = { ...state, result: "succeeded", marketEnabled: true, venueEnabled: true };

  it("names the detection and hides its two switches at the standard level", async () => {
    useSettingsLevelStore.setState({ level: "standard" });
    vi.mocked(dawarichStaysApi.state).mockResolvedValue(areaState as never);
    const report = mountReporting();
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "trips:dawarichStays.enable" })).toBeChecked()
    );
    expect(screen.getByText("trips:dawarichStays.areas.title")).toBeInTheDocument();
    expect(screen.getByText("trips:dawarichStays.areas.description")).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "trips:dawarichStays.markets.enable" })
    ).toBeNull();
    expect(
      screen.queryByRole("checkbox", { name: "trips:dawarichStays.venues.enable" })
    ).toBeNull();
    expect(report.mock.calls[report.mock.calls.length - 1][1]).toBe(2);
  });

  it("shows both switches at the expert level", async () => {
    useSettingsLevelStore.setState({ level: "expert" });
    vi.mocked(dawarichStaysApi.state).mockResolvedValue(areaState as never);
    const report = mountReporting();
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "trips:dawarichStays.markets.enable" })
      ).toBeChecked()
    );
    expect(
      screen.getByRole("checkbox", { name: "trips:dawarichStays.venues.enable" })
    ).toBeChecked();
    expect(screen.getByText("trips:dawarichStays.areas.title")).toBeInTheDocument();
    expect(report.mock.calls[report.mock.calls.length - 1][1]).toBe(0);
  });
});
