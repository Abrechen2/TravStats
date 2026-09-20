import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The "Reise" view forced `visMode="routes"`, so it was the one dashboard view
 * that could never be a globe — including for a reader who had the globe
 * everywhere else. The owner's 2026-09-20 ruling ("Globus soll ueberall
 * genutzt werden") does not exempt it.
 *
 * "Reise" is a VIEW of one trip rather than a projection, so it cannot decide
 * globe-vs-flat by being selected. It reads the reader's last projection
 * choice instead — which is why `useDashboardRoute` reports one.
 *
 * Deliberate-break protocol: hardcode `visMode="routes"` in AllTab's journey
 * branch again — this test fails.
 */

const { mapProps, routeState } = vi.hoisted(() => ({
  mapProps: [] as Record<string, unknown>[],
  routeState: { projection: "globe" as "globe" | "flat" },
}));

vi.mock("../../../MapContainer3D", () => ({
  default: (props: Record<string, unknown>) => {
    mapProps.push(props);
    return <div data-testid="map" />;
  },
}));

vi.mock("../../../../hooks/useDashboardTours", () => ({
  useDashboardTours: () => ({
    tours: [],
    toursLoading: false,
    toursLoadError: null,
    geometries: [],
    reload: () => {},
  }),
}));

vi.mock("../../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => ({
    tab: "all",
    mode: "journey",
    projection: routeState.projection,
    setTab: () => {},
    setMode: () => {},
  }),
}));

vi.mock("../../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: ["flight", "cruise", "lodging", "poi"],
    isEnabled: () => true,
  }),
}));
vi.mock("../../../../hooks/usePlacesVisible", () => ({ usePlacesVisible: () => true }));
vi.mock("../../../../hooks/useFlightLookup", () => ({
  useFlightLookup: () => ({ lookup: () => null, lookupMany: () => [] }),
}));
vi.mock("../../../../lib/api/places", () => ({ listPlaces: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../../lib/api/placeLists", () => ({
  listPlaceLists: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../../lib/api/lodging", () => ({ listLodgings: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../../lib/api/flights", () => ({
  flightsApi: { getAllGeoJSON: vi.fn().mockResolvedValue({ features: [] }) },
}));
vi.mock("../../../../lib/api/cruise", () => ({
  cruiseApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn().mockResolvedValue([]) },
}));

import { AllTab } from "../AllTab";

async function renderJourney(): Promise<Record<string, unknown>> {
  render(
    <MemoryRouter>
      <AllTab />
    </MemoryRouter>
  );
  await waitFor(() => expect(mapProps.length).toBeGreaterThan(0));
  return mapProps[mapProps.length - 1];
}

beforeEach(() => {
  mapProps.length = 0;
  window.localStorage.clear();
});

describe("the journey view follows the reader's projection", () => {
  it("draws the journey on the globe when that is the stored choice", async () => {
    routeState.projection = "globe";
    const props = await renderJourney();
    expect(props.visMode).toBe("globe");
    // The trip's own layers still have to reach whichever engine draws it.
    expect(Array.isArray(props.extraLayers)).toBe(true);
  });

  it("stays flat when the reader last chose a flat mode", async () => {
    routeState.projection = "flat";
    const props = await renderJourney();
    expect(props.visMode).toBe("routes");
  });
});
