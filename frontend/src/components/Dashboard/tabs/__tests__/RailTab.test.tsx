import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { makeRailJourney } from "../../../rail/__tests__/railJourneyFixture";
import { useDomainColorStore } from "../../../../store/domainColorStore";

/**
 * The dashboard's rail tab (spec 2026-09-25-rail-domain, phase 2b): the key
 * is painted from the domain colour store like the line, names only the kinds
 * of line that are drawn, and nothing is fetched while rail is hidden.
 */
const list = vi.fn();
vi.mock("../../../../lib/api/rail", () => ({
  railApi: { list: (...a: unknown[]) => list(...a) },
}));
vi.mock("../../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
const extraLayers = vi.hoisted(() => ({ current: [] as unknown[], domains: [] as unknown[] }));
vi.mock("../../../MapContainer3D", () => ({
  default: (props: { extraLayers?: unknown[]; appearanceDomains?: unknown[] }) => {
    extraLayers.current = props.extraLayers ?? [];
    extraLayers.domains = props.appearanceDomains ?? [];
    return <div data-testid="map-stub" />;
  },
}));
vi.mock("../../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => ({ tab: "rail", mode: "globe", setTab: vi.fn(), setMode: vi.fn() }),
}));
const railVisible = vi.hoisted(() => ({ value: true }));
vi.mock("../../../../hooks/useRailVisible", () => ({ useRailVisible: () => railVisible.value }));

import { RailTab } from "../RailTab";
import { useOverlayAppearanceStore } from "../../../../store/overlayAppearanceStore";
import { DEFAULT_OVERLAY_APPEARANCE } from "../../../../lib/overlayAppearance";

function renderTab(): void {
  render(
    <MemoryRouter>
      <RailTab />
    </MemoryRouter>
  );
}

describe("RailTab", () => {
  beforeEach(() => {
    list.mockReset();
    railVisible.value = true;
    useOverlayAppearanceStore.setState({ appearance: DEFAULT_OVERLAY_APPEARANCE });
    useDomainColorStore.setState({
      colors: { ...useDomainColorStore.getState().colors, rail: "#112233" },
    });
  });

  it("keys the traced line in the rail colour from the store, and links each ride", async () => {
    list.mockResolvedValue({ journeys: [makeRailJourney()], total: 1 });
    renderTab();
    const legend = await screen.findByTestId("rail-legend");
    expect(legend).toHaveTextContent("dashboard:legend.railTraced");
    expect(legend).not.toHaveTextContent("dashboard:legend.railStraight");
    const swatch = legend.querySelector("span[aria-hidden]") as HTMLElement;
    expect(swatch.style.background).toBe("rgb(17, 34, 51)");
    expect(screen.getByRole("link", { name: "Frankfurt → Fulda" })).toHaveAttribute(
      "href",
      "/rail/j1"
    );
    expect(extraLayers.current.length).toBe(2);
  });

  // Silent-fix sweep 2026-09-27: a BRouter line (the demo account's routed
  // rides) or an OpenRailRouting line was labelled "(Transitous)" in the
  // legend even though neither is the train's own trace.
  it("names a BRouter-routed line by its own source, not Transitous", async () => {
    list.mockResolvedValue({
      journeys: [makeRailJourney({ geometrySource: "brouter" })],
      total: 1,
    });
    renderTab();
    const legend = await screen.findByTestId("rail-legend");
    expect(legend).toHaveTextContent("dashboard:legend.railBrouter");
    expect(legend).not.toHaveTextContent("dashboard:legend.railTraced");
  });

  it("names an OpenRailRouting line by its own source, not Transitous", async () => {
    list.mockResolvedValue({
      journeys: [makeRailJourney({ geometrySource: "openrailrouting" })],
      total: 1,
    });
    renderTab();
    const legend = await screen.findByTestId("rail-legend");
    expect(legend).toHaveTextContent("dashboard:legend.railRouted");
    expect(legend).not.toHaveTextContent("dashboard:legend.railTraced");
  });

  // forgejo#198: the panel's rail section must exist here AND move the line.
  it("offers the rail panel section and draws with its width and station size", async () => {
    useOverlayAppearanceStore.setState({
      appearance: { ...DEFAULT_OVERLAY_APPEARANCE, railLineWidth: 2, railStationSize: 0 },
    });
    list.mockResolvedValue({ journeys: [makeRailJourney()], total: 1 });
    renderTab();
    await screen.findByTestId("rail-legend");
    expect(extraLayers.domains).toEqual(["rail"]);
    // Station size 0 drops the station layer; the path layer remains.
    const layers = extraLayers.current as Array<{ id: string; props: Record<string, unknown> }>;
    expect(layers.map((l) => l.id)).toEqual(["dashboard-rail-paths"]);
    const getWidth = layers[0].props.getWidth as (d: { traced: boolean }) => number;
    expect(getWidth({ traced: true })).toBe(7);
  });

  it("says a failed load instead of drawing an empty map", async () => {
    list.mockRejectedValue(new Error("network"));
    renderTab();
    expect(await screen.findByRole("alert")).toHaveTextContent("dashboard:railTab.loadError");
  });

  it("asks for nothing while rail is hidden", async () => {
    railVisible.value = false;
    renderTab();
    await waitFor(() => expect(screen.getByTestId("map-stub")).toBeInTheDocument());
    expect(list).not.toHaveBeenCalled();
  });
});
