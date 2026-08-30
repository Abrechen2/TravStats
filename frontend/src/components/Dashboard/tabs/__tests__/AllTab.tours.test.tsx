import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Tour sections on the dashboard-wide "Alle" map (task 2 of the tour
 * dashboard map feature): the line layer is fed through MapContainer3D's
 * `extraLayers` prop, and the legend/status banner must keep loading,
 * empty and error visibly distinct — a legend that goes quiet after a
 * failed request reads exactly like "you have no tours", the shipped
 * defect this feature's own briefs already name.
 */
const { mapProps } = vi.hoisted(() => ({ mapProps: [] as Record<string, unknown>[] }));

vi.mock("../../../MapContainer3D", () => ({
  default: (props: Record<string, unknown>) => {
    mapProps.push(props);
    return <div data-testid="map" />;
  },
}));

const mockUseDashboardTours = vi.hoisted(() => vi.fn());
vi.mock("../../../../hooks/useDashboardTours", () => ({
  useDashboardTours: (...args: unknown[]) => mockUseDashboardTours(...args),
}));

const mockUseBetaFeatures = vi.hoisted(() => vi.fn());
// `usePlacesVisible` (unmocked here) now resolves through
// `useBetaFeatureAccess`, not `useBetaFeatures` directly (main's
// refactor, merged 2026-08-30). Mirrors the real function's own logic
// (hooks/useBetaFeatures.ts) exactly, off the SAME mock state, so it can
// never drift from what `betaOn`/`betaOff` below configure.
vi.mock("../../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => mockUseBetaFeatures(),
  useBetaFeatureAccess: (key: string) => {
    const { betaFeaturesEnabled, isFeatureVisible } = mockUseBetaFeatures();
    if (betaFeaturesEnabled === null) return "pending";
    return isFeatureVisible(key) ? "allowed" : "denied";
  },
}));

const mockUseDashboardRoute = vi.hoisted(() => vi.fn());
vi.mock("../../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => mockUseDashboardRoute(),
}));

vi.mock("../../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: ["flight", "cruise", "lodging"],
    isEnabled: () => true,
  }),
}));

vi.mock("../../../../hooks/useFlightLookup", () => ({
  useFlightLookup: () => ({ lookup: () => null, lookupMany: () => [] }),
}));

vi.mock("../../../../lib/api/flights", () => ({
  flightsApi: { getAllGeoJSON: vi.fn().mockResolvedValue({ features: [] }) },
}));
vi.mock("../../../../lib/api/cruise", () => ({
  cruiseApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../../../lib/api/lodging", () => ({
  listLodgings: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn().mockResolvedValue([]) },
}));

// Imported after the mocks above so the module graph picks them up.
import { AllTab } from "../AllTab";
import { TOUR_PATH_GLOBE_ALTITUDE_M } from "../tourMapOverlay";

const TOUR_A = {
  id: "tour-a",
  tripId: "trip-1",
  tripName: "Norway Road Trip",
  name: "Fjord loop",
  mode: "road",
  distanceKm: 420,
  stopCount: 4,
  startDate: "2026-06-01T00:00:00.000Z",
  endDate: "2026-06-05T00:00:00.000Z",
};

const GEOMETRY = {
  routeId: "tour-a",
  name: "Fjord loop",
  geometry: {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [8.0, 58.15],
            [8.1, 58.3],
          ],
        },
        properties: {
          legId: "leg-1",
          source: "straight" as const,
          mode: "road" as const,
          confidence: "low",
          distanceKm: 12,
        },
      },
    ],
  },
};

const READY_NO_TOURS = {
  tours: [],
  toursLoading: false,
  toursLoadError: false,
  geometries: [],
  reload: vi.fn(),
};

function betaOn(): { betaFeaturesEnabled: boolean; isFeatureVisible: (key: string) => boolean } {
  return { betaFeaturesEnabled: true, isFeatureVisible: (key: string) => key === "tourRoutes" };
}

function betaOff(): { betaFeaturesEnabled: boolean; isFeatureVisible: () => boolean } {
  return { betaFeaturesEnabled: true, isFeatureVisible: () => false };
}

beforeEach(() => {
  mapProps.length = 0;
  mockUseDashboardTours.mockReset();
  mockUseBetaFeatures.mockReset();
  mockUseDashboardRoute.mockReset();
  mockUseDashboardRoute.mockReturnValue({
    tab: "all",
    mode: "overview",
    setTab: () => {},
    setMode: () => {},
  });
  mockUseBetaFeatures.mockReturnValue(betaOn());
  mockUseDashboardTours.mockReturnValue(READY_NO_TOURS);
});

