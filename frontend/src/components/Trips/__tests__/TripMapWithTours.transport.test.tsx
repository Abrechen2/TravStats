import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { Layer } from "@deck.gl/core";

// beta.22 UAT: the trip map drew flights, cruises, stays, stops, bus, tours
// and the recording — but no train ride, no ferry crossing and no rental car,
// so a Kiel–Oslo ferry trip showed its hotel alone. The stand-in lists the
// extra layers the map is handed, and what the camera is asked to frame.
const projectionListener = vi.hoisted(() => ({
  current: undefined as ((p: "mercator" | "globe") => void) | undefined,
}));
vi.mock("../TripMap", () => ({
  default: ({
    extraLayers = [],
    extraPoints = [],
    onProjectionChange,
  }: {
    extraLayers?: readonly Layer[];
    extraPoints?: readonly unknown[];
    onProjectionChange?: (p: "mercator" | "globe") => void;
  }) => {
    projectionListener.current = onProjectionChange;
    return (
      <ul data-testid="map" data-extra-points={extraPoints.length}>
        {extraLayers.map((layer) => (
          <li key={layer.id} data-testid={layer.id}>
            {JSON.stringify(
              // What the layer draws: its `getPath` (where a globe altitude is
              // applied), else the datum's own path.
              ((layer.props.data as { path?: unknown }[] | undefined) ?? []).map((d) =>
                typeof (layer.props as { getPath?: unknown }).getPath === "function"
                  ? (layer.props as unknown as { getPath: (x: unknown) => unknown }).getPath(d)
                  : d.path
              )
            )}
          </li>
        ))}
      </ul>
    );
  },
}));
vi.mock("../../../lib/api/tours", () => ({
  toursApi: { list: vi.fn(async () => []), tracks: { list: vi.fn(), get: vi.fn() } },
}));
vi.mock("../../../lib/api/tourIndex", () => ({ tourIndexApi: { geometryBatch: vi.fn() } }));
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: vi.fn(() => false) }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../lib/api/tripRecording", () => ({
  tripRecordingApi: {
    get: vi.fn(async () => ({
      summary: {
        pointCount: 0,
        jitterDropped: 0,
        firstAt: null,
        lastAt: null,
        devices: [],
        days: [],
      },
      segments: [],
    })),
  },
}));
const hidden = vi.hoisted(() => new Set<string>());
vi.mock("../../../hooks/useDomainVisible", () => ({
  useDomainVisible: (key: string) => !hidden.has(key),
}));

import TripMapWithTours from "../TripMapWithTours";

const SEA_LANE: [number, number][] = [
  [10.14, 54.33],
  [10.9, 56.2],
  [10.6, 59.0],
  [10.72, 59.9],
];

const trip = {
  id: "trip-1",
  flights: [],
  cruises: [],
  lodgingStays: [],
  stops: [],
  railJourneys: [
    {
      id: "rail-1",
      depStationName: "Hamburg Hbf",
      arrStationName: "Kiel Hbf",
      depLat: 53.55,
      depLon: 10.0,
      arrLat: 54.31,
      arrLon: 10.13,
      geometry: null,
      geometrySource: null,
      status: "completed",
    },
  ],
  ferryJourneys: [
    {
      id: "ferry-1",
      depStationName: "Kiel Norwegenkai",
      arrStationName: "Oslo Hjortneskaia",
      depLat: 54.33,
      depLon: 10.14,
      arrLat: 59.9,
      arrLon: 10.72,
      geometry: SEA_LANE,
      geometrySource: "sea_route",
      status: "completed",
    },
  ],
  rentalBookings: [
    {
      id: "rental-1",
      provider: "Testcar",
      pickupStationName: "Oslo Lufthavn",
      returnStationName: "Bergen Lufthavn",
      pickupLat: 60.19,
      pickupLon: 11.1,
      returnLat: 60.29,
      returnLon: 5.22,
      oneWay: true,
      routeId: null,
      status: "completed",
    },
  ],
} as never;

/** Renders, and lets the recording's own fetch settle so it lands inside act. */
async function renderMap(): Promise<void> {
  render(<TripMapWithTours trip={trip} />);
  await act(async () => undefined);
}

const ids = (): string[] => screen.getAllByRole("listitem").map((li) => li.dataset.testid ?? "");

describe("TripMapWithTours — rail, ferry and rental on the trip map", () => {
  beforeEach(() => hidden.clear());

  it("draws the trip's train ride, ferry crossing and rental car, and frames them", async () => {
    await renderMap();
    const drawn = ids();
    expect(drawn.some((id) => id.startsWith("trip-rail"))).toBe(true);
    expect(drawn.some((id) => id.startsWith("trip-ferry"))).toBe(true);
    expect(drawn.some((id) => id.startsWith("trip-rental"))).toBe(true);
    // The ferry follows its stored sea lane, not the chord between the ports.
    expect(screen.getByTestId("trip-ferry-paths").textContent).toBe(JSON.stringify([SEA_LANE]));
    // Rail chord (2) + sea lane (4) + rental ends (2): the camera frames all of them.
    expect(Number(screen.getByTestId("map").dataset.extraPoints)).toBeGreaterThanOrEqual(8);
  });

  // Codex review before 2.7.0-beta.23: the three were always built for the
  // flat map, so on the trip map's globe they lay at altitude 0 — under the
  // flights and cruises, cut by the surface — while the dashboard globe lifts them.
  it("builds the globe variant of rail, ferry and rental once the map turns to the globe", async () => {
    await renderMap();
    const zOf = (id: string): unknown[] =>
      (JSON.parse(screen.getByTestId(id).textContent ?? "[]") as number[][][])
        .flat()
        .map((p) => p[2]);
    expect(zOf("trip-rail-paths").every((z) => z === undefined)).toBe(true);
    expect(projectionListener.current).toBeTypeOf("function");
    act(() => projectionListener.current?.("globe"));
    for (const id of ["trip-rail-paths", "trip-ferry-paths", "trip-rental-links"]) {
      const z = zOf(id);
      expect(z.length).toBeGreaterThan(0);
      expect(z.every((v) => typeof v === "number" && v > 0)).toBe(true);
    }
  });

  // beta.23 UAT before 2.7.0-rc.20: the bus line stayed the flat map's on the
  // globe — unlifted, a straight chord through the sphere — so København →
  // Hamburg ZOB showed a stub at each terminal and nothing between.
  it("builds the bus line's globe variant too once the map turns to the globe", async () => {
    const withBus = {
      ...(trip as object),
      busJourneys: [
        {
          id: "bus-1",
          status: "completed",
          depStationName: "København",
          depLat: 55.6729,
          depLon: 12.5646,
          arrStationName: "Hamburg ZOB",
          arrLat: 53.5522,
          arrLon: 10.0136,
          geometry: null,
        },
      ],
    } as never;
    render(<TripMapWithTours trip={withBus} />);
    await act(async () => undefined);
    const bus = (): number[][] =>
      (JSON.parse(screen.getByTestId("trip-bus-rides").textContent ?? "[]") as number[][][]).flat();
    expect(bus().every((p) => p[2] === undefined)).toBe(true);
    act(() => projectionListener.current?.("globe"));
    expect(bus().length).toBeGreaterThan(2);
    expect(bus().every((p) => typeof p[2] === "number" && p[2] > 0)).toBe(true);
  });

  it("draws and frames nothing of a hidden domain", async () => {
    hidden.add("ferry");
    hidden.add("rail");
    hidden.add("rental");
    await renderMap();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByTestId("map").dataset.extraPoints).toBe("0");
  });
});
