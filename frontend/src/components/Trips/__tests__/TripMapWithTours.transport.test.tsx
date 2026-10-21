import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { Layer } from "@deck.gl/core";

// beta.22 UAT: the trip map drew flights, cruises, stays, stops, bus, tours
// and the recording — but no train ride, no ferry crossing and no rental car,
// so a Kiel–Oslo ferry trip showed its hotel alone. The stand-in lists the
// extra layers the map is handed, and what the camera is asked to frame.
vi.mock("../TripMap", () => ({
  default: ({
    extraLayers = [],
    extraPoints = [],
  }: {
    extraLayers?: readonly Layer[];
    extraPoints?: readonly unknown[];
  }) => (
    <ul data-testid="map" data-extra-points={extraPoints.length}>
      {extraLayers.map((layer) => (
        <li key={layer.id} data-testid={layer.id}>
          {JSON.stringify(
            ((layer.props.data as { path?: unknown }[] | undefined) ?? []).map((d) => d.path)
          )}
        </li>
      ))}
    </ul>
  ),
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

  it("draws and frames nothing of a hidden domain", async () => {
    hidden.add("ferry");
    hidden.add("rail");
    hidden.add("rental");
    await renderMap();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByTestId("map").dataset.extraPoints).toBe("0");
  });
});