describe("AllTab: tour lines and legend on the dashboard map", () => {
  it("feeds the tour path layer through MapContainer3D's extraLayers prop", async () => {
    mockUseDashboardTours.mockReturnValue({
      ...READY_NO_TOURS,
      tours: [TOUR_A],
      geometries: [GEOMETRY],
    });

    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    await waitFor(() => expect(mapProps.length).toBeGreaterThan(0));
    const lastProps = mapProps[mapProps.length - 1];
    const extraLayers = lastProps.extraLayers as Array<{ id: string }>;
    expect(extraLayers.some((layer) => layer.id === "dashboard-tour-paths")).toBe(true);
  });

  it("shows the mode legend once tours have loaded", async () => {
    mockUseDashboardTours.mockReturnValue({
      ...READY_NO_TOURS,
      tours: [TOUR_A],
      geometries: [GEOMETRY],
    });

    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("trips:tours.mode.road")).toBeInTheDocument();
    });
    // Neither transient state is shown once the data has actually arrived.
    expect(screen.queryByText("dashboard:tours.loading")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard:tours.loadError")).not.toBeInTheDocument();
  });

  it("shows a loading banner, distinct from the empty and error states", () => {
    mockUseDashboardTours.mockReturnValue({
      ...READY_NO_TOURS,
      toursLoading: true,
    });

    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    expect(screen.getByText("dashboard:tours.loading")).toBeInTheDocument();
    expect(screen.queryByText("dashboard:tours.loadError")).not.toBeInTheDocument();
    expect(screen.queryByText("trips:tours.mode.road")).not.toBeInTheDocument();
  });

  // The case that matters most: a failed request must render something a
  // user can tell apart from "I have no tours" — never a silent zero.
  it("shows an error banner with retry, distinct from the empty state", () => {
    const reload = vi.fn();
    mockUseDashboardTours.mockReturnValue({
      ...READY_NO_TOURS,
      toursLoadError: true,
      reload,
    });

    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    expect(screen.getByText("dashboard:tours.loadError")).toBeInTheDocument();
    expect(screen.queryByText("dashboard:tours.loading")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("dashboard:tours.retry"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("renders no loading/error banner and no mode legend for a genuinely empty, successful load", () => {
    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    expect(screen.queryByText("dashboard:tours.loading")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard:tours.loadError")).not.toBeInTheDocument();
    expect(screen.queryByText("trips:tours.mode.road")).not.toBeInTheDocument();
  });

  it("never fetches or renders tour UI while the tourRoutes beta gate is off", () => {
    mockUseBetaFeatures.mockReturnValue(betaOff());
    mockUseDashboardTours.mockReturnValue({
      ...READY_NO_TOURS,
      tours: [TOUR_A],
      geometries: [GEOMETRY],
    });

    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    // The hook is still called (rules of hooks), but with enabled=false —
    // it must refuse to fetch on its own end; here we assert AllTab asked
    // for it to be off.
    expect(mockUseDashboardTours).toHaveBeenCalledWith(false);
    expect(screen.queryByText("trips:tours.mode.road")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard:tours.loading")).not.toBeInTheDocument();
  });

  it("does not draw tour lines or legend in journey mode", async () => {
    mockUseDashboardRoute.mockReturnValue({
      tab: "all",
      mode: "journey",
      setTab: () => {},
      setMode: () => {},
    });
    mockUseDashboardTours.mockReturnValue({
      ...READY_NO_TOURS,
      tours: [TOUR_A],
      geometries: [GEOMETRY],
    });

    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    await waitFor(() => expect(mapProps.length).toBeGreaterThan(0));
    const lastProps = mapProps[mapProps.length - 1];
    const extraLayers = lastProps.extraLayers as Array<{ id: string }>;
    expect(extraLayers.some((layer) => layer.id === "dashboard-tour-paths")).toBe(false);
    expect(screen.queryByText("trips:tours.mode.road")).not.toBeInTheDocument();
  });

  // Fix round 2 (2026-08-30, browser verification): globe mode drew
  // nothing at all on a real globe -- an unlifted 2-D path z-fights with
  // the sphere mesh and loses the depth test (see
  // `tourMapOverlay.altitude.test.ts` for the pure-function proof of the
  // mechanism). This is the wiring half for the "Alle" map specifically:
  // does AllTab ask for the lift on its own globe mode too.
  it("lifts the tour path altitude in globe mode but not in overview mode", async () => {
    mockUseDashboardTours.mockReturnValue({
      ...READY_NO_TOURS,
      tours: [TOUR_A],
      geometries: [GEOMETRY],
    });

    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );
    await waitFor(() => expect(mapProps.length).toBeGreaterThan(0));
    const flatLayers = mapProps[mapProps.length - 1].extraLayers as Array<{
      props: { getPath: (d: unknown) => unknown };
    }>;
    const flatPath = flatLayers[0].props.getPath({
      path: GEOMETRY.geometry.features[0].geometry.coordinates,
    });
    expect(flatPath).toEqual(GEOMETRY.geometry.features[0].geometry.coordinates);

    mapProps.length = 0;
    mockUseDashboardRoute.mockReturnValue({
      tab: "all",
      mode: "globe",
      setTab: () => {},
      setMode: () => {},
    });
    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );
    await waitFor(() => expect(mapProps.length).toBeGreaterThan(0));
    const globeLayers = mapProps[mapProps.length - 1].extraLayers as Array<{
      props: { getPath: (d: unknown) => Array<[number, number, number]> };
    }>;
    const globePath = globeLayers[0].props.getPath({
      path: GEOMETRY.geometry.features[0].geometry.coordinates,
    });
    for (const point of globePath) {
      expect(point[2]).toBe(TOUR_PATH_GLOBE_ALTITUDE_M);
    }
  });
});
