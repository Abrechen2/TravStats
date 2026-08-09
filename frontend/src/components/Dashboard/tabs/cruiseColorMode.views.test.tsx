import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AllTab } from "./AllTab";
import { CruisesTab } from "./CruisesTab";
import { useCruiseColorStore } from "../../../store/cruiseColorStore";
import { DEFAULT_CRUISE_COLORS, type CruiseColorConfig } from "../../../lib/cruiseColor";

// Captures every prop set MapContainer3D is rendered with, so we can assert
// what each TAB tells the map — the reported defect was that the tabs
// hardcoded the cruise colour mode and the user had no say.
const { mapProps } = vi.hoisted(() => ({ mapProps: [] as Record<string, unknown>[] }));

vi.mock("../../MapContainer3D", () => ({
  default: (props: Record<string, unknown>) => {
    mapProps.push(props);
    return <div data-testid="map" />;
  },
}));

vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: ["flight", "cruise"],
    isEnabled: () => true,
  }),
}));

vi.mock("../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => ({ tab: "all", mode: "overview", setTab: () => {}, setMode: () => {} }),
}));

vi.mock("../../../hooks/useFlightLookup", () => ({
  useFlightLookup: () => ({ lookup: () => null, lookupMany: () => [] }),
}));

vi.mock("../../../lib/api/flights", () => ({
  flightsApi: { getAllGeoJSON: vi.fn().mockResolvedValue({ features: [] }) },
}));
vi.mock("../../../lib/api/cruise", () => ({
  cruiseApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../../lib/api/lodging", () => ({
  listLodgings: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn().mockResolvedValue([]) },
}));

const setConfig = (config: CruiseColorConfig): void => {
  useCruiseColorStore.setState({ config });
};

/** The `background` style of the legend swatch next to `label`. */
const swatchBackground = (label: string): string | undefined => {
  const row = screen.getByText(label).parentElement;
  const swatch = row?.querySelector("span[aria-hidden]");
  return swatch instanceof HTMLElement ? swatch.style.background : undefined;
};

describe("the cruise colour mode is the USER's, in every view", () => {
  beforeEach(() => {
    mapProps.length = 0;
    setConfig({ mode: "status", colors: DEFAULT_CRUISE_COLORS });
  });

  // DEFECT 1: `cruiseColorMode="status"` was hardcoded here, so the mode the
  // user picked in the panel never reached the map from the Alle view.
  it("AllTab does not force a cruise colour mode on the map", () => {
    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );
    expect(mapProps.length).toBeGreaterThan(0);
    for (const props of mapProps) {
      expect(props.cruiseColorMode).toBeUndefined();
    }
  });

  // DEFECT 1, other half: `cruiseColorMode="perCruise"` was hardcoded here.
  it("CruisesTab does not force a cruise colour mode on the map", () => {
    render(
      <MemoryRouter>
        <CruisesTab />
      </MemoryRouter>
    );
    expect(mapProps.length).toBeGreaterThan(0);
    for (const props of mapProps) {
      expect(props.cruiseColorMode).toBeUndefined();
    }
  });
});

// DEFECT 3: the legend hardcoded rgb(74,144,217) / rgb(34,211,238) as string
// literals, so it kept claiming blue/cyan no matter what the map did.
describe("the AllTab legend reads the same state as the cruise routes", () => {
  beforeEach(() => {
    mapProps.length = 0;
  });

  const renderAll = (): void => {
    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );
  };

  it("status mode: both rows show the user's colours, not the old hardcoded pair", () => {
    setConfig({
      mode: "status",
      colors: { past: [10, 200, 30], planned: [200, 20, 180], solid: [1, 1, 1] },
    });
    renderAll();
    expect(swatchBackground("dashboard:legend.cruisePast")).toBe("rgb(10, 200, 30)");
    expect(swatchBackground("dashboard:legend.cruisePlanned")).toBe("rgb(200, 20, 180)");
  });

  it("solid mode: exactly ONE cruise row, in the user's colour", () => {
    setConfig({
      mode: "solid",
      colors: { ...DEFAULT_CRUISE_COLORS, solid: [60, 120, 240] },
    });
    renderAll();
    expect(screen.queryByText("dashboard:legend.cruisePast")).toBeNull();
    expect(screen.queryByText("dashboard:legend.cruisePlanned")).toBeNull();
    expect(swatchBackground("dashboard:legend.cruiseSolid")).toBe("rgb(60, 120, 240)");
  });

  it("perCruise mode: one honest 'a colour per cruise' row, not one row per cruise", () => {
    setConfig({ mode: "perCruise", colors: DEFAULT_CRUISE_COLORS });
    renderAll();
    expect(screen.queryByText("dashboard:legend.cruisePast")).toBeNull();
    expect(screen.getByText("dashboard:legend.cruisePerCruise")).toBeTruthy();
    // A multi-hue swatch — a gradient, not one flat colour.
    expect(swatchBackground("dashboard:legend.cruisePerCruise")).toContain("gradient");
  });
});
