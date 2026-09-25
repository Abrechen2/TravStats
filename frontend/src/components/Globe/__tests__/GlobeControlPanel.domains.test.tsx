import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DEFAULT_FLIGHT_COLOR_CONFIG } from "../../../lib/flightColor";
import { DEFAULT_CRUISE_COLOR_CONFIG } from "../../../lib/cruiseColor";
import { DEFAULT_LODGING_COLOR_CONFIG } from "../../../lib/lodgingColor";
import { DEFAULT_PLACE_COLOR_CONFIG } from "../../../lib/placeColor";
import { POI_MODES } from "../../../types/dashboard";

/**
 * Measured on main (2026-09-20): the Alle tab passes
 * `appearanceDomains={["flight", "cruise", "lodging", "poi"]}`, the flat
 * map's panel honours all four, and the globe's panel rendered only the
 * first two. So on the globe the marker size, colour mode and label source
 * of a hotel or a place were not merely at their defaults — they were
 * unreachable, while the same map's legend named both domains.
 */

// MapChromeSections reads the router and the dashboard filter store; this
// file is about which appearance sections the panel decides to render.
vi.mock("../../map/MapChromeSections", () => ({
  MapChromeSections: () => null,
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "de", changeLanguage: vi.fn(), isInitialized: true },
    ready: true,
  }),
}));

import { GlobeControlPanel } from "../GlobeControlPanel";

const noop = (): void => {};

function renderPanel(domains: readonly ("flight" | "cruise" | "lodging" | "poi")[]): void {
  // The panel body only exists while expanded; usePanelExpanded defaults to
  // collapsed (#194), so open it before asserting on what it contains.
  window.localStorage.setItem("mapAppearance.v2", JSON.stringify({ panelExpanded: true }));
  render(
    <GlobeControlPanel
      autoRotate={false}
      onAutoRotateChange={noop}
      showNight={false}
      onShowNightChange={noop}
      labelsMode="important"
      onLabelsModeChange={noop}
      showTerrain={false}
      onShowTerrainChange={noop}
      showPlaceLabels
      onShowPlaceLabelsChange={noop}
      styleOptions={[{ id: "dark", label: "Dark" }]}
      styleId="dark"
      onStyleChange={noop}
      liteMode="auto"
      lite={false}
      onLiteModeChange={noop}
      onRecenter={noop}
      legendRanges={[]}
      activeQuartile={null}
      onQuartileChange={noop}
      hasArcs={false}
      antipodalCount={0}
      hasWeakArcs={false}
      appearanceDomains={domains}
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
      lodgingAppearance={{
        markerSize: 1,
        onMarkerSizeChange: noop,
        colorConfig: DEFAULT_LODGING_COLOR_CONFIG,
        onColorModeChange: noop,
        onColorChange: noop,
      }}
      placeAppearance={{
        colorConfig: DEFAULT_PLACE_COLOR_CONFIG,
        onColorModeChange: noop,
        onColorChange: noop,
        markerSize: 1,
        onMarkerSizeChange: noop,
        labelSource: "list",
        onLabelSourceChange: noop,
      }}
    />
  );
}

describe("GlobeControlPanel: every domain the caller names gets its section", () => {
  it("renders the lodging and place sections when appearanceDomains names them", () => {
    renderPanel(["flight", "cruise", "lodging", "poi"]);
    expect(screen.getByText("map:globe.panel.domainFlight")).toBeTruthy();
    expect(screen.getByText("map:globe.panel.domainCruise")).toBeTruthy();
    expect(screen.getByText("map:globe.panel.domainLodging")).toBeTruthy();
    expect(screen.getByText("map:globe.panel.domainPlace")).toBeTruthy();
    // The place section's own control — the map-wide label override, which
    // the globe can actually honour (a DOM pill renders colour emoji). The
    // per-domain sections collapse individually since 2026-09-21 and start
    // closed, so the section has to be opened to see inside it.
    fireEvent.click(screen.getByText("map:globe.panel.domainPlace"));
    expect(screen.getByText("map:globe.panel.placeLabelSource.label")).toBeTruthy();
  });

  it("still shows a single-domain tab only its own section", () => {
    renderPanel(["lodging"]);
    expect(screen.getByText("map:globe.panel.domainLodging")).toBeTruthy();
    expect(screen.queryByText("map:globe.panel.domainFlight")).toBeNull();
    expect(screen.queryByText("map:globe.panel.domainPlace")).toBeNull();
  });
});

describe("POI_MODES", () => {
  it("offers the globe, as every other domain tab does", () => {
    // `globe` is a PROJECTION, not a data view — types/dashboard.ts already
    // says so for lodging, where the same omission was called an oversight
    // rather than a decision. Places were the last tab without it.
    expect(POI_MODES).toContain("globe");
  });
});
