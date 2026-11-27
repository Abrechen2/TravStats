import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Tester, 2026-11-18 (rc.35): every row of "Auf der Karte" ticked, yet the
 * flat map showed flights and points only. Since `tour` became a domain
 * (2026-11-09) the "Alle" tab gated rail, bus, ferry, rentals AND the
 * roadtrip fetch on the day-tour switch — an account without `tour` lost
 * every ground line. Each overlay answers to its own domain only.
 */
const domains = vi.hoisted(() => ({ on: new Set<string>() }));
vi.mock("../../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: [...domains.on],
    isEnabled: (key: string) => domains.on.has(key),
  }),
}));
vi.mock("../../../../hooks/useToursVisible", () => ({
  useToursVisible: () => domains.on.has("tour"),
  useToursAccess: () => (domains.on.has("tour") ? "allowed" : "denied"),
}));

const transportArgs = vi.hoisted(() => [] as unknown[][]);
vi.mock("../allTabTransportOverlays", () => ({
  useTransportOverlays: (...args: unknown[]) => {
    transportArgs.push(args);
    return { layers: [], legendRows: [], activity: [], status: null };
  },
}));

const pathInputs = vi.hoisted(() => [] as { routeId: string }[][]);
vi.mock("../../../layers/tourPathsLayer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../layers/tourPathsLayer")>();
  return {
    ...actual,
    buildTourPaths: (geometries: { routeId: string }[]) => {
      pathInputs.push(geometries);
      return actual.buildTourPaths(geometries as never);
    },
  };
});

const fetchArgs = vi.hoisted(() => [] as unknown[][]);
const geometry = (routeId: string) => ({
  routeId,
  name: routeId,
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
        properties: { legId: "l", source: "straight", mode: "road", confidence: "low" },
      },
    ],
  },
});
vi.mock("../../../../hooks/useDashboardTours", () => ({
  useDashboardTours: (...args: unknown[]) => {
    fetchArgs.push(args);
    const enabled = args[0] === true;
    return {
      tours: enabled
        ? [
            { id: "rt", kind: "roadtrip", name: "rt", mode: "road" },
            { id: "dt", kind: "tour", name: "dt", mode: "road" },
          ]
        : [],
      toursLoading: false,
      toursLoadError: false,
      geometries: enabled ? [geometry("rt"), geometry("dt")] : [],
      reload: () => {},
    };
  },
}));

vi.mock("../../../MapContainer3D", () => ({ default: () => <div data-testid="map" /> }));
vi.mock("../../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => ({ tab: "all", mode: "overview", setTab: () => {}, setMode: () => {} }),
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
vi.mock("../../../../lib/api/lodging", () => ({ listLodgings: () => Promise.resolve([]) }));
vi.mock("../../../../lib/api/places", () => ({ listPlaces: () => Promise.resolve([]) }));
vi.mock("../../../../lib/api/placeLists", () => ({ listPlaceLists: () => Promise.resolve([]) }));
vi.mock("../../../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn().mockResolvedValue([]) },
}));

import { AllTab } from "../AllTab";

const renderTab = () =>
  render(
    <MemoryRouter>
      <AllTab />
    </MemoryRouter>
  );
const last = <T,>(calls: T[]): T | undefined => calls[calls.length - 1];
const lastPaths = () => (last(pathInputs) ?? []).map((g) => g.routeId);

describe("AllTab: ground lines do not hang on the day-tour domain (tester, 2026-11-18)", () => {
  beforeEach(() => {
    transportArgs.length = 0;
    pathInputs.length = 0;
    fetchArgs.length = 0;
  });

  it("draws rail, bus, ferry, rentals and roadtrips with `tour` switched off", async () => {
    domains.on = new Set(["flight", "roadtrip", "rail", "bus", "ferry", "rental"]);
    renderTab();
    await waitFor(() => expect(transportArgs.length).toBeGreaterThan(0));
    // The overlays are switched on; each one still checks its own domain.
    expect(last(transportArgs)?.[0]).toBe(true);
    expect(last(fetchArgs)?.[0]).toBe(true);
    expect(lastPaths()).toEqual(["rt"]);
  });

  it("still hides the roadtrips when only `roadtrip` is off", async () => {
    domains.on = new Set(["flight", "tour", "rail"]);
    renderTab();
    await waitFor(() => expect(pathInputs.length).toBeGreaterThan(0));
    expect(lastPaths()).toEqual(["dt"]);
  });

  it("fetches no routes when neither `tour` nor `roadtrip` is on", async () => {
    domains.on = new Set(["flight", "rail"]);
    renderTab();
    await waitFor(() => expect(transportArgs.length).toBeGreaterThan(0));
    expect(last(fetchArgs)?.[0]).toBe(false);
    expect(last(transportArgs)?.[0]).toBe(true);
  });
});
