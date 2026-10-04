import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OverlayAppearanceSections } from "./OverlayAppearanceSections";
import { FlatMapControlPanel } from "./FlatMapControlPanel";
import type { AppearanceDomain } from "./controlPanelKit";
import { useOverlayAppearanceStore } from "../../store/overlayAppearanceStore";
import { DEFAULT_OVERLAY_APPEARANCE } from "../../lib/overlayAppearance";
import { DEFAULT_FLIGHT_COLOR_CONFIG } from "../../lib/flightColor";
import { DEFAULT_CRUISE_COLOR_CONFIG } from "../../lib/cruiseColor";

/**
 * forgejo#198: the map panel had sections for flights, cruises, lodging and
 * places, and none for tours, roadtrips, rail and rentals. These cases pin
 * which section appears for which `appearanceDomains`, that a beta domain
 * stays out of the panel while its switch is closed, and that a control
 * writes the value the layers read.
 */

const gates = vi.hoisted(() => ({ tours: true, rail: true, rental: true, roadtrip: true }));
vi.mock("../../hooks/useToursVisible", () => ({ useToursVisible: () => gates.tours }));
vi.mock("../../hooks/useRailVisible", () => ({ useRailVisible: () => gates.rail }));
vi.mock("../../hooks/useRentalVisible", () => ({ useRentalVisible: () => gates.rental }));
vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: [],
    isEnabled: (key: string) => key === "roadtrip" && gates.roadtrip,
  }),
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "de", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));
// Reads the router and the dashboard filter store; irrelevant here.
vi.mock("./MapChromeSections", () => ({ MapChromeSections: () => null }));

const KEY = "mapAppearance.v2";
const OPEN = { tour: true, roadtrip: true, rail: true, rental: true };

function renderSections(domains: readonly AppearanceDomain[]): void {
  render(<OverlayAppearanceSections appearanceDomains={domains} />);
}

beforeEach(() => {
  Object.assign(gates, { tours: true, rail: true, rental: true, roadtrip: true });
  // Sections start collapsed; open them through the persisted state.
  window.localStorage.setItem(KEY, JSON.stringify({ panelSections: OPEN, panelExpanded: true }));
  useOverlayAppearanceStore.setState({ appearance: DEFAULT_OVERLAY_APPEARANCE });
});

describe("OverlayAppearanceSections: one section per named overlay domain", () => {
  it("renders nothing for a map that names only the map-drawn domains", () => {
    const { container } = render(
      <OverlayAppearanceSections appearanceDomains={["flight", "cruise", "lodging", "poi"]} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders all four for the overview map's list", () => {
    renderSections(["flight", "tour", "roadtrip", "rail", "rental"]);
    expect(screen.getByText("map:globe.panel.domainTour")).toBeTruthy();
    expect(screen.getByText("map:globe.panel.domainRoadtrip")).toBeTruthy();
    expect(screen.getByText("map:globe.panel.domainRail")).toBeTruthy();
    expect(screen.getByText("map:globe.panel.domainRental")).toBeTruthy();
  });

  it("shows a single-domain tab only its own section", () => {
    renderSections(["rail"]);
    expect(screen.getByText("map:globe.panel.domainRail")).toBeTruthy();
    expect(screen.queryByText("map:globe.panel.domainRental")).toBeNull();
    expect(screen.queryByText("map:globe.panel.domainTour")).toBeNull();
  });

  it("keeps a beta domain out of the panel while it is hidden, even when named", () => {
    gates.rail = false;
    gates.rental = false;
    gates.tours = false;
    gates.roadtrip = false;
    const { container } = render(
      <OverlayAppearanceSections appearanceDomains={["tour", "roadtrip", "rail", "rental"]} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("offers the roadtrip station slider only where the stations are drawn", () => {
    const { unmount } = render(<OverlayAppearanceSections appearanceDomains={["roadtrip"]} />);
    expect(screen.queryByLabelText("map:globe.panel.stations")).toBeNull();
    unmount();
    renderSections(["roadtrip", "roadtripStations"]);
    expect(screen.getByLabelText("map:globe.panel.stations")).toBeTruthy();
  });
});

describe("OverlayAppearanceSections: the controls write what the layers read", () => {
  it("moves the rail width into the store and the persisted blob", () => {
    renderSections(["rail"]);
    fireEvent.change(screen.getByLabelText("map:globe.panel.width"), { target: { value: "1.7" } });
    expect(useOverlayAppearanceStore.getState().appearance.railLineWidth).toBe(1.7);
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "{}").railLineWidth).toBe(1.7);
  });

  it("switches the rental link off, and hides the width of a line no longer drawn", () => {
    renderSections(["rental"]);
    expect(screen.getByLabelText("map:globe.panel.width")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /map:globe.panel.rentalShowLine/ }));
    expect(useOverlayAppearanceStore.getState().appearance.rentalShowLine).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "{}").rentalShowLine).toBe(false);
    expect(screen.queryByLabelText("map:globe.panel.width")).toBeNull();
    // The station markers stay controllable — they are what is left on the map.
    expect(screen.getByLabelText("map:globe.panel.rentalStations")).toBeTruthy();
  });
});

describe("FlatMapControlPanel renders the overlay sections it is asked for", () => {
  const noop = (): void => {};
  it("shows the rail section for the rail tab's domains", () => {
    render(
      <FlatMapControlPanel
        showPlaceLabels
        onShowPlaceLabelsChange={noop}
        showTerrain={false}
        onShowTerrainChange={noop}
        labelsMode="important"
        onLabelsModeChange={noop}
        styleOptions={[{ id: "dark", label: "Dark" }]}
        styleId="dark"
        onStyleChange={noop}
        appearanceDomains={["rail"]}
        flightAppearance={{
          colorConfig: DEFAULT_FLIGHT_COLOR_CONFIG,
          onColorModeChange: noop,
          onColorChange: noop,
          routeWidth: 1,
          onRouteWidthChange: noop,
          markerColor: null,
          onMarkerColorChange: noop,
          markerSize: 1,
          onMarkerSizeChange: noop,
        }}
        cruiseAppearance={{
          colorConfig: DEFAULT_CRUISE_COLOR_CONFIG,
          onColorModeChange: noop,
          onColorChange: noop,
          routeWidth: 1,
          onRouteWidthChange: noop,
          markerColor: null,
          onMarkerColorChange: noop,
          markerSize: 1,
          onMarkerSizeChange: noop,
        }}
        lodgingAppearance={{ markerSize: 1, onMarkerSizeChange: noop }}
        placeAppearance={{}}
      />
    );
    expect(screen.getByText("map:globe.panel.domainRail")).toBeTruthy();
    expect(screen.queryByText("map:globe.panel.domainFlight")).toBeNull();
  });
});
