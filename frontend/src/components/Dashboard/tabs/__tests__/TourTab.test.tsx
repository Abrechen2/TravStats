import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The dedicated "Touren" dashboard tab (task 3 of the tour dashboard map
 * feature): the same tour-path map layer + legend task 2 built for the
 * "Alle" map (`tourMapOverlay.tsx`), here as the only content, plus a list
 * of every tour section — trip name, distance, stop count. Mirrors
 * `AllTab.tours.test.tsx`'s mocking shape so both tabs are held to the same
 * three-state contract: loading, empty and error must stay visibly
 * distinct, and a tour count of zero must never render over a failed
 * request.
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

const mockUseDashboardRoute = vi.hoisted(() => vi.fn());
vi.mock("../../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => mockUseDashboardRoute(),
}));

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

// Imported after the mocks above so the module graph picks them up.
import { TourTab } from "../TourTab";
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

beforeEach(() => {
  mapProps.length = 0;
  navigate.mockReset();
  mockUseDashboardTours.mockReset();
  mockUseDashboardRoute.mockReset();
  mockUseDashboardRoute.mockReturnValue({
    tab: "tour",
    mode: "routes",
    setTab: () => {},
    setMode: () => {},
  });
  mockUseDashboardTours.mockReturnValue(READY_NO_TOURS);
});

const renderTab = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <TourTab />
    </MemoryRouter>
  );

describe("TourTab", () => {
  it("feeds the tour path layer through MapContainer3D's extraLayers prop", async () => {
    mockUseDashboardTours.mockReturnValue({
      ...READY_NO_TOURS,
      tours: [TOUR_A],
      geometries: [GEOMETRY],
    });

    renderTab();

    await waitFor(() => expect(mapProps.length).toBeGreaterThan(0));
    const lastProps = mapProps[mapProps.length - 1];
    const extraLayers = lastProps.extraLayers as Array<{ id: string }>;
    expect(extraLayers.some((layer) => layer.id === "dashboard-tour-paths")).toBe(true);
  });

  it("defaults to visMode routes", () => {
    renderTab();
    expect(mapProps[mapProps.length - 1].visMode).toBe("routes");
  });

  // Fix round 2 (2026-08-30, browser verification): the flat map drew the
  // line correctly, the globe drew nothing at all -- an unlifted 2-D path
  // z-fights with the sphere mesh and loses the depth test. This is the
  // WIRING half of that fix (does TourTab actually ask for the lift on the
  // globe); `tourMapOverlay.altitude.test.ts` covers the pure function's
  // own math.
  it("lifts the tour path altitude on the globe but not on the flat map", async () => {
    mockUseDashboardTours.mockReturnValue({
      ...READY_NO_TOURS,
      tours: [TOUR_A],
      geometries: [GEOMETRY],
    });

    renderTab();
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
      tab: "tour",
      mode: "globe",
      setTab: () => {},
      setMode: () => {},
    });
    renderTab();
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

  it("switches to visMode globe when the URL mode is globe", () => {
    mockUseDashboardRoute.mockReturnValue({
      tab: "tour",
      mode: "globe",
      setTab: () => {},
      setMode: () => {},
    });

    renderTab();

    expect(mapProps[mapProps.length - 1].visMode).toBe("globe");
  });

  it("lists a tour with its trip name, distance and stop count", async () => {
    mockUseDashboardTours.mockReturnValue({
      ...READY_NO_TOURS,
      tours: [TOUR_A],
      geometries: [GEOMETRY],
    });

    renderTab();

    await waitFor(() => expect(screen.getByText("Fjord loop")).toBeInTheDocument());
    expect(screen.getByText("Norway Road Trip")).toBeInTheDocument();
    expect(screen.getByText("420 km")).toBeInTheDocument();
    expect(screen.getByText("trips:tours.stopCount")).toBeInTheDocument();
  });

  it("navigates to the tour's route editor on row click", async () => {
    mockUseDashboardTours.mockReturnValue({
      ...READY_NO_TOURS,
      tours: [TOUR_A],
      geometries: [GEOMETRY],
    });

    renderTab();

    await waitFor(() => expect(screen.getByText("Fjord loop")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Fjord loop"));
    expect(navigate).toHaveBeenCalledWith("/trips/trip-1/route/tour-a");
  });

  it("shows the mode legend once tours have loaded", async () => {
    mockUseDashboardTours.mockReturnValue({
      ...READY_NO_TOURS,
      tours: [TOUR_A],
      geometries: [GEOMETRY],
    });

    renderTab();

    // Two matches on purpose: the legend row AND the list row's own mode
    // badge both render this label — they read from the same
    // `TOUR_MODE_RGB`-backed source, never two independent copies.
    await waitFor(() => {
      expect(screen.getAllByText("trips:tours.mode.road").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("dashboard:tours.loading")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard:tours.loadError")).not.toBeInTheDocument();
  });

  it("shows a loading banner, distinct from the empty and error states", () => {
    mockUseDashboardTours.mockReturnValue({ ...READY_NO_TOURS, toursLoading: true });

    renderTab();

    expect(screen.getByText("dashboard:tours.loading")).toBeInTheDocument();
    expect(screen.queryByText("dashboard:tours.loadError")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard:tourTab.empty")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard:tourTab.listEmpty")).not.toBeInTheDocument();
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

    renderTab();

    expect(screen.getByText("dashboard:tours.loadError")).toBeInTheDocument();
    expect(screen.queryByText("dashboard:tours.loading")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard:tourTab.empty")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("dashboard:tours.retry"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows a distinct empty state for a genuinely empty, successful load", () => {
    renderTab();

    expect(screen.getByText("dashboard:tourTab.empty")).toBeInTheDocument();
    expect(screen.getByText("dashboard:tourTab.listEmpty")).toBeInTheDocument();
    expect(screen.queryByText("dashboard:tours.loading")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard:tours.loadError")).not.toBeInTheDocument();
  });

  // Until 2026-09-01 the tab passed `isFeatureVisible("tourRoutes")` here, so
  // a gated instance asked the hook for `false` and rendered a
  // feature-unavailable notice instead of any of the three states above. The
  // owner released the feature; this now pins the opposite, which is what
  // stops a "defensive" gate being reintroduced by a later merge.
  it("always asks the tour hook to fetch, with no gate in between", () => {
    mockUseDashboardTours.mockReturnValue({
      ...READY_NO_TOURS,
      tours: [TOUR_A],
      geometries: [GEOMETRY],
    });

    renderTab();

    expect(mockUseDashboardTours).toHaveBeenCalledWith(true);
  });
});
